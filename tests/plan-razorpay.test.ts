import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProductionPaymentClient } from "@/lib/payments/razorpay-production";

// #718 slice 2: the monthly ₹999 plan is a Razorpay Payment Link (no auto-debit), on the live client's bounded transport.
const environment = {
  PAYMENTS_LIVE_ENABLED: "true", NODE_ENV: "production", VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main",
  VERCEL_PROJECT_ID: "prj_fixture", PAYMENTS_LIVE_PROJECT_ID: "prj_fixture",
  NEXT_PUBLIC_SUPABASE_URL: "https://fixture.supabase.co", PAYMENTS_LIVE_SUPABASE_URL: "https://fixture.supabase.co",
  RAZORPAY_LIVE_KEY_ID: "rzp_live_fixture", RAZORPAY_LIVE_KEY_SECRET: "synthetic-checkout-secret",
  RAZORPAY_LIVE_ACCOUNT_ID: "acc_fixture", RAZORPAY_LIVE_WEBHOOK_SECRET: "synthetic-webhook-secret",
  PAYMENTS_LIVE_WEBHOOK_ID: "33333333-3333-4333-8333-333333333333",
};
const sdkAxios: { defaults: { adapter: unknown } } = createRequire(createRequire(import.meta.url).resolve("razorpay"))("axios").default;
const originalAdapter = sdkAxios.defaults.adapter;
type TransportRequest = { url: string; method: string; data?: string; timeout: number; maxRedirects: number };
const sdkRequest = vi.fn<(config: TransportRequest) => Promise<unknown>>();
beforeEach(() => { sdkRequest.mockReset().mockRejectedValue(new Error("Unexpected SDK request")); sdkAxios.defaults.adapter = sdkRequest; });
afterEach(() => { sdkAxios.defaults.adapter = originalAdapter; vi.restoreAllMocks(); });
const respondWith = (data: unknown) => sdkRequest.mockImplementation(async (config) => ({ data, status: 200, statusText: "OK", headers: {}, config }));

const periodId = "44444444-4444-4444-8444-444444444444";
const businessId = "55555555-5555-4555-8555-555555555555";
const link = (extra: Record<string, unknown> = {}) => ({
  id: "plink_Fixture123", amount: 99_900, amount_paid: 0, currency: "INR", status: "created", reference_id: periodId,
  short_url: "https://rzp.io/i/fixture", payments: null, ...extra,
});

describe("plan payment links (#718)", () => {
  it("creates one ₹999 link per period with reminders, the owner's contact and no auto-debit", async () => {
    respondWith(link());
    const created = await createProductionPaymentClient(environment).createPlanLink({
      periodId, businessId, email: "owner@example.com", phone: "+919876543210", expireBy: 1_800_000_000,
    });
    expect(created).toEqual({ id: "plink_Fixture123", shortUrl: "https://rzp.io/i/fixture" });
    const request = sdkRequest.mock.calls[0][0];
    expect(request.url).toContain("/payment_links");
    expect(request.timeout).toBe(15_000);
    expect(JSON.parse(request.data!)).toEqual({
      amount: 99_900, currency: "INR", accept_partial: false, reference_id: periodId, expire_by: 1_800_000_000,
      description: "AdBrain plan, one month", reminder_enable: true,
      customer: { email: "owner@example.com", contact: "+919876543210" }, notify: { email: true, sms: true },
      notes: { purpose: "adbrain_plan", business_id: businessId, period_id: periodId },
    });
  });

  it("leaves out a missing contact and doesn't notify on it", async () => {
    respondWith(link());
    await createProductionPaymentClient(environment).createPlanLink({ periodId, businessId, email: null, phone: "+919876543210", expireBy: 1_800_000_000 });
    expect(JSON.parse(sdkRequest.mock.calls[0][0].data!)).toMatchObject({ customer: { contact: "+919876543210" }, notify: { email: false, sms: true } });
  });

  it("refuses a provider answer for another amount or period", async () => {
    respondWith(link({ amount: 100 }));
    await expect(createProductionPaymentClient(environment).createPlanLink({ periodId, businessId, email: null, phone: null, expireBy: 1_800_000_000 })).rejects.toThrow();
    respondWith(link({ reference_id: "another" }));
    await expect(createProductionPaymentClient(environment).createPlanLink({ periodId, businessId, email: null, phone: null, expireBy: 1_800_000_000 })).rejects.toThrow();
  });

  it("reads a paid link with its captured payment", async () => {
    respondWith(link({ status: "paid", amount_paid: 99_900, payments: [{ payment_id: "pay_Fixture1", status: "captured", amount: 99_900 }] }));
    await expect(createProductionPaymentClient(environment).fetchPlanLink("plink_Fixture123"))
      .resolves.toEqual({ id: "plink_Fixture123", status: "paid", amountPaise: 99_900, referenceId: periodId, paymentId: "pay_Fixture1" });
    await expect(createProductionPaymentClient(environment).fetchPlanLink("not-a-link")).rejects.toThrow();
  });
});
