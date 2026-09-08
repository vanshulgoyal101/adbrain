import { NextResponse, type NextRequest } from "next/server";
import {
  ConnectionAccessError,
  getConnectionStatus,
  requireOwnedBusiness,
  recheckMetaConnection,
} from "@/lib/meta/connection-access";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const body = await request.json().catch(() => null) as {
    businessId?: unknown;
    expectedGeneration?: unknown;
  } | null;
  const businessId = typeof body?.businessId === "string" ? body.businessId.trim() : "";
  if (!businessId || (body?.expectedGeneration !== undefined && !Number.isSafeInteger(body.expectedGeneration))) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_INPUT", message: "A valid business is required.", retryable: false }, requestId },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const business = await requireOwnedBusiness(businessId);
    const before = await getConnectionStatus(business);
    if (body?.expectedGeneration !== undefined && body.expectedGeneration !== before.generation) {
      return NextResponse.json(
        { ok: false, error: { code: "CONFLICT", message: "Meta connection changed; review again.", retryable: true }, requestId },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (before.authorization !== "connected" || !before.selected) {
      return NextResponse.json({ ok: true, data: before, requestId }, { headers: { "Cache-Control": "no-store" } });
    }

    const data = await recheckMetaConnection(business, before.generation);
    return NextResponse.json({ ok: true, data, requestId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ConnectionAccessError) {
      const status = error.code === "UNAUTHENTICATED" ? 401 : error.code === "NOT_FOUND" ? 404 : error.code === "FORBIDDEN" ? 403 : error.code === "CONFLICT" ? 409 : 503;
      return NextResponse.json(
        { ok: false, error: { code: error.code, message: error.message, retryable: status >= 500 }, requestId },
        { status, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { ok: false, error: { code: "REAUTH_REQUIRED", message: "Reconnect Meta to continue.", retryable: false }, requestId },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}