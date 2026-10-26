const WARN_MS = 7 * 86_400_000;

/** #757: the date to reconnect Facebook by, when the token stops working within 7 days; otherwise null. */
export function reconnectByLabel(tokenExpiresAt: string | null, now = Date.now()): string | null {
  const expires = tokenExpiresAt ? Date.parse(tokenExpiresAt) : Number.NaN;
  if (!Number.isFinite(expires) || expires <= now || expires - now > WARN_MS) return null;
  return new Date(expires).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
