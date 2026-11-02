import { targetingInputSchema, type DraftInput, type TargetingInputDTO } from "@/lib/campaign/connect-contracts";

/**
 * The audience plan the Campaigns composer and setup's Go live both run before saving a draft: Review blocks an
 * AI age range or a missing audience (REVIEW_NO_AGE_RANGE, REVIEW_NO_AUDIENCE), so `/api/campaigns/plan` fills them.
 */
export type AudiencePlanReply = {
  response: Response;
  data: { ready?: boolean; fallback?: boolean; targeting?: unknown; error?: string; questions?: { question: string }[]; handoff?: { message: string } };
};

export const AUDIENCE_PLAN_FAILED = "We couldn't suggest who should see your ads. Try again, or choose the area yourself.";

export function needsAudiencePlan(input: Pick<DraftInput, "targeting">): boolean {
  return input.targeting.age?.mode === "ai" || !input.targeting.audience;
}

export async function fetchAudiencePlan(fetchImpl: typeof fetch, input: DraftInput, signal?: AbortSignal): Promise<AudiencePlanReply> {
  const response = await fetchImpl("/api/campaigns/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal: input.goal, audienceDraft: input }),
    signal,
  });
  return { response, data: await response.json() as AudiencePlanReply["data"] };
}

/** The planned targeting with the owner's gender kept, and the fallback's reason to show; throws the owner's words. */
export function plannedTargeting(input: DraftInput, { response, data }: AudiencePlanReply): { targeting: TargetingInputDTO; notice: string | null } {
  if (!response.ok || !data.ready) {
    throw new Error(data.error ?? data.handoff?.message ?? (data.questions?.map((question) => question.question).join(" ") || AUDIENCE_PLAN_FAILED));
  }
  const targeting = { ...targetingInputSchema.parse(data.targeting), gender: input.targeting.gender ?? "all" as const };
  if (data.fallback && targeting.audience) return { targeting, notice: targeting.audience.rationale };
  if (!targeting.audience?.interestNames.length) throw new Error("The detailed targeting recommendation is incomplete. Try again.");
  return { targeting, notice: null };
}
