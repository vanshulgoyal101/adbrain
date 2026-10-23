import { NextResponse } from "next/server";
import { z } from "zod";
import { observeRoute } from "@/lib/observability/logger";
import { ConnectionAccessError, requireOwnedBusiness } from "@/lib/meta/connection-access";
import { readWhatsAppStatus } from "@/lib/meta/whatsapp-status";
import { rateLimitResponse } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

/** #235 "Check again": the owner's WhatsApp link status for chat ads. Read-only. */
export const GET = observeRoute("/api/meta/whatsapp", "GET", async (request: Request) => {
  const parsed = z.uuid().safeParse(new URL(request.url).searchParams.get("businessId"));
  if (!parsed.success) return NextResponse.json({ error: "A business is required." }, { status: 400 });
  try {
    const context = await requireOwnedBusiness(parsed.data);
    const limited = await rateLimitResponse(`meta-whatsapp:${context.userId}`, { limit: 20, windowMs: 300_000 });
    if (limited) return limited;
    return NextResponse.json(await readWhatsAppStatus(parsed.data), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ConnectionAccessError && (error.code === "UNAUTHENTICATED" || error.code === "NOT_FOUND" || error.code === "FORBIDDEN")) {
      return NextResponse.json({ error: error.message }, { status: error.code === "UNAUTHENTICATED" ? 401 : 404 });
    }
    return NextResponse.json({ state: "unavailable" }, { headers: { "Cache-Control": "no-store" } });
  }
});
