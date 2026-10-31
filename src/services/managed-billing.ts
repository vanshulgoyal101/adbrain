import { billingDeps, checkFunding, invitePayer, type BillingCheck, type PayerInvite } from "@/lib/meta/managed-billing";
import { provisionErrorCode } from "@/lib/meta/managed-provision";

export type { BillingCheck, FundingReason, PayerInvite, PayerStatus } from "@/lib/meta/managed-billing";

export type ManagedBillingAction = { action: "invite"; email: string } | { action: "check" };
export type ManagedBillingOutcome =
  | { ok: true; data: BillingCheck | PayerInvite }
  | { ok: false; code: string; retryable: boolean };

/** #2359 (#1792): the route-facing card step; Meta failures come back as the stable codes provisioning uses. */
export async function runManagedBilling(businessId: string, request: ManagedBillingAction): Promise<ManagedBillingOutcome> {
  try {
    const deps = billingDeps(businessId);
    return { ok: true, data: request.action === "invite" ? await invitePayer({ email: request.email }, deps) : await checkFunding(deps) };
  } catch (error) {
    return { ok: false, ...provisionErrorCode(error) };
  }
}
