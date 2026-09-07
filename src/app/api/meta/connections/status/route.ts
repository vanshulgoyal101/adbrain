import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ConnectionAccessError, requireOwnedBusiness } from "@/lib/meta/connection-access";
import {
  type Capabilities,
  type ConnectionDTO,
} from "@/lib/meta/connect-contracts";

export const runtime = "nodejs";

const unknownCapabilities: Capabilities = {
  canReadInsights: { state: "unknown", blockers: [] },
  canReadLeads: { state: "unknown", blockers: [] },
  canCreatePaused: { state: "unknown", blockers: [] },
  canActivate: { state: "unknown", blockers: [] },
};

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const businessId = request.nextUrl.searchParams.get("businessId")?.trim();
  if (!businessId) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_INPUT", message: "Business is required.", retryable: false }, requestId },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    await requireOwnedBusiness(businessId);
    const { data, error } = await createAdminClient()
      .from("meta_connections")
      .select("business_id, generation, authorization_status, meta_business_id, ad_account_id, page_id, account_name, page_name, currency, timezone_name, capabilities, last_checked_at")
      .eq("business_id", businessId)
      .maybeSingle();
    if (error) throw error;
    const connection: ConnectionDTO = {
      businessId,
      generation: data?.generation ?? 0,
      authorization: data?.authorization_status ?? "disconnected",
      selected: data?.ad_account_id && data.page_id
        ? {
            metaBusinessId: data.meta_business_id,
            adAccountId: data.ad_account_id,
            accountName: data.account_name ?? "Meta ad account",
            pageId: data.page_id,
            pageName: data.page_name ?? "Facebook Page",
            currency: data.currency ?? "INR",
            timezoneName: data.timezone_name ?? "Asia/Kolkata",
          }
        : null,
      capabilities: (data?.capabilities as Capabilities | null) ?? unknownCapabilities,
      checkedAt: data?.last_checked_at ?? null,
    };
    return NextResponse.json({ ok: true, data: connection, requestId }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof ConnectionAccessError) {
        const status = error.code === "UNAUTHENTICATED" ? 401 : error.code === "NOT_FOUND" ? 404 : error.code === "FORBIDDEN" ? 403 : 503;
        return NextResponse.json(
          { ok: false, error: { code: error.code, message: error.message, retryable: status >= 500 }, requestId },
          { status, headers: { "Cache-Control": "no-store" } },
        );
      }
    return NextResponse.json(
      { ok: false, error: { code: "UNAVAILABLE", message: "Meta connection status is unavailable.", retryable: true }, requestId },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}