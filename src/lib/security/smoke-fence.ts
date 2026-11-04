/**
 * #2861: the draft-only smoke fence. The production smoke sends this header on every request when it runs
 * `--draft-only`; the server then refuses every side effect except saving and removing the run's own drafts.
 * The header can only narrow what a request may do. Draft ownership additionally needs an HMAC of the ids
 * with the smoke secret, so a caller cannot claim an existing draft. Absent means normal behavior. A malformed value still fences, with no drafts owned.
 */
export const SMOKE_FENCE_HEADER = "x-adbrain-smoke-fence";

const FENCE_PATTERN = /^draft-only(?:; drafts=([0-9a-f-]{36}(?:,[0-9a-f-]{36}){0,7}); sig=([0-9a-f]{64}))?$/;

export type SmokeFence = {
  /** Drafts this run created and proved with the smoke secret; the only ones a fenced request may change or delete. */
  ownedDraftIds: ReadonlySet<string>;
};

/** What the header claims; ownership counts only after `smokeFence` (server) verifies the signature. */
export function parseSmokeFence(request: Request): { claimedDraftIds: string[]; signature: string } | null {
  const raw = request.headers.get(SMOKE_FENCE_HEADER);
  if (raw === null) return null;
  const match = FENCE_PATTERN.exec(raw.trim());
  return { claimedDraftIds: match?.[1] ? match[1].split(",") : [], signature: match?.[2] ?? "" };
}

/** A forbidden side effect was reached under the fence: the request stops, never passes. */
export class SmokeFenceError extends Error {
  constructor(readonly effect: "picture_redraw" | "whatsapp_binding" | "planner_provider" | "existing_draft" | "ai_provider") {
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
export function assertFenceOwnsDraft(fence: SmokeFence | null, draftId: string): void {
  if (fence && !fence.ownedDraftIds.has(draftId)) throw new SmokeFenceError("existing_draft");
}

/** Routes that call an AI provider or spend money refuse every fenced request, before any limit, usage or write. */
export function refuseWhenFenced(request: Request): Response | null {
  return request.headers.has(SMOKE_FENCE_HEADER) ? smokeFenceResponse(crypto.randomUUID(), new SmokeFenceError("ai_provider")) : null;
}
