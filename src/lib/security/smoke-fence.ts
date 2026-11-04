/**
 * #2861: the draft-only smoke fence. The production smoke sends this header on every request when it runs
 * `--draft-only`; the server then refuses every side effect except saving and removing the run's own drafts.
 * The header can only narrow what a request may do, never widen it, so a forged one blocks the sender's own
 * effects and nothing else. Absent means normal behavior. A malformed value still fences, with no drafts owned.
 */
export const SMOKE_FENCE_HEADER = "x-adbrain-smoke-fence";

const FENCE_PATTERN = /^draft-only(?:; drafts=([0-9a-f-]{36}(?:,[0-9a-f-]{36}){0,7}))?$/;

export type SmokeFence = {
  /** Drafts this run created (from its own save responses); the only ones a fenced request may change or delete. */
  ownedDraftIds: ReadonlySet<string>;
};

export function smokeFence(request: Request): SmokeFence | null {
  const raw = request.headers.get(SMOKE_FENCE_HEADER);
  if (raw === null) return null;
  const ids = FENCE_PATTERN.exec(raw.trim())?.[1];
  return { ownedDraftIds: new Set(ids ? ids.split(",") : []) };
}

/** A forbidden side effect was reached under the fence: the request stops, never passes. */
export class SmokeFenceError extends Error {
  constructor(readonly effect: "picture_redraw" | "whatsapp_binding" | "planner_provider" | "existing_draft") {
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
