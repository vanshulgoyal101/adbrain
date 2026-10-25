import { observeRoute, currentRequestId } from "@/lib/observability/logger";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { ConnectionAccessError, requireOwnedBusiness } from "@/lib/meta/connection-access";
import { checkManagedWhatsApp } from "@/lib/meta/managed-whatsapp";

export const runtime = "nodejs";

const fail = (status: number, code: string, message: string) =>
  NextResponse.json({ ok: false, error: { code, message, retryable: status >= 500 }, requestId: currentRequestId() }, { status, headers: { "Cache-Control": "no-store" } });

export const POST = observeRoute("/api/managed/whatsapp", "POST", handlePOST);

/** #524 v1: 'Check again' after the owner links WhatsApp to their Page; records and binds the Page-linked number. */
async function handlePOST(request: Request) {
  if (!getEnv().MANAGED_ACCOUNTS_ENABLED) return fail(404, "NOT_ENABLED", "Managed accounts are not enabled.");
  const body = z.object({ businessId: z.uuid() }).safeParse(await request.json().catch(() => null));
  if (!body.success) return fail(400, "INVALID_INPUT", "A business is required.");
  let actor;
  try {
    actor = await requireOwnedBusiness(body.data.businessId);
  } catch (error) {
    if (error instanceof ConnectionAccessError) {
      return fail(error.code === "UNAUTHENTICATED" ? 401 : error.code === "NOT_FOUND" ? 404 : 403, error.code, error.message);
    }
    return fail(503, "UNAVAILABLE", "Business access could not be checked.");
  }
  try {
    const data = await checkManagedWhatsApp(actor.businessId);
    return NextResponse.json({ ok: true, data, requestId: currentRequestId() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return fail(503, "UNAVAILABLE", "We couldn't check your Page's WhatsApp just now. Try again.");
  }
}
