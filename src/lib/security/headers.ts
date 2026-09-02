/**
 * OWASP-baseline HTTP response headers applied to every route via
 * `next.config.ts`. Kept dependency-free so it can be unit-tested and imported
 * from the Next config without pulling in app runtime code.
 *
 * A full Content-Security-Policy is intentionally omitted here: the app loads
 * from several origins (Supabase, Pollinations, the analytics host, Google
 * OAuth) and a mis-scoped CSP silently breaks those flows. These headers are
 * the safe, high-value subset with no functional risk.
 */
export const SECURITY_HEADERS: { key: string; value: string }[] = [
  // Stop browsers from MIME-sniffing a response away from its declared type.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Clickjacking protection — the app is never meant to be framed.
  { key: "X-Frame-Options", value: "DENY" },
  // Don't leak full URLs (which can carry ids) to third-party origins.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Deny powerful features the app doesn't use, and opt out of Topics.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
];
