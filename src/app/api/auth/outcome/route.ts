import { observeRoute, recordProductEvent } from "@/lib/observability/logger";
import { authOutcomeSchema } from "@/lib/observability/auth-events";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const POST = observeRoute("/api/auth/outcome", "POST", handlePOST);

const MAX_BYTES = 512;

/**
 * How a browser sign-in step ended (#451 L4): password sign-in, sending a sign-in link, starting
 * Google. Callers are often signed out, so the body is a fixed enum (no email or message), it is
 * rate limited per address and overall, and a success counts only with a session.
 */
async function handlePOST(request: Request) {
  if (process.env.PRODUCT_LOGGING_ENABLED === "false") return new Response(null, { status: 204 });
  if (request.headers.get("origin") !== new URL(request.url).origin) return new Response(null, { status: 403 });
  if (request.headers.get("dnt") === "1" || request.headers.get("sec-gpc") === "1") return new Response(null, { status: 204 });
  // The platform sets x-real-ip and appends the caller to x-forwarded-for; a script can only prepend.
  const address = request.headers.get("x-real-ip")?.trim()
    || request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "unknown";
  const limited = await rateLimitResponse(`auth-outcome:${address}`, { limit: 20, windowMs: 60_000 })
    ?? await rateLimitResponse("auth-outcome:all", { limit: 600, windowMs: 60_000 });
  if (limited) return limited;

  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400 });
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BYTES) { await reader.cancel(); return new Response(null, { status: 413 }); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  const parsed = authOutcomeSchema.safeParse(await Promise.resolve().then(() => JSON.parse(text)).catch(() => null));
  if (!parsed.success) return new Response(null, { status: 400 });
  const outcome = parsed.data;
  // A real password sign-in carries its session; a "success" without one only inflates a count.
  if (outcome.outcome === "success") {
    const user = await (await createClient()).auth.getUser().then(({ data }) => data.user, () => null);
    if (!user) return new Response(null, { status: 204 });
  }
  recordProductEvent({ kind: "workflow", name: `auth.sign_in.${outcome.method}`, outcome: outcome.outcome,
    attributes: outcome.outcome === "failed" ? { errorCode: `AUTH_CLIENT:${outcome.code}` } : {} });
  return new Response(null, { status: 204 });
}
