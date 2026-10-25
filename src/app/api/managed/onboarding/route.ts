import { observeRoute, currentRequestId } from "@/lib/observability/logger";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { managedAccountsEnabledFor } from "@/lib/meta/managed-account";
import { createClient } from "@/lib/supabase/server";
import { ConnectionAccessError, requireOwnedBusiness } from "@/lib/meta/connection-access";
import { getCustomerBalance } from "@/lib/payments/customer-balance";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const fail = (status: number, code: string, message: string) =>
  NextResponse.json({ ok: false, error: { code, message, retryable: status >= 500 }, requestId: currentRequestId() }, { status, headers: { "Cache-Control": "no-store" } });

export const GET = observeRoute("/api/managed/onboarding", "GET", handleGET);

/** #526: the owner's onboarding progress: their managed-account ledger row and whether they have paid. */
async function handleGET(request: NextRequest) {
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!managedAccountsEnabledFor(user)) return fail(404, "NOT_ENABLED", "Managed accounts are not enabled.");
  const businessId = z.uuid().safeParse(request.nextUrl.searchParams.get("businessId"));
  if (!businessId.success) return fail(400, "INVALID_INPUT", "A business is required.");
  let actor;
  try {
    actor = await requireOwnedBusiness(businessId.data);
  } catch (error) {
    if (error instanceof ConnectionAccessError) {
      return fail(error.code === "UNAUTHENTICATED" ? 401 : error.code === "NOT_FOUND" ? 404 : 403, error.code, error.message);
    }
    return fail(503, "UNAVAILABLE", "Business access could not be checked.");
  }
  const { data: row, error } = await createAdminClient().from("managed_meta_accounts")
    .select("state, funding_state, page_id, child_business_id, ad_account_id, waba_id, phone_number_id, whatsapp_number_e164, last_error")
    .eq("business_id", actor.businessId).maybeSingle();
  if (error) return fail(503, "UNAVAILABLE", "Onboarding progress could not be read.");
  // Paid = captured payments net of refunds. Unreadable (payments not configured, reconciliation) counts as not yet.
  const paid = await getCustomerBalance(actor)
    .then((balance) => balance.capturedPaise - balance.refundedPaise > 0)
    .catch(() => false);
  return NextResponse.json({ ok: true, data: { row, paid }, requestId: currentRequestId() }, { headers: { "Cache-Control": "no-store" } });
}
