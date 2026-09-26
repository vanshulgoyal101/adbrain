import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/payments/live/orders/route";
import { POST as verify } from "@/app/api/payments/live/verify/route";
import { POST as webhook } from "@/app/api/payments/live/webhook/route";
import { POST as reconcile } from "@/app/api/payments/live/reconcile/route";
import { POST as operator } from "@/app/api/payments/live/operator/route";
import { getProductionCollectionPolicy } from "@/lib/payments/production-config";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), own: vi.fn(), rateLimit: vi.fn(), createOrder: vi.fn(), fetchOrder: vi.fn(),
  findOrder: vi.fn(), fetchPayment: vi.fn(), fetchOrderPayments: vi.fn(), createRefund: vi.fn(), fetchRefund: vi.fn(), fetchRefunds: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("@/lib/meta/connection-access", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/meta/connection-access")>(), requireOwnedBusiness: mocks.own,
}));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: mocks.rateLimit }));
vi.mock("@/lib/payments/razorpay-production", () => ({ createProductionPaymentClient: () => mocks }));

const orderId = "11111111-1111-4111-8111-111111111111";
const businessId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const origin = "https://adbrain.vanshul.com";
const secret = "synthetic-live-checkout-secret";
const webhookSecret = "synthetic-live-webhook-secret";
const policy = { version: "synthetic-terms-v1", approvalReference: orderId, approvedAt: "2026-09-01T00:00:00Z", expiresAt: "2026-10-01T00:00:00Z",
  serviceScope: "Synthetic finite scope, not actual terms", invoiceTerms: "Synthetic invoice policy", refundTerms: "Synthetic refund policy", automaticFundingApprovalReference: businessId };
const initialOrder = { id: orderId, business_id: businessId, user_id: userId, account_id: "acc_fixture", key_id: "rzp_live_fixture", environment: "live",
  amount_paise: 1_000_000, currency: "INR", state: "created", provider_order_id: "order_fixture" as string | null, payment_id: null as string | null,
  captured_paise: 0, refunded_paise: 0, provider_refunded_paise: 0, review_required: false, refund_hold: false, terms: policy, terms_hash: "",
  accepted_at: "2026-09-26T00:00:00Z" };
const payment = { id: "pay_fixture", entity: "payment", order_id: "order_fixture", amount: 1_000_000, currency: "INR", status: "captured",
  captured: true, amount_refunded: 0, refund_status: null };
const remoteOrder = { id: "order_fixture", entity: "order", receipt: orderId, amount: 1_000_000, amount_paid: 1_000_000, amount_due: 0, status: "paid", currency: "INR" };
let saved = { ...initialOrder };
let replay = false;
let storageFailure: string | null = null;
let operatorAllowed = false;
let refundReplay = false;
let refundOperation = { id: businessId, order_id: orderId, amount_paise: 10000, state: "creating", provider_refund_id: null as string | null };
const events: Record<string, unknown>[] = [];

function request(path: string, body: unknown, requestOrigin = origin) {
  return new Request(`${origin}/api/payments/live/${path}`, { method: "POST", headers: { origin: requestOrigin, "content-type": "application/json" }, body: JSON.stringify(body) });
}
function createBody() { return { businessId, idempotencyKey: orderId, termsHash: saved.terms_hash, acceptTerms: true }; }
function callback(overrides = {}) {
  return request("verify", { orderId, paymentId: "pay_fixture", providerOrderId: "order_fixture",
    signature: createHmac("sha256", secret).update("order_fixture|pay_fixture").digest("hex"), ...overrides });
}
function notification(overrides = {}, signatureOverride?: string) {
  const raw = JSON.stringify({ account_id: "acc_fixture", event: "payment.captured", payload: { payment: { entity: { id: "pay_fixture", order_id: "order_fixture" } } }, ...overrides });
  return new Request(`${origin}/api/payments/live/webhook`, { method: "POST", body: raw,
    headers: { "x-razorpay-event-id": "event_fixture", "x-razorpay-signature": signatureOverride ?? createHmac("sha256", webhookSecret).update(raw).digest("hex") } });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-26T00:00:00Z"));
  for (const [name, value] of Object.entries({
    PAYMENTS_LIVE_ENABLED: "true", NODE_ENV: "production", VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main", VERCEL_TARGET_ENV: "",
    VERCEL_PROJECT_ID: "prj_fixture", PAYMENTS_LIVE_PROJECT_ID: "prj_fixture", PAYMENTS_LIVE_COLLECTION_ENABLED: "true", PAYMENTS_LIVE_REFUNDS_ENABLED: "false",
    NEXT_PUBLIC_SUPABASE_URL: "https://fixture.supabase.co", PAYMENTS_LIVE_SUPABASE_URL: "https://fixture.supabase.co",
    RAZORPAY_LIVE_KEY_ID: "rzp_live_fixture", RAZORPAY_LIVE_KEY_SECRET: secret, RAZORPAY_LIVE_ACCOUNT_ID: "acc_fixture",
    RAZORPAY_LIVE_WEBHOOK_SECRET: webhookSecret, PAYMENTS_LIVE_WEBHOOK_ID: userId, PAYMENTS_LIVE_POLICY_JSON: JSON.stringify(policy),
    RAZORPAY_KEY_ID: "", RAZORPAY_KEY_SECRET: "", RAZORPAY_TEST_KEY_ID: "", RAZORPAY_TEST_KEY_SECRET: "", RAZORPAY_TEST_ACCOUNT_ID: "", RAZORPAY_TEST_WEBHOOK_SECRET: "", PAYMENTS_TEST_ENABLED: "false",
  })) vi.stubEnv(name, value);
  saved = { ...initialOrder, terms_hash: getProductionCollectionPolicy().hash };
  replay = false; storageFailure = null; events.length = 0;
  operatorAllowed = false; refundReplay = false;
  refundOperation = { id: businessId, order_id: orderId, amount_paise: 10000, state: "creating", provider_refund_id: null };
  mocks.getUser.mockResolvedValue({ data: { user: { id: userId } } });
  mocks.own.mockResolvedValue({ businessId, userId });
  mocks.rateLimit.mockResolvedValue(null);
  mocks.createOrder.mockResolvedValue({ ...remoteOrder, amount_paid: 0, amount_due: 1_000_000, status: "created" });
  mocks.fetchOrder.mockResolvedValue(remoteOrder);
  mocks.findOrder.mockResolvedValue(remoteOrder);
  mocks.fetchPayment.mockResolvedValue(payment);
  mocks.fetchOrderPayments.mockResolvedValue([payment]);
  mocks.fetchRefunds.mockResolvedValue({ items: [], nextSkip: null });
  const refund = { id: "rfnd_fixture", entity: "refund", payment_id: "pay_fixture", receipt: businessId, amount: 10000, currency: "INR", status: "processed" };
  mocks.createRefund.mockResolvedValue(refund);
  mocks.fetchRefund.mockResolvedValue(refund);
  mocks.rpc.mockImplementation((name: string, args: Record<string, unknown>) => ({ abortSignal: async () => {
    if (name === storageFailure) return { data: null, error: { message: "private-storage-detail" } };
    let data: unknown = null;
    if (name === "meta_funding_latest_record") data = { evidenceId: businessId };
    if (name === "production_payment_order_claim") data = { claimed: !replay, order: replay ? saved : { ...saved, state: "creating", provider_order_id: null } };
    if (name === "production_payment_order_result") {
      saved = { ...saved, provider_order_id: args.p_provider_order_id as string | null, state: args.p_provider_order_id ? "created" : "needs_reconciliation" }; data = saved;
    }
    if (name === "production_payment_orders_list") data = [saved];
    if (name === "production_payment_order_get") data = args.p_user_id === userId && args.p_order_id === orderId ? saved : null;
    if (name === "production_payment_recovery") data = args.p_order_id === orderId ? { order: saved, refunds: operatorAllowed ? [refundOperation] : [], refundIds: [] } : null;
    if (name === "production_payment_order_review") { saved.review_required = true; saved.state = "review_required"; data = saved; }
    if (name === "production_payment_observe") {
      saved = { ...saved, captured_paise: args.p_capture_verified ? 1_000_000 : saved.captured_paise,
        payment_id: args.p_capture_verified ? "pay_fixture" : saved.payment_id, review_required: saved.review_required || Boolean(args.p_review_required),
        state: args.p_review_required ? "review_required" : args.p_capture_verified ? "captured" : saved.state };
      data = saved;
    }
    if (name === "production_payment_event_receive") {
      data = { account_id: args.p_account_id, key_id: args.p_key_id, event_id: args.p_event_id, payload_hash: args.p_payload_hash,
        payment_id: args.p_payment_id, provider_order_id: args.p_provider_order_id, refund_id: args.p_refund_id, kind: args.p_kind, conflicted: false };
      events.push(data as Record<string, unknown>);
    }
    if (name === "production_payment_events_pending") data = events;
    if (name === "production_payment_operator_allowed") data = operatorAllowed;
    if (name === "production_payment_refund_claim") data = { claimed: !refundReplay, refund: refundOperation };
    if (name === "production_payment_refund_result") {
      refundOperation = { ...refundOperation, provider_refund_id: args.p_provider_refund_id as string | null,
        state: args.p_provider_refund_id ? "submitted" : "needs_reconciliation" }; data = refundOperation;
    }
    if (name === "production_payment_refund_observed") refundOperation.state = args.p_status as string;
    return { data, error: null };
  } }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("live checkout service with synthetic provider evidence", () => {
  it.each(["false", "", "TRUE"])("defaults every route disabled for flag %s", async value => {
    vi.stubEnv("PAYMENTS_LIVE_ENABLED", value);
    for (const call of [POST(request("orders", {})), verify(callback()), webhook(notification()), reconcile(request("reconcile", { orderId })), operator(request("operator", {}))]) {
      expect((await call).status).toBe(404);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.fetchPayment).not.toHaveBeenCalled();
  });
  it("requires session authentication and exact same-origin writes", async () => {
    expect((await POST(request("orders", createBody(), "https://other.invalid"))).status).toBe(403);
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect((await POST(request("orders", createBody()))).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("persists owned policy acceptance before SDK creation and never grants spend authority", async () => {
    const response = await POST(request("orders", createBody()));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ orderId, amountPaise: 1_000_000, checkout: { key: "rzp_live_fixture" }, spendablePaise: 0, canActivateCampaign: false });
    const claim = mocks.rpc.mock.calls.findIndex(([name]) => name === "production_payment_order_claim");
    expect(mocks.rpc.mock.invocationCallOrder[claim]).toBeLessThan(mocks.createOrder.mock.invocationCallOrder[0]);
    expect(mocks.own).toHaveBeenCalledWith(businessId);
    expect(mocks.rpc.mock.calls[claim][1]).toMatchObject({ p_user_id: userId, p_terms_hash: saved.terms_hash, p_quote: { totalPaise: 1_000_000 } });
  });
  it.each([{ amount: 1 }, { acceptTerms: false }, { termsHash: "0".repeat(64) }])("rejects altered amount or policy acceptance: %j", async overrides => {
    expect((await POST(request("orders", { ...createBody(), ...overrides }))).status).toBeGreaterThanOrEqual(400);
    expect(mocks.createOrder).not.toHaveBeenCalled();
  });
  it("never creates again for replay or an uncertain stored intent", async () => {
    replay = true; saved.state = "needs_reconciliation"; saved.provider_order_id = null;
    expect(await (await POST(request("orders", createBody()))).json()).toMatchObject({ orderId, status: "needs_reconciliation", checkout: null });
    expect(mocks.createOrder).not.toHaveBeenCalled();
  });
  it("retains the local reference after a lost provider create response", async () => {
    mocks.createOrder.mockRejectedValue(new Error("private timeout"));
    const response = await POST(request("orders", createBody()));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ orderId, status: "needs_reconciliation", spendablePaise: 0 });
    expect(mocks.createOrder).toHaveBeenCalledTimes(1);
  });
  it("fails closed before provider mutation when ownership/funding persistence is unavailable", async () => {
    storageFailure = "production_payment_order_claim";
    const response = await POST(request("orders", createBody()));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private-storage-detail");
    expect(mocks.createOrder).not.toHaveBeenCalled();
  });
  it("does not expose a foreign local order to callback or recovery", async () => {
    const foreignId = "44444444-4444-4444-8444-444444444444";
    expect((await verify(callback({ orderId: foreignId }))).status).toBe(404);
    expect((await reconcile(request("reconcile", { orderId: foreignId }))).status).toBe(404);
    expect(mocks.fetchPayment).not.toHaveBeenCalled();
  });
  it.each([{ signature: "0".repeat(64) }, { providerOrderId: "order_other" }])("rejects forged callbacks: %j", async overrides => {
    expect((await verify(callback(overrides))).status).toBe(400);
    expect(mocks.fetchPayment).not.toHaveBeenCalled();
  });
  it("requires server capture evidence and returns a receipt, not a tax invoice or entitlement", async () => {
    const response = await verify(callback());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ status: "captured", spendablePaise: 0, canActivateCampaign: false, checkout: null, receipt: { isTaxInvoice: false, reference: orderId } });
    expect(JSON.stringify(body)).not.toContain(secret);
  });
  it("does not interpret authorization as capture", async () => {
    mocks.fetchPayment.mockResolvedValue({ ...payment, captured: false, status: "authorized" });
    mocks.fetchOrder.mockResolvedValue({ ...remoteOrder, status: "attempted", amount_paid: 0, amount_due: 1_000_000 });
    expect(await (await verify(callback())).json()).toMatchObject({ capturedPaise: 0, receipt: null, spendablePaise: 0 });
  });
  it.each([{ amount: 1 }, { refund_status: "full" }, { captured: false }])("holds conflicting provider evidence: %j", async overrides => {
    mocks.fetchPayment.mockResolvedValue({ ...payment, ...overrides });
    expect(await (await verify(callback())).json()).toMatchObject({ status: "review_required", capturedPaise: 0, checkout: null });
  });
  it("recovers a missing provider order ID by receipt without creating or charging again", async () => {
    saved.provider_order_id = null; saved.state = "needs_reconciliation";
    expect((await reconcile(request("reconcile", { orderId }))).status).toBe(200);
    expect(mocks.findOrder).toHaveBeenCalledWith(orderId);
    expect(mocks.createOrder).not.toHaveBeenCalled();
  });
  it("does not infer failed creation from an empty provider receipt lookup", async () => {
    saved.provider_order_id = null; saved.state = "needs_reconciliation";
    mocks.findOrder.mockResolvedValue(null);
    expect((await reconcile(request("reconcile", { orderId }))).status).toBe(409);
    expect(mocks.createOrder).not.toHaveBeenCalled();
  });
  it("holds a paid order with no capture evidence instead of offering another checkout", async () => {
    mocks.fetchOrderPayments.mockResolvedValue([]);
    expect(await (await reconcile(request("reconcile", { orderId }))).json()).toMatchObject({ status: "review_required", checkout: null, capturedPaise: 0 });
  });
  it("rejects internally inconsistent signed refund references before storage", async () => {
    const response = await webhook(notification({ event: "refund.processed", payload: {
      payment: { entity: { id: "pay_fixture" } }, refund: { entity: { id: "rfnd_fixture", payment_id: "pay_other" } },
    } }));
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("preserves history while collection is suspended", async () => {
    vi.stubEnv("PAYMENTS_LIVE_COLLECTION_ENABLED", "false");
    const response = await GET(new Request(`${origin}/api/payments/live/orders?businessId=${businessId}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ policy: null, orders: [{ orderId, checkout: null }] });
  });
  it("rejects unsigned, wrong-merchant and test-environment webhook evidence", async () => {
    expect((await webhook(notification({}, "0".repeat(64)))).status).toBe(400);
    expect((await webhook(notification({ account_id: "acc_other" }))).status).toBe(400);
    expect((await webhook(notification({ environment: "test" }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("stores signed events before provider reads and acknowledges queued work after an outage", async () => {
    mocks.fetchPayment.mockRejectedValue(new Error("provider outage"));
    const response = await webhook(notification());
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ received: true, queued: true });
    expect(events).toHaveLength(1);
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.fetchPayment.mock.invocationCallOrder[0]);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });
  it("does not acknowledge events when durable storage fails", async () => {
    storageFailure = "production_payment_event_receive";
    expect((await webhook(notification())).status).toBe(503);
    expect(mocks.fetchPayment).not.toHaveBeenCalled();
  });
  it("holds disputes even when a fresh server read still shows captured", async () => {
    const response = await webhook(notification({ event: "payment.dispute.created", payload: { dispute: { entity: { payment_id: "pay_fixture" } } } }));
    expect(response.status).toBe(200);
    expect(saved.review_required).toBe(true);
  });
  it("requires persisted operator authority before financial recovery/refund actions", async () => {
    expect((await operator(request("operator", { action: "refund", orderId }))).status).toBe(403);
    expect(mocks.createRefund).not.toHaveBeenCalled();
    expect(mocks.fetchPayment).not.toHaveBeenCalled();
  });
  it("persists bounded refund approval before provider initiation and observes completion", async () => {
    operatorAllowed = true;
    vi.stubEnv("PAYMENTS_LIVE_REFUNDS_ENABLED", "true");
    const response = await operator(request("operator", { action: "refund", orderId, idempotencyKey: businessId,
      approvalReference: userId, termsHash: saved.terms_hash, reason: "Synthetic approved refund", amountPaise: 10000 }));
    expect(response.status).toBe(201);
    const claim = mocks.rpc.mock.calls.findIndex(([name]) => name === "production_payment_refund_claim");
    expect(mocks.rpc.mock.invocationCallOrder[claim]).toBeLessThan(mocks.createRefund.mock.invocationCallOrder[0]);
    expect(mocks.createRefund).toHaveBeenCalledWith("pay_fixture", businessId, 10000);
    expect((await response.json()).refunds).toContainEqual(expect.objectContaining({ state: "processed", provider_refund_id: "rfnd_fixture" }));
  });
  it("does not retry an uncertain refund under its persisted identity", async () => {
    operatorAllowed = true;
    vi.stubEnv("PAYMENTS_LIVE_REFUNDS_ENABLED", "true");
    const input = { action: "refund", orderId, idempotencyKey: businessId, approvalReference: userId,
      termsHash: saved.terms_hash, reason: "Synthetic approved refund", amountPaise: 10000 };
    mocks.createRefund.mockRejectedValue(new Error("Unknown provider outcome"));
    expect((await operator(request("operator", input))).status).toBe(503);
    expect(refundOperation.state).toBe("needs_reconciliation");
    refundReplay = true;
    expect((await operator(request("operator", input))).status).toBe(200);
    expect(mocks.createRefund).toHaveBeenCalledTimes(1);
  });
  it("blocks provider refunds when the refund gate or durable approval is unavailable", async () => {
    operatorAllowed = true;
    const input = { action: "refund", orderId, idempotencyKey: businessId, approvalReference: userId,
      termsHash: saved.terms_hash, reason: "Synthetic approved refund", amountPaise: 10000 };
    expect((await operator(request("operator", input))).status).toBe(409);
    vi.stubEnv("PAYMENTS_LIVE_REFUNDS_ENABLED", "true");
    storageFailure = "production_payment_refund_claim";
    expect((await operator(request("operator", input))).status).toBe(503);
    expect(mocks.createRefund).not.toHaveBeenCalled();
  });
  it("bounds webhook input before storage/provider access", async () => {
    expect((await webhook(new Request(`${origin}/api/payments/live/webhook`, { method: "POST", body: "x".repeat(65_537) }))).status).toBe(413);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});