/**
 * #2861: the draft-only smoke fence. The production smoke sends this header on every request when it runs
 * `--draft-only`; the server then refuses every side effect except saving and removing the run's own drafts.
 * The header can only narrow what a request may do. Draft ownership needs a capability the server issued when a
 * fenced request created that draft (bound to the user, the draft and its creation time, expiring after
 * FENCE_CAPABILITY_TTL_MS), so an existing or prior-run draft cannot be claimed. Absent means normal behavior. A malformed value still fences, with no drafts owned.
 */
export const SMOKE_FENCE_HEADER = "x-adbrain-smoke-fence";

export const FENCE_CAPABILITY_HEADER = "x-adbrain-fence-capability";
export const FENCE_CAPABILITY_TTL_MS = 30 * 60 * 1000;

const TOKEN = "[0-9a-f-]{36}\\.\\d{10,15}\\.[0-9a-f]{64}";
const FENCE_PATTERN = new RegExp(`^draft-only(?:; drafts=(${TOKEN}(?:,${TOKEN}){0,7}))?$`);

export type SmokeFence = {
  /** Drafts a fenced request created, proved by a live server-issued capability; the only ones a fenced request may change or delete. */
  ownedDraftIds: ReadonlySet<string>;
  /** Each owned draft's capability expiry, which must equal its creation time plus the TTL. */
  capabilityExpiry: ReadonlyMap<string, number>;
};

/** What the header claims; ownership counts only after `smokeFence` (server) verifies each capability. */
export function parseSmokeFence(request: Request): { claims: { id: string; expiresAt: number; signature: string }[] } | null {
  const raw = request.headers.get(SMOKE_FENCE_HEADER);
  if (raw === null) return null;
  const match = FENCE_PATTERN.exec(raw.trim());
  const claims = (match?.[1] ? match[1].split(",") : []).map((token) => {
    const [id, expiresAt, signature] = token.split(".");
    return { id, expiresAt: Number(expiresAt), signature };
  });
  return { claims };
}

/** A forbidden side effect was reached under the fence: the request stops, never passes. */
export class SmokeFenceError extends Error {
  constructor(readonly effect: "picture_redraw" | "whatsapp_binding" | "planner_provider" | "existing_draft" | "ai_provider" | "campaign_write") {
    super(`The draft-only smoke fence stopped a side effect: ${effect}.`);
    this.name = "SmokeFenceError";
  }
}

export function smokeFenceResponse(requestId: string, error: SmokeFenceError) {
  return Response.json(
    { ok: false, error: { code: "SMOKE_FENCE", message: error.message, effect: error.effect, retryable: false }, requestId },
    { status: 409 },
  );
}

/** Changing or deleting a draft is allowed under the fence only when this run created it. */
export function assertFenceOwnsDraft(fence: SmokeFence | null, draftId: string, createdAt?: string): void {
  if (!fence) return;
  if (!fence.ownedDraftIds.has(draftId)) throw new SmokeFenceError("existing_draft");
  if (createdAt !== undefined && fence.capabilityExpiry.get(draftId) !== Date.parse(createdAt) + FENCE_CAPABILITY_TTL_MS) throw new SmokeFenceError("existing_draft");
}

/** A fenced request cannot reach the side effect named by the route, before any read or write. */
export function refuseWhenFenced(request: Request, effect: SmokeFenceError["effect"] = "ai_provider"): Response | null {
  return request.headers.has(SMOKE_FENCE_HEADER) ? smokeFenceResponse(crypto.randomUUID(), new SmokeFenceError(effect)) : null;
}
