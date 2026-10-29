/** Live Create stream timing (#666), shared by the route and the page. */

/** The route writes a blank line this often while ads are being made. */
export const CREATE_HEARTBEAT_MS = 15_000;
/** Silence the page accepts once the stream has sent a heartbeat. */
export const CREATE_IDLE_MS = 60_000;
/** Silence the page accepts from a stream with no heartbeat yet: past the route's 300 s maxDuration. */
export const CREATE_IDLE_NO_HEARTBEAT_MS = 330_000;

/**
 * #1123: when the first pass saves fewer ads than asked, one top-up round retries the missing ones.
 * It starts only if the first pass ended within this time (paid partial batches end at ~40 s)...
 */
export const CREATE_TOP_UP_START_MS = 60_000;
/** ...and is cut off after this long: one concept, one repair and one image (paid batches take ~43 s). */
export const CREATE_TOP_UP_BUDGET_MS = 45_000;
/**
 * #1547: a sales visit's (+prospect) free pictures retry until this long after the request started, leaving room to
 * save before the route's 300 s limit, and only if at least one free picture slot (about 45 s) is left.
 */
export const PROSPECT_PICTURE_RETRY_END_MS = 250_000;
export const PROSPECT_PICTURE_RETRY_MIN_MS = 45_000;
