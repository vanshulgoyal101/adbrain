/**
 * OWASP-baseline HTTP response headers applied to every route via
 * `next.config.ts`. Kept dependency-free so it can be unit-tested and imported
 * from the Next config without pulling in app runtime code.
 *
 * The CSP deliberately keeps Next's inline runtime allowance for now. Removing
 * it requires a nonce threaded through every Next document response; silently
 * blocking hydration would be worse than documenting the current boundary.
 */
export function getSecurityHeaders(
  supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
    ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
    : "https://*.supabase.co",
): { key: string; value: string }[] {
  const trustedSupabaseOrigin = supabaseHost.replace(/\/$/, "");
  return [
    {
      key: "Content-Security-Policy",
      value: [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "script-src 'self' 'unsafe-inline' https://vanshul.com",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "font-src 'self' data:",
        `connect-src 'self' ${trustedSupabaseOrigin} https://*.supabase.co https://vanshul.com https://graph.facebook.com`,
        "frame-src 'self' https://accounts.google.com https://www.facebook.com",
        "worker-src 'self' blob:",
        "manifest-src 'self'",
      ].join("; "),
    },
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
}

export const SECURITY_HEADERS = getSecurityHeaders();
