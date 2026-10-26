/** Live Create stream timing (#666), shared by the route and the page. */

/** The route writes a blank line this often while ads are being made. */
export const CREATE_HEARTBEAT_MS = 15_000;
/** Silence the page accepts once the stream has sent a heartbeat. */
export const CREATE_IDLE_MS = 60_000;
/** Silence the page accepts from a stream with no heartbeat yet: past the route's 300 s maxDuration. */
export const CREATE_IDLE_NO_HEARTBEAT_MS = 330_000;
