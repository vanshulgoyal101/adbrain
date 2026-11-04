// #2861: the draft-only smoke fence. With `--draft-only` the smoke sends this header on every same-origin
// request; the server (src/lib/security/smoke-fence.ts) then refuses every side effect except saving and
// removing drafts this run created, proved by an HMAC with TEST_SESSION_SECRET. A refusal stops the run as a non-pass; it is never read as a green review.
import { createHmac } from "node:crypto";

export const SMOKE_FENCE_HEADER = "x-adbrain-smoke-fence";

/** The header value: only drafts this run saved, signed with the smoke secret, may be changed or deleted. */
export function fenceHeaderValue(ownedDraftIds, secret) {
  if (!ownedDraftIds.size) return "draft-only";
  const ids = [...ownedDraftIds];
  const sig = createHmac("sha256", secret).update(`draft-only|${[...ids].sort().join(",")}`).digest("hex");
  return `draft-only; drafts=${ids.join(",")}; sig=${sig}`;
}

/** The sentence for a fence refusal in a response body, or null when the body is not one. */
export function fenceStop(body) {
  const error = body?.error;
  if (error?.code !== "SMOKE_FENCE") return null;
  return `BLOCKED by the draft-only fence (${String(error.effect ?? "unknown effect").slice(0, 40)}); the run is not a pass`;
}

/** The line for a fenced step that ran without its provider, so a green run never reads as full coverage. */
export const fenceSkipNote = (body) => (body?.smokeFenced ? "SKIP planner provider coverage: the draft-only fence answered with default targeting (not the full check)" : null);

/**
 * Whether the checked-out source is the build the origin serves. The walk judges the signed-in identity with the
 * checked-out `freeOnlyEligibility`; that only proves the served app holds it to free providers when both are the same
 * commit. Unknown on either side, or a different commit, is a refusal (never a pass).
 */
export function policyParity(servedRelease, localSha) {
  const full = /^[0-9a-f]{40}$/;
  if (!full.test(localSha ?? "")) return { ok: false, reason: "the checked-out commit is unknown" };
  if (!full.test(servedRelease ?? "")) return { ok: false, reason: `the origin does not report its release (${servedRelease ? "unrecognised value" : "no X-AdBrain-Release header"})` };
  if (servedRelease !== localSha) return { ok: false, reason: `the origin serves ${servedRelease.slice(0, 7)} but the walk's policy is ${localSha.slice(0, 7)}` };
  return { ok: true, reason: "" };
}
