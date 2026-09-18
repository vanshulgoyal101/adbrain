import { createClient } from "@/lib/supabase/server";
import { getPrimaryBusiness } from "@/lib/supabase/queries";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { clientEventSchema } from "@/lib/observability/client-events";
import { observeRoute, recordProductEvent } from "@/lib/observability/logger";

export const runtime = "nodejs";
export const POST = observeRoute("/api/events", "POST", handlePOST);

async function handlePOST(request: Request) {
  if (process.env.PRODUCT_LOGGING_ENABLED === "false") return new Response(null, { status: 204 });
  if (request.headers.get("origin") !== new URL(request.url).origin) return new Response(null, { status: 403 });
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return new Response(null, { status: 401 });
  if (request.headers.get("dnt") === "1" || request.headers.get("sec-gpc") === "1") return new Response(null, { status: 204 });
  const limited = await rateLimitResponse(`product-events:${user.id}`, { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400 });
  let text = "";
  let bytes = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 2048) { await reader.cancel(); return new Response(null, { status: 413 }); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  const parsed = clientEventSchema.safeParse(await Promise.resolve().then(() => JSON.parse(text)).catch(() => null));
  if (!parsed.success) return new Response(null, { status: 400 });
  const business = await getPrimaryBusiness();
  recordProductEvent({ kind: "client", name: parsed.data.name, outcome: parsed.data.name === "page.view" ? "success" : "failed",
    businessId: business?.id, attributes: { route: parsed.data.page } });
  return new Response(null, { status: 204 });
}