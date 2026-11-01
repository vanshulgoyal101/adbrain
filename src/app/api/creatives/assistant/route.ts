import { observeRoute, currentRequestId, recordProductEvent } from "@/lib/observability/logger";
import { NextResponse } from "next/server";
import { apiError, serverError } from "@/lib/api";
import {
  runInterview,
  interviewRequestSchema,
  InterviewValidationError,
  INTERVIEW_PROMPT_VERSION,
} from "@/lib/creative/interview";
import { NoLLMKeysError } from "@/lib/llm";
import { AllLLMProvidersFailedError, LLMError } from "@/lib/llm/types";
import { configuredMonthlyTokenLimit, monthlyTokenUsage, persistLLMUsage } from "@/lib/llm/persist";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { getActiveInstructionsText } from "@/lib/supabase/queries";
import { pastResultsBlock } from "@/lib/campaign/result-evidence";
import { getResultEvidence } from "@/lib/campaign/result-evidence-store";
import { preferenceContext } from "@/lib/preferences/store";
import { ownerError } from "@/i18n/request-locale";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = observeRoute("/api/creatives/assistant", "POST", handlePOST);

async function handlePOST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError("Unauthorized", 401);

  const limited = await rateLimitResponse(`assistant:${user.id}`, {
    limit: 40,
    windowMs: 5 * 60_000,
  });
  if (limited) return limited;

  const parsed = interviewRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(await ownerError("requestLooksWrong"), 400);
  const { businessId, goal, answers, recentGoals, referenceBrief } = parsed.data;

  // RLS scopes this to the user's own business.
  const { data: business } = await supabase
    .from("businesses")
    .select("*")
    .eq("id", businessId)
    .maybeSingle();
  if (!business) return apiError(await ownerError("businessNotFound"), 404);

  const refused: string[] = [];
  try {
    const limit = configuredMonthlyTokenLimit(user);
    if (limit > 0) {
      const used = await monthlyTokenUsage(businessId);
      if (used === null) return apiError(await ownerError("somethingDidntAnswer"), 503);
      if (used >= limit) return apiError(await ownerError("aiAllowanceUsed"), 429);
    }
    const [instructions, preferences, evidence] = await Promise.all([
      getActiveInstructionsText(businessId),
      preferenceContext(businessId, "creative", `${goal}\n${answers.map(answer => answer.answer).join("\n")}`),
      // #371: past results are optional evidence; a failed read leaves the interview as it was.
      getResultEvidence(businessId).catch(() => []),
    ]);
    const requestId = currentRequestId();
    const result = await runInterview({ brand: business, instructions, preferences, goal, answers, recentGoals, referenceBrief, pastResults: pastResultsBlock(evidence) }, {
      signal: req.signal,
      onAttempt: async (completion, attempt, valid, rules = []) => {
        if (!completion.usage) return;
        await persistLLMUsage([{
          businessId, userId: user.id, requestId, route: "creatives.assistant",
          provider: completion.provider, model: completion.model, usage: completion.usage,
          promptVersion: INTERVIEW_PROMPT_VERSION, inputChars: completion.inputChars,
          outputChars: completion.outputChars, latencyMs: completion.latencyMs,
          attempt, maxTokens: 2400, temperature: attempt === 1 ? 0.5 : 0.2,
          status: valid ? "success" : "error", errorCode: valid ? undefined : "INTERVIEW_VALIDATION",
          metadata: { answerCount: answers.length, repaired: attempt > 1, ...(valid ? {} : { validationRules: rules }) },
        }]);
      },
      onProviderFailures: async (failures, attempt) => {
        refused.push(...failures.map((failure) => failure.failure ?? "UNKNOWN"));
        await persistLLMUsage(failures.map((failure) => ({
          businessId, userId: user.id, requestId, route: "creatives.assistant",
          provider: failure.provider, model: failure.model,
          usage: failure.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          promptVersion: INTERVIEW_PROMPT_VERSION, latencyMs: failure.latencyMs,
          attempt, maxTokens: 2400, temperature: attempt === 1 ? 0.5 : 0.2,
          status: "error", failure: failure.failure, errorCode: `LLM_${failure.failure ?? "UNKNOWN"}`, rateLimit: failure.rateLimit,
          providerRequestId: failure.providerRequestId, providerFinalStatus: failure.providerFinalStatus,
          metadata: { answerCount: answers.length, repaired: attempt > 1 },
        })));
      },
    });
    return NextResponse.json({ ...result, promptVersion: INTERVIEW_PROMPT_VERSION }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof InterviewValidationError) return apiError(err.message, 502);
    if (err instanceof NoLLMKeysError) {
      return NextResponse.json(
        { error: err.message, code: "NO_LLM_KEYS" },
        { status: 400 },
      );
    }
    const failure = providerFailure(err, refused);
    if (failure) {
      recordProductEvent({ kind: "workflow", name: "creative.interview", outcome: "failed", businessId,
        attributes: { errorCode: `ASSISTANT_${failure.code}` } });
    }
    if (failure?.busy) {
      return NextResponse.json(
        { error: await ownerError("aiBusy"), code: "AI_BUSY" },
        { status: 503, headers: { "Retry-After": "10", "Cache-Control": "no-store" } },
      );
    }
    return serverError("creatives.assistant", err, await ownerError("assistantTrouble"));
  }
}

const TRANSIENT = /^(?:HTTP_429|HTTP_5\d\d|TIMEOUT|DEADLINE|TRANSPORT)$/;
const BUSY_EXHAUSTED = new Set(["RATE_LIMIT", "PROVIDER_SERVER", "TIMEOUT", "TRANSPORT", "COOLDOWN", "MIXED"]);

/**
 * Why no AI provider answered (#410). Load (rate limits, outages, timeouts) is `busy`: worth a retry.
 * A refused key or request (401, 403, 400) is ours to fix, so it stays a 500 that alerts (#449).
 * The smoke login's free-only text (#2230) is busy when its free models were tried or parked, not missing (#2457).
 * Null for errors that aren't provider failures at all.
 */
function providerFailure(err: unknown, refused: string[]): { code: string; busy: boolean } | null {
  const permanent = refused.find((code) => code !== "ABORTED" && !TRANSIENT.test(code));
  if (err instanceof AllLLMProvidersFailedError) {
    const busy = BUSY_EXHAUSTED.has(err.reason) || (err.reason === "FREE_TEXT_UNAVAILABLE" && err.providerCount > 0);
    return permanent ? { code: permanent, busy: false } : { code: `EXHAUSTED_${err.reason}`, busy };
  }
  if (err instanceof LLMError) {
    const code = err.code ?? "UNKNOWN";
    return { code: permanent ?? code, busy: !permanent && TRANSIENT.test(code) };
  }
  if (err instanceof DOMException && err.name === "TimeoutError") return { code: permanent ?? "TIMEOUT", busy: !permanent };
  return null;
}
