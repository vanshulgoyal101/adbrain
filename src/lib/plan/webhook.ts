import { z } from "zod";
import { PLAN_PRICE_PAISE } from "@/lib/plan/status";
import { recordProductEvent } from "@/lib/observability/logger";

/**
 * #718 slice 2: the ₹999 plan's Payment Link events. They never enter the ad-money ledger
 * (`production_payment_event_receive`): Razorpay copies the link's notes onto its payment, so a captured plan
 * payment is recognised by `notes.purpose` and skipped, and `payment_link.*` events settle the month here.
 * Each event is re-checked against Razorpay before anything is written; replays are idempotent in SQL.
 */
export const PLAN_NOTES_PURPOSE = "adbrain_plan";

type PlanLink = { id: string; status: string; amountPaise: number; referenceId: string; paymentId: string | null; paidAt?: string | null };
export type PlanWebhookDeps = {
  fetchPlanLink: (linkId: string) => Promise<PlanLink>;
  rpc: {
    (name: "plan_period_paid", args: { p_link_id: string; p_payment_id: string; p_paid_at: string }): Promise<unknown>;
    (name: "plan_period_expire", args: { p_link_id: string }): Promise<unknown>;
  };
};
export type PlanWebhookResult = "paid" | "duplicate" | "expired" | "ignored";

const planPaymentSchema = z.looseObject({
  payment: z.looseObject({ entity: z.looseObject({ notes: z.looseObject({ purpose: z.literal(PLAN_NOTES_PURPOSE) }) }) }),
});
const linkEventSchema = z.looseObject({
  payment_link: z.looseObject({ entity: z.looseObject({ id: z.string().regex(/^plink_[A-Za-z0-9]{1,100}$/) }) }),
  payment: z.looseObject({ entity: z.looseObject({ created_at: z.number().int().positive().optional() }) }).optional(),
});

/** null: not a plan event, so the ad-money path handles it. */
export async function handlePlanWebhook(event: { event: string; payload: unknown }, deps: PlanWebhookDeps): Promise<PlanWebhookResult | null> {
  if (!event.event.startsWith("payment_link.")) return planPaymentSchema.safeParse(event.payload).success ? "ignored" : null;
  if (!["payment_link.paid", "payment_link.expired", "payment_link.cancelled"].includes(event.event)) return "ignored";
  const parsed = linkEventSchema.safeParse(event.payload);
  if (!parsed.success) return "ignored";
  const link = await deps.fetchPlanLink(parsed.data.payment_link.entity.id);
  if (link.amountPaise !== PLAN_PRICE_PAISE) return "ignored";
  if (event.event === "payment_link.paid") {
    if (link.status !== "paid" || !link.paymentId) return "ignored";
    const createdAt = parsed.data.payment?.entity.created_at;
    const paidAt = link.paidAt ?? (createdAt ? new Date(createdAt * 1000).toISOString() : null);
    if (!paidAt) throw new Error("Plan payment capture time is unavailable.");
    const result = z.enum(["paid", "duplicate", "ignored"]).parse(await deps.rpc("plan_period_paid", {
      p_link_id: link.id, p_payment_id: link.paymentId, p_paid_at: z.iso.datetime().parse(paidAt),
    }));
    // #1583: Razorpay holds a captured ₹999 that no month took (a second payment, or the period is gone): refund it.
    if (result === "ignored") recordProductEvent({ kind: "workflow", name: "plan.payment_unmatched", outcome: "failed",
      attributes: { provider: "razorpay", paymentLinkId: link.id, paymentId: link.paymentId } });
    return result;
  }
  if (link.status !== "expired" && link.status !== "cancelled") return "ignored";
  return (await deps.rpc("plan_period_expire", { p_link_id: link.id })) === true ? "expired" : "ignored";
}
