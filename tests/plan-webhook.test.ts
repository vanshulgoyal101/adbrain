import { describe, expect, it, vi } from "vitest";
import { handlePlanWebhook, type PlanWebhookDeps } from "@/lib/plan/webhook";

const linkId = "plink_Fixture123";
const paidLink: { id: string; status: string; amountPaise: number; referenceId: string; paymentId: string | null } = { id: linkId, status: "paid", amountPaise: 99_900, referenceId: "44444444-4444-4444-8444-444444444444", paymentId: "pay_Plan1" };
function deps(link = paidLink, rpcResult: unknown = "paid") {
  const rpc = vi.fn(async () => rpcResult);
  const fetchPlanLink = vi.fn(async () => link);
  return { deps: { fetchPlanLink, rpc } as unknown as PlanWebhookDeps, rpc, fetchPlanLink };
}
const linkEvent = (event: string, createdAt = 1_793_000_000) => ({
  event, payload: { payment_link: { entity: { id: linkId, status: "paid" } }, payment: { entity: { id: "pay_Plan1", created_at: createdAt } } },
});

describe("plan webhook (#718)", () => {
  it("leaves every non-plan event to the ad-money path", async () => {
    const { deps: d, rpc } = deps();
    expect(await handlePlanWebhook({ event: "payment.captured", payload: { payment: { entity: { id: "pay_x", order_id: "order_x" } } } }, d)).toBeNull();
    expect(await handlePlanWebhook({ event: "refund.processed", payload: { refund: { entity: { id: "rfnd_x", payment_id: "pay_x" } } } }, d)).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("skips a captured plan payment (Razorpay copies the link's notes) without writing anything", async () => {
    const { deps: d, rpc, fetchPlanLink } = deps();
    for (const name of ["payment.captured", "order.paid", "payment.authorized", "payment.failed"]) {
      expect(await handlePlanWebhook({ event: name, payload: { payment: { entity: { id: "pay_Plan1", notes: { purpose: "adbrain_plan" } } } } }, d)).toBe("ignored");
    }
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchPlanLink).not.toHaveBeenCalled();
  });

  it("marks the month paid from Razorpay's own answer, at the payment's time", async () => {
    const { deps: d, rpc, fetchPlanLink } = deps();
    expect(await handlePlanWebhook(linkEvent("payment_link.paid"), d)).toBe("paid");
    expect(fetchPlanLink).toHaveBeenCalledWith(linkId);
    expect(rpc).toHaveBeenCalledWith("plan_period_paid", { p_link_id: linkId, p_payment_id: "pay_Plan1", p_paid_at: new Date(1_793_000_000_000).toISOString() });
  });

  it("passes on a replay as duplicate", async () => {
    const { deps: d } = deps(paidLink, "duplicate");
    expect(await handlePlanWebhook(linkEvent("payment_link.paid"), d)).toBe("duplicate");
  });

  it("ignores a paid event Razorpay doesn't confirm (not paid, no captured payment, wrong amount)", async () => {
    for (const link of [{ ...paidLink, status: "created" }, { ...paidLink, paymentId: null }, { ...paidLink, amountPaise: 100 }]) {
      const { deps: d, rpc } = deps(link);
      expect(await handlePlanWebhook(linkEvent("payment_link.paid"), d)).toBe("ignored");
      expect(rpc).not.toHaveBeenCalled();
    }
  });

  it("expires the month on an expired or cancelled link, and ignores partial payments", async () => {
    const { deps: d, rpc } = deps({ ...paidLink, status: "expired", paymentId: null }, true);
    expect(await handlePlanWebhook(linkEvent("payment_link.expired"), d)).toBe("expired");
    expect(rpc).toHaveBeenCalledWith("plan_period_expire", { p_link_id: linkId });
    expect(await handlePlanWebhook(linkEvent("payment_link.partially_paid"), deps().deps)).toBe("ignored");
    expect(await handlePlanWebhook({ event: "payment_link.paid", payload: { payment_link: { entity: { id: "not-a-link" } } } }, deps().deps)).toBe("ignored");
  });

  it("lets a Razorpay outage fail the webhook so Razorpay retries it", async () => {
    const d = { fetchPlanLink: vi.fn(async () => { throw new Error("down"); }), rpc: vi.fn() } as unknown as PlanWebhookDeps;
    await expect(handlePlanWebhook(linkEvent("payment_link.paid"), d)).rejects.toThrow("down");
  });
});
