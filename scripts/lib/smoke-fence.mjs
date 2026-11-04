// #2861: the draft-only smoke fence. With `--draft-only` the smoke sends this header on every same-origin
// request; the server (src/lib/security/smoke-fence.ts) then refuses every side effect except saving and
// removing drafts this run created. A refusal stops the run as a non-pass; it is never read as a green review.
export const SMOKE_FENCE_HEADER = "x-adbrain-smoke-fence";

/** The header value: only drafts this run saved may be changed or deleted. */
export const fenceHeaderValue = (ownedDraftIds) => (ownedDraftIds.size ? `draft-only; drafts=${[...ownedDraftIds].join(",")}` : "draft-only");

/** The sentence for a fence refusal in a response body, or null when the body is not one. */
export function fenceStop(body) {
  const error = body?.error;
  if (error?.code !== "SMOKE_FENCE") return null;
  return `BLOCKED by the draft-only fence (${String(error.effect ?? "unknown effect").slice(0, 40)}); the run is not a pass`;
}
