import { observeRoute } from "@/lib/observability/logger";
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { connectIntentSchema, type ConnectIntent } from "@/lib/meta/connect-contracts";
import { ConnectionAccessError, requireOwnedBusiness } from "@/lib/meta/connection-access";
import { startSelectionChange } from "@/lib/meta/change-selection";
import { canUseMetaConnect } from "@/lib/meta/pilot-access";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function errorResponse(requestId: string, status: number, code: string, message: string, retryable = false) {
  return NextResponse.json(
    { ok: false, error: { code, message, retryable }, requestId },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function requestOriginAllowed(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return origin === new URL(getEnv().NEXT_PUBLIC_SITE_URL).origin;
  } catch {
    return false;
  }
}

export const POST = observeRoute("/api/meta/connections/change", "POST", handlePOST);

/** Lists the Page / ad-account pairs the saved Facebook grant allows, with no new Facebook login (#474). */
async function handlePOST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  if (!requestOriginAllowed(request)) return errorResponse(requestId, 403, "FORBIDDEN", "Request origin is not allowed.");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return errorResponse(requestId, 401, "UNAUTHENTICATED", "Sign in required.");
  if (!canUseMetaConnect(user.id)) return errorResponse(requestId, 403, "FORBIDDEN", "Meta connection is not enabled for this account.");

  const body = await request.json().catch(() => null) as { businessId?: unknown; intent?: unknown } | null;
  const businessId = typeof body?.businessId === "string" ? body.businessId.trim() : "";
  const parsedIntent = connectIntentSchema.safeParse(body?.intent);
  if (!businessId || !parsedIntent.success) {
    return errorResponse(requestId, 400, "INVALID_INPUT", "A valid business and connection intent are required.");
  }

  try {
    const business = await requireOwnedBusiness(businessId);
    const attempt = await startSelectionChange(business, parsedIntent.data as ConnectIntent);
    if (!attempt) return errorResponse(requestId, 409, "REAUTH_REQUIRED", "Reconnect Meta to choose another Page or ad account.");
    return NextResponse.json({ ok: true, data: attempt, requestId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ConnectionAccessError) {
      const status = error.code === "UNAUTHENTICATED" ? 401 : error.code === "NOT_FOUND" ? 404 : 403;
      return errorResponse(requestId, status, error.code, error.message);
    }
    return errorResponse(requestId, 503, "UNAVAILABLE", "We could not load your Meta Pages and ad accounts.", true);
  }
}
