import { createHmac } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/payments/test/orders/route";
import { POST as verify } from "@/app/api/payments/test/verify/route";
import { POST as webhook } from "@/app/api/payments/test/webhook/route";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), createOrder: vi.fn(), fetchOrder: vi.fn(), fetchPayment: vi.fn(), rateLimit: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: mocks.rateLimit }));
vi.mock("@/lib/payments/razorpay-test", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/payments/razorpay-test")>(),
  createRazorpayTestClient: () => ({ createOrder: mocks.createOrder, fetchOrder: mocks.fetchOrder, fetchPayment: mocks.fetchPayment }),
}));
const orderId = "11111111-1111-4111-8111-111111111111";
const businessId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const secret = "checkout-fixture-secret";
const webhookSecret = "separate-webhook-fixture-secret";
const saved = { id: orderId, business_id: businessId, user_id: userId, account_id: "acc_fixture", key_id: "rzp_test_fixture",
  environment: "test", amount_paise: 1_000_000, currency: "INR", state: "created", provider_order_id: "order_fixture", payment_id: null };
const payment = { id: "pay_fixture", entity: "payment", order_id: "order_fixture", amount: 1_000_000, currency: "INR", captured: true,
  status: "captured", amount_refunded: 0, refund_status: null };
const signature = createHmac("sha256", secret).update("order_fixture|pay_fixture").digest("hex");
function request(path: string, body: unknown, origin = "http://localhost:3000") {
  return new Request(`http://localhost:3000/api/payments/test/${path}`, {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
  });
}
function webhookRequest(payload = {}, signatureOverride?: string) {
  const raw = JSON.stringify({ account_id: "acc_fixture", event: "payment.captured", payload: { payment: { entity: { id: "pay_fixture" } } }, ...payload });
  return new Request("http://localhost:3000/api/payments/test/webhook", { method: "POST", body: raw,
    headers: { "x-razorpay-event-id": "event_fixture", "x-razorpay-signature": signatureOverride ?? createHmac("sha256", webhookSecret).update(raw).digest("hex") } });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("PAYMENTS_TEST_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("RAZORPAY_TEST_KEY_ID", "rzp_test_fixture");
  vi.stubEnv("RAZORPAY_TEST_KEY_SECRET", secret);
  vi.stubEnv("RAZORPAY_TEST_ACCOUNT_ID", "acc_fixture");
  vi.stubEnv("RAZORPAY_TEST_WEBHOOK_SECRET", webhookSecret);
  mocks.getUser.mockResolvedValue({ data: { user: { id: userId } } });
  mocks.rateLimit.mockResolvedValue(null);
  mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => ({ error: null, data:
    name === "razorpay_test_order_claim" ? { claimed: true, order: { ...saved, state: "creating", provider_order_id: null } }
      : name === "razorpay_test_order_observe" ? { ...saved, state: args.p_outcome === "captured" ? "captured" : args.p_outcome === "pending" ? "created" : "needs_reconciliation" }
        : saved,
  }));
  mocks.createOrder.mockResolvedValue({ id: "order_fixture" });
  mocks.fetchPayment.mockResolvedValue(payment);
  mocks.fetchOrder.mockResolvedValue({ id: "order_fixture", receipt: orderId, amount: 1_000_000, amount_paid: 1_000_000, amount_due: 0, status: "paid", currency: "INR" });
});
afterEach(() => vi.unstubAllEnvs());

describe("isolated Razorpay test checkout", () => {
  it.each([["PAYMENTS_TEST_ENABLED", "false"], ["RAZORPAY_TEST_KEY_ID", "rzp_live_fixture"],
    ["NEXT_PUBLIC_SUPABASE_URL", "https://production.supabase.co"], ["NODE_ENV", "production"], ["VERCEL_ENV", "preview"]])(
    "disables every endpoint for %s=%s", async (name, value) => {
    vi.stubEnv(name, value);
    expect((await POST(request("orders", {}))).status).toBe(404);
    expect((await GET(new Request(`http://localhost:3000/api/payments/test/orders?orderId=${orderId}`))).status).toBe(404);
    expect((await verify(request("verify", {}))).status).toBe(404);
    expect((await webhook(webhookRequest())).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.createOrder).not.toHaveBeenCalled();
  });
  it("requires authentication and same-origin mutations", async () => {
    expect((await POST(request("orders", {}, "https://other.invalid"))).status).toBe(403);
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect((await POST(request("orders", {}))).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("claims before provider creation and never exposes secret keys or spend authority", async () => {
    const response = await POST(request("orders", { businessId, idempotencyKey: orderId }));
    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data).toMatchObject({ environment: "test", amountPaise: 1_000_000, canActivateCampaign: false, spendablePaise: 0, checkout: { order_id: "order_fixture", key: "rzp_test_fixture", name: "Vanshul Goyal" } });
    expect(JSON.stringify(data)).not.toContain(secret);
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.createOrder.mock.invocationCallOrder[0]);
  });
  it("replays stored intents without another provider request", async () => {
    mocks.rpc.mockResolvedValue({ data: { claimed: false, order: saved }, error: null });
    expect((await POST(request("orders", { businessId, idempotencyKey: orderId }))).status).toBe(200);
    expect(mocks.createOrder).not.toHaveBeenCalled();
  });
  it("refuses browser-supplied amounts and fails before provider access when persistence fails", async () => {
    expect((await POST(request("orders", { businessId, idempotencyKey: orderId, amount: 1 }))).status).toBe(400);
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "database-private-detail" } });
    const response = await POST(request("orders", { businessId, idempotencyKey: orderId }));
    expect(response.status).toBe(503);
    expect(mocks.createOrder).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("database-private-detail");
  });
  it("holds uncertain creation instead of retrying it", async () => {
    mocks.createOrder.mockRejectedValue(new Error("timeout"));
    const response = await POST(request("orders", { businessId, idempotencyKey: orderId }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ orderId, status: "needs_reconciliation", spendablePaise: 0 });
    expect(mocks.createOrder).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("razorpay_test_order_result", { p_order_id: orderId, p_provider_order_id: null });
  });
  it("reads only an owned order", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect((await GET(new Request(`http://localhost:3000/api/payments/test/orders?orderId=${orderId}`))).status).toBe(404);
    expect(mocks.rpc).toHaveBeenCalledWith("razorpay_test_order_get", { p_order_id: orderId, p_user_id: userId });
  });
  it("rejects a forged checkout callback before provider lookup", async () => {
    expect((await verify(request("verify", { orderId, paymentId: "pay_fixture", signature: "0".repeat(64) }))).status).toBe(400);
    expect(mocks.fetchPayment).not.toHaveBeenCalled();
  });
  it("rejects a mismatched callback order even when the stored-order signature is valid", async () => {
    expect((await verify(request("verify", { orderId, paymentId: "pay_fixture", providerOrderId: "order_other", signature }))).status).toBe(400);
    expect(mocks.fetchPayment).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls.some(([name]) => name === "razorpay_test_order_observe")).toBe(false);
  });
  it.each([
    { orderId, paymentId: "pay_fixture" },
    { orderId, signature },
    { paymentId: "pay_fixture", signature },
  ])("rejects missing verification fields without recording payment: %j", async body => {
    expect((await verify(request("verify", body))).status).toBe(400);
    expect(mocks.fetchPayment).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls.some(([name]) => name === "razorpay_test_order_observe")).toBe(false);
  });
  it("verifies capture from the provider rather than the browser", async () => {
    const response = await verify(request("verify", { orderId, paymentId: "pay_fixture", providerOrderId: "order_fixture", signature }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "captured", checkout: null, spendablePaise: 0 });
    expect(mocks.rpc).toHaveBeenCalledWith("razorpay_test_order_observe", expect.objectContaining({ p_outcome: "captured", p_payment_id: "pay_fixture" }));
  });
  it("holds refunded or inconsistent captures", async () => {
    mocks.fetchPayment.mockResolvedValue({ ...payment, amount_refunded: 100 });
    expect(await (await verify(request("verify", { orderId, paymentId: "pay_fixture", signature }))).json()).toMatchObject({ status: "needs_reconciliation" });
  });
  it("does not treat authorization as capture", async () => {
    mocks.fetchPayment.mockResolvedValue({ ...payment, status: "authorized", captured: false });
    mocks.fetchOrder.mockResolvedValue({ id: "order_fixture", receipt: orderId, amount: 1_000_000, amount_paid: 0, amount_due: 1_000_000, status: "attempted", currency: "INR" });
    expect(await (await verify(request("verify", { orderId, paymentId: "pay_fixture", signature }))).json()).toMatchObject({ status: "created", spendablePaise: 0 });
  });
  it("rejects a payment for a different order without recording capture", async () => {
    mocks.fetchPayment.mockResolvedValue({ ...payment, order_id: "order_other" });
    expect((await verify(request("verify", { orderId, paymentId: "pay_fixture", signature }))).status).toBe(409);
    expect(mocks.rpc.mock.calls.some(([name]) => name === "razorpay_test_order_observe")).toBe(false);
  });
  it("does not report a provider order as ready when its database save fails", async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "razorpay_test_order_claim" ? { claimed: true, order: saved } : null, error: name === "razorpay_test_order_claim" ? null : {} }));
    const response = await POST(request("orders", { businessId, idempotencyKey: orderId }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: "needs_reconciliation", orderId });
    expect(mocks.createOrder).toHaveBeenCalledTimes(1);
  });
  it("rejects invalid webhook signatures and a different merchant", async () => {
    expect((await webhook(webhookRequest({}, "0".repeat(64)))).status).toBe(400);
    expect((await webhook(webhookRequest({ account_id: "acc_other" }))).status).toBe(400);
    expect(mocks.fetchPayment).not.toHaveBeenCalled();
  });
  it("stores verified notifications before acknowledgement, without session auth", async () => {
    expect((await webhook(webhookRequest())).status).toBe(200);
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("razorpay_test_order_observe", expect.objectContaining({ p_event_id: "webhook:event_fixture", p_payload_hash: expect.stringMatching(/^[a-f0-9]{64}$/) }));
  });
  it("does not acknowledge notifications that cannot be durably stored", async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "razorpay_test_order_find" ? saved : null, error: name === "razorpay_test_order_find" ? null : {} }));
    expect((await webhook(webhookRequest())).status).toBe(503);
  });
  it("bounds webhook bytes before provider access", async () => {
    const response = await webhook(new Request("http://localhost:3000/api/payments/test/webhook", { method: "POST", body: "x".repeat(65_537) }));
    expect(response.status).toBe(413);
    expect(mocks.fetchPayment).not.toHaveBeenCalled();
  });
  it("handles a verified refund notification as a reconciliation hold", async () => {
    mocks.fetchPayment.mockResolvedValue({ ...payment, status: "refunded", amount_refunded: 1_000_000, refund_status: "full" });
    expect((await webhook(webhookRequest({ event: "refund.processed", payload: { refund: { entity: { payment_id: "pay_fixture" } } } }))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("razorpay_test_order_observe", expect.objectContaining({ p_outcome: "needs_reconciliation" }));
  });
  it("returns a client error for signed malformed JSON", async () => {
    const raw = "{";
    expect((await webhook(new Request("http://localhost:3000/api/payments/test/webhook", { method: "POST", body: raw,
      headers: { "x-razorpay-signature": createHmac("sha256", webhookSecret).update(raw).digest("hex") } }))).status).toBe(400);
  });
});