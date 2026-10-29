import { observeRoute, currentRequestId, recordProductEvent } from "@/lib/observability/logger";
import { NextResponse } from "next/server";
import { z } from "zod";
import { draftDtoSchema, draftInputSchema } from "@/lib/campaign/connect-contracts";
import { DRAFT_TTL_MS, MAX_ACTIVE_DRAFTS, draftRecordFromRow, draftRecordToDTO, prepareDraftCreate } from "@/lib/campaign/draft-store";
import { formatAnswers, runPlanner, plannerAnswerSchema, PLANNER_GROQ_MAX_TOKENS, PLANNER_PROMPT_VERSION, type PlannerQuestion, type PlannerTopic } from "@/lib/campaign/planner";
import { configuredMonthlyTokenLimit, monthlyTokenUsage, persistLLMUsage } from "@/lib/llm/persist";
import { AllLLMProvidersFailedError, LLMError, NoLLMKeysError } from "@/lib/llm/types";
import { fallbackAudienceTargeting, plannerPlanToDraftInput, rationaleForMatchedInterests } from "@/lib/campaign/planner-draft";
import { ConnectionAccessError, requireOwnedBusiness, withMetaConnection } from "@/lib/meta/connection-access";
import { friendlyMetaError, type LeadForm } from "@/lib/meta/client";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/types";
import { listEditableDrafts } from "@/lib/campaign/draft-repository";
import { maskedWhatsAppNumberPattern } from "@/lib/meta/whatsapp-status-shared";
import { cachedLeadForms } from "@/lib/meta/lead-form-cache";
import { preferenceContext } from "@/lib/preferences/store";
import {
  getActiveInstructionsText,
  getApprovedCreatives,
  getPerformanceContext,
  getPrimaryBusiness,
} from "@/lib/supabase/queries";
import { ownerError } from "@/i18n/request-locale";

export const runtime = "nodejs";
export const maxDuration = 60;

/** A non-answerable informational message rendered in the chat. */
const note = (text: string): PlannerQuestion => ({
  id: "note",
  question: text,
  type: "text",
});

export const POST = observeRoute("/api/campaigns/plan", "POST", handlePOST);

async function handlePOST(req: Request) {
  // #821: Prepare's end-to-end time for the scoreboard (target p90 < 8 s).
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = await rateLimitResponse(`plan:${user.id}`, {
    limit: 40,
    windowMs: 5 * 60_000,
  });
  if (limited) return limited;

  const parsed = z.object({
    goal: z.string().trim().min(1).max(2_000),
    audienceDraft: draftInputSchema.optional(),
    destination: z.enum(["instant_form", "whatsapp"]).optional(),
    whatsappNumber: z.string().regex(maskedWhatsAppNumberPattern).optional(),
    answers: z.union([z.string().max(12_000), z.array(plannerAnswerSchema).max(30)]).optional(),
  }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A valid goal and answers are required." }, { status: 400 });
  const goal = parsed.data.goal;
  const rawAnswers = parsed.data.answers;
  if (Array.isArray(rawAnswers) && JSON.stringify(rawAnswers).length > 12_000) {
    return NextResponse.json({ error: "The interview is too long. Continue in the campaign editor." }, { status: 400 });
  }
  const answers = Array.isArray(rawAnswers)
    ? formatAnswers(rawAnswers) || undefined
    : typeof rawAnswers === "string"
      ? rawAnswers.trim() || undefined
      : undefined;
  if (!goal) {
    return NextResponse.json({ error: "goal is required" }, { status: 400 });
  }

  const business = await getPrimaryBusiness();
  if (!business) {
    return NextResponse.json({ error: "No business found" }, { status: 400 });
  }
  const audienceDraft = parsed.data.audienceDraft;
  const destination = audienceDraft?.destination ?? parsed.data.destination ?? "instant_form";
  if (audienceDraft && audienceDraft.businessId !== business.id) {
    return NextResponse.json({ error: "Business access is not allowed." }, { status: 403 });
  }

  const approved = await getApprovedCreatives(business.id);
  if (!approved.length) {
    return NextResponse.json({
      ready: false,
      questions: [
        note(
          "You don't have any approved creatives yet. Generate a batch in the Creative Studio and approve the ones you like, then come back.",
        ),
      ],
    });
  }

  let leadForms: LeadForm[] = [];
  let actor;
  try {
    actor = await requireOwnedBusiness(business.id);
  } catch (err) {
    if (err instanceof ConnectionAccessError) {
      return NextResponse.json({ error: err.message }, { status: err.code === "UNAUTHENTICATED" ? 401 : 400 });
    }
    return NextResponse.json({ error: friendlyMetaError(err, "Could not load lead forms.") }, { status: 502 });
  }
  try {
    if (!audienceDraft && destination === "instant_form") leadForms = await withMetaConnection(actor, { purpose: "create_paused" }, (meta, connection) => cachedLeadForms(meta, connection));
  } catch {
    leadForms = [];
  }

  let result;
  let failureStage: "QUOTA" | "INSTRUCTIONS" | "PREFERENCES" | "PERFORMANCE" | "MODEL" | "USAGE" = "QUOTA";
  // Each read names its stage when it fails, so the failure log stays as specific as before.
  const stage = <T,>(name: typeof failureStage, work: Promise<T>) => work.catch((error: unknown) => { failureStage = name; throw error; });
  try {
    const limit = configuredMonthlyTokenLimit(user);
    // #366: these reads are independent, so Prepare waits for the slowest, not their sum.
    const [used, instructions, preferences, performance] = await Promise.all([
      limit > 0 ? stage("QUOTA", monthlyTokenUsage(business.id)) : Promise.resolve(0),
      stage("INSTRUCTIONS", getActiveInstructionsText(business.id)),
      stage("PREFERENCES", preferenceContext(business.id, "campaign", `${goal}\n${answers ?? ""}`)),
      stage("PERFORMANCE", getPerformanceContext(business.id)),
    ]);
    if (limit > 0) {
      if (used === null) return NextResponse.json({ error: await ownerError("somethingDidntAnswer") }, { status: 503 });
      if (used >= limit) return NextResponse.json({ error: await ownerError("aiAllowanceUsed") }, { status: 429 });
    }
    const requestId = currentRequestId();
    failureStage = "MODEL";
    result = await runPlanner({
      destination,
      brand: business,
      instructions,
      preferences,
      performance,
      approved: approved.map((c) => ({
        id: c.id,
        angle: c.angle,
        headline: c.headline,
      })),
      leadForms: leadForms.map((f) => ({ id: f.id, name: f.name })),
      goal,
      answerHistory: Array.isArray(rawAnswers) ? rawAnswers : undefined,
      knownTopics: audienceDraft ? ["budget", "creative", "lead_form",
        ...(audienceDraft.targeting.location?.mode === "manual" ? ["location", "radius"] as PlannerTopic[] : []),
        ...(audienceDraft.targeting.age?.mode === "manual" ? ["audience"] as PlannerTopic[] : [])] : undefined,
      answers: audienceDraft
        ? `${answers ?? ""}\nPlan only the audience. The owner has already chosen these campaign settings: ${JSON.stringify(audienceDraft)}. Preserve manual location and age choices. Do not ask for a budget, creative or form. Decide audience settings from the business evidence; ask only for missing service-area facts.`
        : answers,
    }, {
      signal: req.signal,
      onCompletion: async (completion, valid, attempt = 1) => {
        if (!completion.usage) return;
        failureStage = "USAGE";
        await persistLLMUsage([{
          businessId: business.id, userId: user.id, requestId, route: "campaigns.plan",
          provider: completion.provider, model: completion.model, usage: completion.usage,
          promptVersion: PLANNER_PROMPT_VERSION, inputChars: completion.inputChars,
          outputChars: completion.outputChars, latencyMs: completion.latencyMs,
          attempt, maxTokens: completion.provider === "groq" ? PLANNER_GROQ_MAX_TOKENS : 3000, temperature: 0.2,
          status: valid ? "success" : "error", errorCode: valid ? undefined : "PLANNER_VALIDATION",
          metadata: { audienceOnly: Boolean(audienceDraft) },
        }]);
        failureStage = "MODEL";
      },
      onProviderFailures: async (failures, attempt) => {
        failureStage = "USAGE";
        await persistLLMUsage(failures.map((failure) => ({
          businessId: business.id, userId: user.id, requestId, route: "campaigns.plan",
          provider: failure.provider, model: failure.model,
          usage: failure.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          promptVersion: PLANNER_PROMPT_VERSION, latencyMs: failure.latencyMs,
          attempt, maxTokens: failure.provider === "groq" ? PLANNER_GROQ_MAX_TOKENS : 3000, temperature: 0.2,
          status: "error", failure: failure.failure, errorCode: `LLM_${failure.failure ?? "UNKNOWN"}`, rateLimit: failure.rateLimit,
          providerRequestId: failure.providerRequestId, providerFinalStatus: failure.providerFinalStatus,
          metadata: { audienceOnly: Boolean(audienceDraft) },
        })));
        failureStage = "MODEL";
      },
    });
  } catch (error) {
    const failureClass = failureStage !== "MODEL" ? "OTHER"
      : error instanceof NoLLMKeysError ? "NO_KEYS"
      : error instanceof AllLLMProvidersFailedError ? `EXHAUSTED_${error.reason}`
      : error instanceof DOMException && error.name === "TimeoutError" ? "TIMEOUT"
      : error instanceof DOMException && error.name === "AbortError" ? "ABORTED"
      : error instanceof LLMError ? error.status === 429 ? "RATE_LIMIT"
        : error.status && error.status >= 500 ? "PROVIDER_SERVER"
          : error.status ? "PROVIDER_CLIENT" : "TRANSPORT"
        : "OTHER";
    // #612: an audience plan that falls back to default targeting still lets the owner launch: partial.
    const fallsBack = Boolean(audienceDraft) && failureStage === "MODEL" && failureClass !== "ABORTED";
    recordProductEvent({ kind: "workflow", name: "campaign.plan", durationMs: elapsed(), outcome: fallsBack ? "partial" : "failed", businessId: business.id,
      attributes: { errorCode: `PLAN_${failureStage}_${failureClass}` } });
    if (fallsBack) {
      return NextResponse.json({ ready: true, fallback: true, targeting: fallbackAudienceTargeting(audienceDraft!) });
    }
    // #2230: only the smoke login is held to free text; its check names the cause.
    return NextResponse.json({ error: "Could not prepare the campaign plan.",
      ...(failureClass === "EXHAUSTED_FREE_TEXT_UNAVAILABLE" ? { code: "FREE_TEXT_UNAVAILABLE" } : {}) }, { status: 502 });
  }

  // The editor cannot answer interview questions; give it usable default targeting instead.
  const audienceFallback = (errorCode: string) => {
    recordProductEvent({ kind: "workflow", name: "campaign.plan", durationMs: elapsed(), outcome: "partial", businessId: business.id, attributes: { errorCode } });
    return NextResponse.json({ ready: true, fallback: true, targeting: fallbackAudienceTargeting(audienceDraft!) });
  };
  if (audienceDraft && result.handoff) return audienceFallback("PLAN_AUDIENCE_HANDOFF");
  if (audienceDraft && (!result.ready || !result.plan)) return audienceFallback("PLAN_AUDIENCE_QUESTIONS");

  if (result.handoff) {
    recordProductEvent({ kind: "workflow", name: "campaign.interview", outcome: "partial", businessId: business.id,
      attributes: { errorCode: result.handoff.reason === "interview_limit" ? "INTERVIEW_LIMIT" : "NO_PROGRESS" } });
    return NextResponse.json({ ready: false, questions: [], handoff: result.handoff });
  }

  if (!result.ready || !result.plan) {
    return NextResponse.json({
      ready: false,
      questions: result.questions?.length
        ? result.questions
        : [
            note(
              "Could you tell me your daily budget and which area or offer to focus on?",
            ),
          ],
    });
  }

  const draftResult = plannerPlanToDraftInput({
    businessId: business.id,
    business: { vertical: business.vertical, offers: business.offers },
    goal,
    plan: audienceDraft ? {
      ...result.plan,
      city_scope: audienceDraft.targeting.location?.cityScope ?? "radius",
      radius_km: audienceDraft.targeting.location?.radiusKm ?? result.plan.radius_km,
      name: audienceDraft.name,
      daily_budget_rupees: audienceDraft.dailyBudgetRupees,
      creative_ids: audienceDraft.creativeIds,
      lead_form_id: null,
      destination,
    } : { ...result.plan, destination, ...(destination === "whatsapp" ? { lead_form_id: null } : {}) },
    approvedCreativeIds: approved.map((creative) => creative.id),
    leadFormIds: leadForms.map((form) => form.id),
  });
  if (!draftResult.ok) {
    if (audienceDraft) return audienceFallback("PLAN_AUDIENCE_INVALID");
    return NextResponse.json({
      ready: false,
      questions: [note(draftResult.error)],
    });
  }
  const audience = draftResult.draft.targeting.audience;
  let noMetaInterests = false;
  // #686: counts only (suggested, unresolved), so the scoreboard can read interest quality.
  const interestCounts: { count: number; failedCount?: number; errorCode?: string } = { count: audience?.interestNames.length ?? 0 };
  if (audience?.interestNames.length) {
    // Meta has no interest for many AI suggestions (e.g. "Chiropractic"); preflight would block on them.
    try {
      const { interests, unresolved } = await withMetaConnection(actor, { purpose: "create_paused" }, (meta) => meta.resolveAudienceInterests(audience.interestNames));
      interestCounts.failedCount = unresolved.length;
      if (interests.length) {
        audience.interestNames = interests.map((interest) => interest.name);
        audience.rationale = rationaleForMatchedInterests(audience.rationale, audience.interestNames, unresolved);
      } else noMetaInterests = true;
    } catch {
      // Keep the AI names; preflight reports the lookup failure.
      interestCounts.errorCode = "PLAN_AUDIENCE_INTEREST_LOOKUP_FAILED";
    }
  }
  const planReady = () => recordProductEvent({ kind: "workflow", name: "campaign.plan", durationMs: elapsed(),
    outcome: interestCounts.errorCode ? "partial" : "success", businessId: business.id, attributes: interestCounts });
  if (audienceDraft) {
    const targeting = {
      ...draftResult.draft.targeting,
      ...(noMetaInterests ? { audience: { interestNames: [], rationale: "Meta has none of the suggested interests, so this plan targets everyone in the chosen areas and ages." } } : {}),
      gender: audienceDraft.targeting.gender ?? "all",
      location: audienceDraft.targeting.location?.mode === "manual" ? audienceDraft.targeting.location : {
        ...draftResult.draft.targeting.location,
        cityScope: audienceDraft.targeting.location?.cityScope ?? "radius",
        ...(audienceDraft.targeting.location?.excludedNames?.length ? { excludedNames: audienceDraft.targeting.location.excludedNames } : {}),
        ...(audienceDraft.targeting.location?.excluded?.length ? { excluded: audienceDraft.targeting.location.excluded } : {}),
      },
      ...(audienceDraft.targeting.age?.mode === "manual" ? { age: audienceDraft.targeting.age } : {}),
    };
    if (noMetaInterests) {
      recordProductEvent({ kind: "workflow", name: "campaign.plan", durationMs: elapsed(), outcome: "partial", businessId: business.id, attributes: { ...interestCounts, errorCode: "PLAN_AUDIENCE_NO_META_INTERESTS" } });
      return NextResponse.json({ ready: true, fallback: true, targeting });
    }
    planReady();
    return NextResponse.json({ ready: true, targeting });
  }

  const now = new Date().toISOString();
  // Preflight resolves this mask against the business's own numbers, as for a manual draft.
  const draftInput = destination === "whatsapp" && parsed.data.whatsappNumber ? { ...draftResult.draft, whatsappNumber: parsed.data.whatsappNumber } : draftResult.draft;
  const plan = prepareDraftCreate({ actor, draftInput, now, ttlMs: DRAFT_TTL_MS });
  if ("ok" in plan) {
    return NextResponse.json({ error: plan.message }, { status: plan.code === "FORBIDDEN" ? 403 : 400 });
  }
  const { data: activeRows, error: countError } = await supabase
    .from("campaign_drafts")
    .select("id")
    .eq("business_id", actor.businessId)
    .eq("owner_id", actor.userId)
    .gt("expires_at", now);
  if (countError) return NextResponse.json({ error: await ownerError("draftSaveUnavailable") }, { status: 503 });
  if ((activeRows ?? []).length >= MAX_ACTIVE_DRAFTS) {
    try {
      if ((await listEditableDrafts(supabase, actor)).length >= MAX_ACTIVE_DRAFTS) {
        return NextResponse.json({ error: await ownerError("tooManyDrafts") }, { status: 409 });
      }
    } catch {
      return NextResponse.json({ error: "Saved draft operations could not be checked." }, { status: 503 });
    }
  }
  const { data: row, error } = await supabase
    .from("campaign_drafts")
    .insert({
      business_id: plan.businessId,
      owner_id: plan.ownerId,
      version: plan.version,
      input: plan.input as unknown as Json,
      expires_at: plan.expiresAt,
      created_at: plan.createdAt,
      updated_at: plan.updatedAt,
    })
    .select("*")
    .single();
  if (error || !row) return NextResponse.json({ error: await ownerError("draftSaveUnavailable") }, { status: 503 });
  const draft = draftDtoSchema.parse(draftRecordToDTO(draftRecordFromRow(row)));
  planReady();
  return NextResponse.json({ ready: true, draft });
}
