import { recordProductEvent } from "@/lib/observability/logger";
import { isPlanBillingEnabled, readPlan } from "@/lib/plan/store";

export const PLAN_UNPAID_MESSAGE = "Your ₹999 plan payment is due. Running ads keep running. Pay in Settings to make new ads and campaigns.";

/**
 * #718 slice 2 (CEO): when an own-account plan is unpaid, only *new* ads and campaigns wait; running ads, edits,
 * pauses and activation never come here. Fails open: if the plan can't be read, the request goes ahead, so billing
 * can never break the core loop.
 */
export async function planGate(businessId: string, now = new Date()): Promise<{ status: 402; code: "PLAN_UNPAID"; error: string } | null> {
  if (!isPlanBillingEnabled()) return null;
  try {
    const { status } = await readPlan(businessId, now);
    if (status.state !== "unpaid") return null;
    recordProductEvent({ kind: "action", name: "plan.gate", outcome: "rejected", businessId, attributes: { errorCode: "PLAN_UNPAID" } });
    return { status: 402, code: "PLAN_UNPAID", error: PLAN_UNPAID_MESSAGE };
  } catch {
    recordProductEvent({ kind: "system", name: "plan.gate", outcome: "failed", businessId, attributes: { errorCode: "PLAN_UNAVAILABLE" } });
    return null;
  }
}
