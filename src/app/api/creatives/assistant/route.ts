import { NextResponse } from "next/server";
import { apiError, readJson, serverError } from "@/lib/api";
import {
  runInterview,
  type InterviewAnswer,
  type InterviewQuestion,
} from "@/lib/creative/interview";
import { NoLLMKeysError } from "@/lib/llm";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { getActiveInstructionsText } from "@/lib/supabase/queries";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Coerce an untrusted LLM question into a safe, bounded shape for the UI. */
function sanitizeQuestion(q: unknown): InterviewQuestion | null {
  if (!q || typeof q !== "object") return null;
  const raw = q as Record<string, unknown>;
  const question = typeof raw.question === "string" ? raw.question.trim() : "";
  if (!question) return null;
  const options = Array.isArray(raw.options)
    ? raw.options
        .filter((o): o is string => typeof o === "string" && o.trim().length > 0)
        .slice(0, 6)
    : [];
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : "q",
    question,
    help: typeof raw.help === "string" ? raw.help : undefined,
    options,
    allowText: raw.allowText !== false,
    allowRandom: Boolean(raw.allowRandom),
    aiCanDecide: Boolean(raw.aiCanDecide),
  };
}

export async function POST(req: Request) {
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

  const body = await readJson<{
    businessId?: string;
    goal?: string;
    answers?: InterviewAnswer[];
  }>(req);
  const businessId = (body?.businessId ?? "").trim();
  const goal = (body?.goal ?? "").trim();
  if (!businessId || !goal) {
    return apiError("businessId and goal are required", 400);
  }
  const answers = Array.isArray(body?.answers)
    ? body.answers
        .filter(
          (a): a is InterviewAnswer =>
            !!a && typeof a.question === "string" && typeof a.answer === "string",
        )
        .slice(0, 12)
    : [];

  // RLS scopes this to the user's own business.
  const { data: business } = await supabase
    .from("businesses")
    .select("*")
    .eq("id", businessId)
    .maybeSingle();
  if (!business) return apiError("Business not found", 404);

  const instructions = await getActiveInstructionsText(businessId);

  try {
    const result = await runInterview({ brand: business, instructions, goal, answers });
    if (result.ready && typeof result.brief === "string" && result.brief.trim()) {
      return NextResponse.json({
        ready: true,
        brief: result.brief.trim(),
        language: typeof result.language === "string" ? result.language : undefined,
        angleId: typeof result.angleId === "string" ? result.angleId : undefined,
      });
    }
    const question = sanitizeQuestion(result.question);
    if (!question) {
      // Model gave neither a usable question nor a brief — fail soft to generation.
      return NextResponse.json({ ready: true, brief: goal });
    }
    return NextResponse.json({ ready: false, question });
  } catch (err) {
    if (err instanceof NoLLMKeysError) {
      return NextResponse.json(
        { error: err.message, code: "NO_LLM_KEYS" },
        { status: 400 },
      );
    }
    return serverError("creatives.assistant", err, "The assistant had trouble — try again.");
  }
}
