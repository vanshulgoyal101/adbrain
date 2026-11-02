export const ASSISTANT_BUSY_ERROR = "console error at /api/creatives/assistant (HTTP 503)";

/**
 * #2396 (CTO): an assistant turn answered 503 `AI_BUSY` that Try again recovered is a NOTE, not a FAIL. Each forgiven
 * console error needs its own `AI_BUSY` response; any other console error, or a 503 with another code, stays a FAIL.
 * @param {string[]} errors browser errors collected during Create
 * @param {number} busyTurns assistant responses that were 503 with code `AI_BUSY`
 * @returns {{ errors: string[], note: string | null }}
 */
export function forgiveRecoveredBusyTurns(errors, busyTurns) {
  let left = busyTurns;
  const kept = errors.filter((error) => !(error === ASSISTANT_BUSY_ERROR && left > 0 && left--));
  const forgiven = busyTurns - left;
  return { errors: kept, note: forgiven ? `NOTE Create assistant was busy (AI_BUSY) ${forgiven}×; Try again recovered it (#2396)` : null };
}
