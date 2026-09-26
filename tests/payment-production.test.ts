import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProductionCollectionPolicy, getProductionPaymentConfig } from "@/lib/payments/production-config";
import { getRazorpayTestConfig } from "@/lib/payments/razorpay-test";
import { createProductionPaymentClient } from "@/lib/payments/razorpay-production";

const policy = {
  version: "synthetic-terms-v1", approvalReference: "11111111-1111-4111-8111-111111111111",
  approvedAt: "2026-09-01T00:00:00Z", expiresAt: "2026-10-01T00:00:00Z",
  serviceScope: "Synthetic approved finite service scope; not customer terms.",
  invoiceTerms: "Synthetic invoice treatment.", refundTerms: "Synthetic refund terms.",
  automaticFundingApprovalReference: "22222222-2222-4222-8222-222222222222",
};
const environment = {
  PAYMENTS_LIVE_ENABLED: "true", NODE_ENV: "production", VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main",
  VERCEL_PROJECT_ID: "prj_fixture", PAYMENTS_LIVE_PROJECT_ID: "prj_fixture",
  NEXT_PUBLIC_SUPABASE_URL: "https://fixture.supabase.co", PAYMENTS_LIVE_SUPABASE_URL: "https://fixture.supabase.co",
  RAZORPAY_LIVE_KEY_ID: "rzp_live_fixture", RAZORPAY_LIVE_KEY_SECRET: "synthetic-checkout-secret",
  RAZORPAY_LIVE_ACCOUNT_ID: "acc_fixture", RAZORPAY_LIVE_WEBHOOK_SECRET: "synthetic-webhook-secret",
  PAYMENTS_LIVE_WEBHOOK_ID: "33333333-3333-4333-8333-333333333333",
};
const collection = { ...environment, PAYMENTS_LIVE_COLLECTION_ENABLED: "true", PAYMENTS_LIVE_POLICY_JSON: JSON.stringify(policy) };
const now = Date.parse("2026-09-26T00:00:00Z");

const sdkAxios: { defaults: { adapter: unknown } } = createRequire(createRequire(import.meta.url).resolve("razorpay"))("axios").default;
const originalAdapter = sdkAxios.defaults.adapter;
type TransportRequest = {
  url: string; method: string; data?: string; params?: Record<string, unknown>;
  auth: { username: string; password: string }; timeout: number; maxRedirects: number; maxContentLength: number; signal: AbortSignal;
};
const sdkRequest = vi.fn<(config: TransportRequest) => Promise<unknown>>();
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(now);
  sdkRequest.mockReset().mockRejectedValue(new Error("Unexpected SDK request"));
  sdkAxios.defaults.adapter = sdkRequest;
});
afterEach(() => { sdkAxios.defaults.adapter = originalAdapter; vi.restoreAllMocks(); });
function respondWith(data: unknown) {
  sdkRequest.mockImplementation(async config => ({ data, status: 200, statusText: "OK", headers: {}, config }));
}
const receipt = "44444444-4444-4444-8444-444444444444";
const providerOrder = { id: "order_fixture", entity: "order", receipt, amount: 1_000_000, amount_paid: 0, amount_due: 1_000_000, currency: "INR", status: "created" };
const payment = { id: "pay_fixture", entity: "payment", order_id: "order_fixture", amount: 1_000_000, currency: "INR", captured: true,
  status: "captured", amount_refunded: 0, refund_status: null };
const refund = { id: "rfnd_fixture", entity: "refund", payment_id: "pay_fixture", receipt, amount: 10_000, currency: "INR", status: "pending" };

describe("production payment boundaries", () => {
  it("defaults disabled and preserves the independent local test gate", () => {
    expect(() => getProductionPaymentConfig({})).toThrow("disabled");
    expect(() => getRazorpayTestConfig({ ...environment, PAYMENTS_TEST_ENABLED: "true" })).toThrow();
  });

  it.each([
    { PAYMENTS_LIVE_ENABLED: "false" }, { NODE_ENV: "test" }, { VERCEL_ENV: "preview" }, { VERCEL_TARGET_ENV: "staging" },
    { VERCEL_GIT_COMMIT_REF: "feature/payments" }, { VERCEL_PROJECT_ID: "prj_other" },
    { RAZORPAY_LIVE_KEY_ID: "rzp_test_fixture" }, { RAZORPAY_LIVE_KEY_SECRET: "" }, { RAZORPAY_LIVE_ACCOUNT_ID: "" },
    { PAYMENTS_LIVE_WEBHOOK_ID: "" }, { RAZORPAY_LIVE_WEBHOOK_SECRET: environment.RAZORPAY_LIVE_KEY_SECRET },
    { PAYMENTS_TEST_ENABLED: "true" }, { RAZORPAY_TEST_KEY_ID: "rzp_test_fixture" },
    { RAZORPAY_TEST_WEBHOOK_SECRET: "separate-synthetic-secret" }, { RAZORPAY_KEY_ID: "rzp_live_other" },
    { RAZORPAY_KEY_SECRET: environment.RAZORPAY_LIVE_KEY_SECRET },
    { NEXT_PUBLIC_SUPABASE_URL: "https://other.supabase.co" },
    { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", PAYMENTS_LIVE_SUPABASE_URL: "http://127.0.0.1:54321" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://fixture.supabase.co.evil.invalid", PAYMENTS_LIVE_SUPABASE_URL: "https://fixture.supabase.co.evil.invalid" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://user:secret@fixture.supabase.co", PAYMENTS_LIVE_SUPABASE_URL: "https://user:secret@fixture.supabase.co" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://fixture.supabase.co/path", PAYMENTS_LIVE_SUPABASE_URL: "https://fixture.supabase.co/path" },
  ])("rejects mismatched deployment or identity: %j", override => {
    expect(() => getProductionPaymentConfig({ ...environment, ...override })).toThrow("disabled");
  });

  it("allows recovery configuration while new collection is suspended", () => {
    expect(getProductionPaymentConfig(environment)).toMatchObject({ environment: "live", accountId: "acc_fixture" });
    expect(() => getProductionCollectionPolicy(environment, now)).toThrow("approved");
  });

  it("snapshots explicit policy without inventing missing terms", () => {
    const approved = getProductionCollectionPolicy(collection, now);
    expect(approved).toMatchObject(policy);
    expect(approved.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(approved)).toBe(true);
    expect(getProductionCollectionPolicy({ ...collection, PAYMENTS_LIVE_POLICY_JSON: JSON.stringify({
      ...policy, refundTerms: "Different synthetic terms",
    }) }, now).hash).not.toBe(approved.hash);
  });

  it.each([
    {}, { ...policy, serviceScope: "" }, { ...policy, invoiceTerms: "" }, { ...policy, refundTerms: "" },
    { ...policy, automaticFundingApprovalReference: undefined }, { ...policy, approvedAt: "2027-01-01T00:00:00Z" },
    { ...policy, expiresAt: "2026-09-26T00:00:00Z" }, { ...policy, extra: "unreviewed" },
  ])("blocks absent, stale or incomplete policy: %j", invalid => {
    expect(() => getProductionCollectionPolicy({ ...collection, PAYMENTS_LIVE_POLICY_JSON: JSON.stringify(invalid) }, now)).toThrow("approved");
  });

  it("rejects malformed/oversized policy and an invalid clock without leaking input", () => {
    for (const raw of ["{private details", "x".repeat(32_769)]) {
      expect(() => getProductionCollectionPolicy({ ...collection, PAYMENTS_LIVE_POLICY_JSON: raw }, now)).toThrow("approved");
    }
    expect(() => getProductionCollectionPolicy(collection, NaN)).toThrow("approved");
  });
});

describe("production official SDK adapter", () => {
  it("creates only the fixed annual order with approved policy and bounded transport", async () => {
    respondWith(providerOrder);
    const policyHash = getProductionCollectionPolicy(collection).hash;
    await expect(createProductionPaymentClient(collection).createOrder(receipt, policyHash)).resolves.toEqual(providerOrder);
    const request = sdkRequest.mock.calls[0][0];
    expect(request).toMatchObject({ method: "post", url: "/v1/orders", timeout: 15_000, maxRedirects: 0, maxContentLength: 1_048_576,
      auth: { username: environment.RAZORPAY_LIVE_KEY_ID, password: environment.RAZORPAY_LIVE_KEY_SECRET } });
    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(request.data!)).toMatchObject({ amount: 1_000_000, currency: "INR", receipt, partial_payment: false,
      notes: { policy_hash: policyHash, quote_version: "inr-annual-total-v1" } });
    expect(sdkRequest).toHaveBeenCalledTimes(1);
  });

  it("blocks order creation without approved current policy before any request", async () => {
    await expect(createProductionPaymentClient(environment).createOrder(receipt, "stale")).rejects.toThrow("approved");
    await expect(createProductionPaymentClient(collection).createOrder(receipt, "stale")).rejects.toThrow("approved");
    expect(sdkRequest).not.toHaveBeenCalled();
  });

  it("never retries an uncertain order or refund and does not expose provider errors", async () => {
    const client = createProductionPaymentClient({ ...collection, PAYMENTS_LIVE_REFUNDS_ENABLED: "true" });
    sdkRequest.mockRejectedValue({ response: { status: 500, data: { error: { description: "private provider details" } } } });
    await expect(client.createOrder(receipt, getProductionCollectionPolicy(collection).hash)).rejects.toThrow("unconfirmed");
    expect(sdkRequest).toHaveBeenCalledTimes(1);
    await expect(client.createRefund("pay_fixture", receipt, 10_000)).rejects.toThrow("unconfirmed");
    expect(sdkRequest).toHaveBeenCalledTimes(2);
  });

  it.each([{ amount: 100 }, { amount_due: 0 }, { amount_paid: 1 }, { receipt: "foreign" }, { status: "paid" }, { currency: "USD" }])(
    "rejects an inconsistent create response: %j", async override => {
      respondWith({ ...providerOrder, ...override });
      await expect(createProductionPaymentClient(collection).createOrder(receipt, getProductionCollectionPolicy(collection).hash)).rejects.toThrow("unconfirmed");
    },
  );

  it("recovers by exact receipt without issuing another create", async () => {
    respondWith({ entity: "collection", count: 1, items: [providerOrder] });
    await expect(createProductionPaymentClient(environment).findOrder(receipt)).resolves.toEqual(providerOrder);
    expect(sdkRequest.mock.calls[0][0]).toMatchObject({ method: "get", params: { receipt, count: 2, skip: 0 } });
    respondWith({ entity: "collection", count: 0, items: [] });
    await expect(createProductionPaymentClient(environment).findOrder(receipt)).resolves.toBeNull();
    expect(sdkRequest.mock.calls.every(([request]) => request.method === "get")).toBe(true);
  });

  it.each([
    { entity: "collection", count: 2, items: [providerOrder, { ...providerOrder, id: "order_other" }] },
    { entity: "collection", count: 0, items: [providerOrder] },
    { entity: "collection", count: 1, items: [{ ...providerOrder, receipt: "foreign" }] },
  ])("holds ambiguous or malformed receipt lookup: %j", async response => {
    respondWith(response);
    await expect(createProductionPaymentClient(environment).findOrder(receipt)).rejects.toThrow("unconfirmed");
  });

  it("validates read identities and strips unneeded customer/provider fields", async () => {
    const client = createProductionPaymentClient(environment);
    respondWith({ ...payment, email: "synthetic@example.invalid", card: { sensitive: "not retained" } });
    await expect(client.fetchPayment("pay_fixture")).resolves.toEqual(payment);
    await expect(client.fetchPayment("pay_other")).rejects.toThrow("unconfirmed");
    respondWith(providerOrder);
    await expect(client.fetchOrder("order_fixture")).resolves.toEqual(providerOrder);
    await expect(client.fetchOrder("order_other")).rejects.toThrow("unconfirmed");
  });

  it("enumerates only bounded, matching, unique order payments", async () => {
    const client = createProductionPaymentClient(environment);
    respondWith({ entity: "collection", count: 1, items: [payment] });
    await expect(client.fetchOrderPayments("order_fixture")).resolves.toEqual([payment]);
    await expect(client.fetchOrderPayments("order_other")).rejects.toThrow("unconfirmed");
    respondWith({ entity: "collection", count: 2, items: [payment, payment] });
    await expect(client.fetchOrderPayments("order_fixture")).rejects.toThrow("unconfirmed");
    respondWith({ entity: "collection", count: 100, items: Array.from({ length: 100 }, (_, index) => ({ ...payment, id: `pay_fixture${index}` })) });
    await expect(client.fetchOrderPayments("order_fixture")).rejects.toThrow("unconfirmed");
  });

  it("requires a separate refund enable gate and sends an explicit bounded amount and receipt", async () => {
    await expect(createProductionPaymentClient(environment).createRefund("pay_fixture", receipt, 10_000)).rejects.toThrow("disabled");
    expect(sdkRequest).not.toHaveBeenCalled();
    respondWith(refund);
    await expect(createProductionPaymentClient({ ...environment, PAYMENTS_LIVE_REFUNDS_ENABLED: "true" }).createRefund("pay_fixture", receipt, 10_000)).resolves.toEqual(refund);
    expect(JSON.parse(sdkRequest.mock.calls[0][0].data!)).toEqual({ amount: 10_000, receipt, speed: "normal" });
  });

  it.each([0, 99, -1, 1.5, NaN, Infinity, 1_000_001, Number.MAX_SAFE_INTEGER])("rejects invalid refund paise %s before a provider request", async amount => {
    await expect(createProductionPaymentClient({ ...environment, PAYMENTS_LIVE_REFUNDS_ENABLED: "true" }).createRefund("pay_fixture", receipt, amount)).rejects.toThrow();
    expect(sdkRequest).not.toHaveBeenCalled();
  });

  it("validates refund identity, pagination, amounts and currency", async () => {
    const client = createProductionPaymentClient({ ...environment, PAYMENTS_LIVE_REFUNDS_ENABLED: "true" });
    respondWith(refund);
    await expect(client.fetchRefund("pay_fixture", "rfnd_fixture")).resolves.toEqual(refund);
    await expect(client.fetchRefund("pay_other", "rfnd_fixture")).rejects.toThrow("unconfirmed");
    await expect(client.createRefund("pay_fixture", receipt, 20_000)).rejects.toThrow("unconfirmed");
    respondWith({ entity: "collection", count: 1, items: [refund] });
    await expect(client.fetchRefunds("pay_fixture", 100)).resolves.toEqual({ items: [refund], nextSkip: null });
    expect(sdkRequest.mock.calls.at(-1)![0].params).toMatchObject({ count: 100, skip: 100 });
    await expect(client.fetchRefunds("pay_other")).rejects.toThrow("unconfirmed");
    respondWith({ ...refund, currency: "USD" });
    await expect(client.fetchRefund("pay_fixture", "rfnd_fixture")).rejects.toThrow("unconfirmed");
  });
});