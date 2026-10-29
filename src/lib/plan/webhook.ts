import { z } from "zod";
import { PLAN_PRICE_PAISE } from "@/lib/plan/status";

/**
 * #718 slice 2: the ₹999 plan's Payment Link events. They never enter the ad-money ledger
 * (`production_payment_event_receive`): Razorpay copies the link's notes onto its payment, so `notes.purpose` hints
 * at a plan payment, and `payment_link.*` events settle the month here. The note is only a hint: Standard Checkout
 * copies the payer's browser-supplied notes too, so a payment is skipped only when no ad-money order owns it.
 * Each event is re-checked against Razorpay before anything is written; replays are idempotent in SQL.
 */
export const PLAN_NOTES_PURPOSE = "adbrain_plan";

type PlanLink = { id: string; status: string; amountPaise: number; referenceId: string; paymentId: string | null };
export type PlanWebhookDeps = {
  fetchPlanLink: (linkId: string) => Promise<PlanLink>;
  /** From our own records (the Razorpay order's server-set receipt → a stored ad-money order); throws when unsure. */
  isAdMoneyPayment: (paymentId: string, providerOrderId: string | null) => Promise<boolean>;
  rpc: {
    (name: "plan_period_paid", args: { p_link_id: string; p_payment_id: string; p_paid_at: string }): Promise<unknown>;
    (name: "plan_period_expire", args: { p_link_id: string }): Promise<unknown>;
  };
  now?: () => Date;
};
export type PlanWebhookResult = "paid" | "duplicate" | "expired" | "ignored";

const planPaymentSchema = z.looseObject({
  payment: z.looseObject({ entity: z.looseObject({
    id: z.string().regex(/^pay_[A-Za-z0-9]{1,100}$/), order_id: z.string().regex(/^order_[A-Za-z0-9]{1,100}$/).nullish(),
    notes: z.looseObject({ purpose: z.literal(PLAN_NOTES_PURPOSE) }),
  }) }),
});
const linkEventSchema = z.looseObject({
  payment_link: z.looseObject({ entity: z.looseObject({ id: z.string().regex(/^plink_[A-Za-z0-9]{1,100}$/) }) }),
  payment: z.looseObject({ entity: z.looseObject({ created_at: z.number().int().positive().optional() }) }).optional(),
});

/** null: not a plan event, so the ad-money path handles it. */
export async function handlePlanWebhook(event: { event: string; payload: unknown }, deps: PlanWebhookDeps): Promise<PlanWebhookResult | null> {
  if (!event.event.startsWith("payment_link.")) {
    const hinted = planPaymentSchema.safeParse(event.payload);
    if (!hinted.success) return null;
    const { id, order_id: orderId } = hinted.data.payment.entity;
    // #1433 review: a forged note must not let an ad-money dispute or refund skip the ledger's holds.
    return await deps.isAdMoneyPayment(id, orderId ?? null) ? null : "ignored";
  }
  if (!["payment_link.paid", "payment_link.expired", "payment_link.cancelled"].includes(event.event)) return "ignored";
  const parsed = linkEventSchema.safeParse(event.payload);
  if (!parsed.success) return "ignored";
  const link = await deps.fetchPlanLink(parsed.data.payment_link.entity.id);
  if (link.amountPaise !== PLAN_PRICE_PAISE) return "ignored";
  if (event.event === "payment_link.paid") {
    if (link.status !== "paid" || !link.paymentId) return "ignored";
    const createdAt = parsed.data.payment?.entity.created_at;
    const paidAt = createdAt ? new Date(createdAt * 1000) : (deps.now?.() ?? new Date());
    const result = z.enum(["paid", "duplicate", "ignored"]).parse(await deps.rpc("plan_period_paid", {
      p_link_id: link.id, p_payment_id: link.paymentId, p_paid_at: paidAt.toISOString(),
    }));
    return result;
  }
  if (link.status !== "expired" && link.status !== "cancelled") return "ignored";
  return (await deps.rpc("plan_period_expire", { p_link_id: link.id })) === true ? "expired" : "ignored";
}
