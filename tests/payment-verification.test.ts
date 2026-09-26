import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Razorpay from "razorpay";
import { createRazorpayTestClient, getRazorpayTestConfig } from "@/lib/payments/razorpay-test";
import {
  capturedPaymentMatchesOrder,
  verifyRazorpayCheckoutSignature,
  verifyRazorpayWebhookSignature,
} from "@/lib/payments/razorpay-verification";

const keySecret = "fixture-checkout-secret";
const webhookSecret = "fixture-webhook-secret";
const checkoutSignature = createHmac("sha256", keySecret).update("order_stored1|pay_test1").digest("hex");
const rawBody = Buffer.from('{ "event": "payment.captured", "payload": {} }\n');
const webhookSignature = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
const checkout = {
  storedOrderId: "order_stored1",
  paymentId: "pay_test1",
  signature: checkoutSignature,
  keySecret,
};
const webhook = { rawBody, signature: webhookSignature, webhookSecret };
const storedOrder = { providerOrderId: "order_stored1", totalPaise: 1_000_000, currency: "INR" };
const capturedPayment = {
  entity: "payment",
  id: "pay_test1",
  order_id: storedOrder.providerOrderId,
  amount: storedOrder.totalPaise,
  currency: "INR",
  status: "captured",
  captured: true,
  amount_refunded: 0,
  refund_status: null,
};

const testEnvironment = {
  NODE_ENV: "test", PAYMENTS_TEST_ENABLED: "true", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  RAZORPAY_TEST_KEY_ID: "rzp_test_fixture", RAZORPAY_TEST_KEY_SECRET: keySecret,
  RAZORPAY_TEST_ACCOUNT_ID: "acc_fixture", RAZORPAY_TEST_WEBHOOK_SECRET: webhookSecret,
};

const requireFromSdk = createRequire(createRequire(import.meta.url).resolve("razorpay"));
const sdkAxios: {
  defaults: { adapter: unknown };
} = requireFromSdk("axios").default;
const originalAdapter = sdkAxios.defaults.adapter;
type TransportRequest = {
  baseURL: string; url: string; method: string; data?: string;
  auth: { username: string; password: string }; timeout: number; maxRedirects: number; signal: AbortSignal;
};
const sdkRequest = vi.fn<(config: TransportRequest) => Promise<unknown>>();

beforeEach(() => {
  sdkRequest.mockReset();
  sdkRequest.mockRejectedValue(new Error("Unexpected SDK request"));
  sdkAxios.defaults.adapter = sdkRequest;
});
afterEach(() => {
  sdkAxios.defaults.adapter = originalAdapter;
  vi.restoreAllMocks();
});

function respondWith(data: unknown) {
  sdkRequest.mockImplementation(async config => ({ data, status: 200, statusText: "OK", headers: {}, config }));
}

describe("local-only Razorpay adapter", () => {
  it.each([
    { PAYMENTS_TEST_ENABLED: "false" }, { NODE_ENV: "production" }, { VERCEL_ENV: "preview" },
    { RAZORPAY_TEST_KEY_ID: "rzp_live_fixture" }, { RAZORPAY_TEST_KEY_SECRET: "" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://production.supabase.co" },
    { NEXT_PUBLIC_SUPABASE_URL: "http://localhost.evil.invalid" },
    { NEXT_PUBLIC_SUPABASE_URL: "http://user:password@localhost:54321" },
    { RAZORPAY_TEST_WEBHOOK_SECRET: keySecret }, { RAZORPAY_TEST_ACCOUNT_ID: "" },
  ])("blocks unsafe configuration before network access: %j", override => {
    expect(() => createRazorpayTestClient({ ...testEnvironment, ...override })).toThrow();
    expect(sdkRequest).not.toHaveBeenCalled();
  });

  it("requires the explicit enable flag", () => {
    expect(() => getRazorpayTestConfig({})).toThrow();
  });

  it("supports standard server-side key names without a public secret or legacy pair", () => {
    expect(getRazorpayTestConfig({ ...testEnvironment,
      RAZORPAY_TEST_KEY_ID: undefined, RAZORPAY_TEST_KEY_SECRET: undefined,
      RAZORPAY_KEY_ID: "rzp_test_fixture", RAZORPAY_KEY_SECRET: keySecret,
    })).toMatchObject({ keyId: "rzp_test_fixture", keySecret });
    expect(getRazorpayTestConfig({ ...testEnvironment,
      RAZORPAY_KEY_ID: "rzp_test_fixture", RAZORPAY_KEY_SECRET: keySecret,
    })).toMatchObject({ keyId: "rzp_test_fixture", keySecret });
  });

  it.each([
    { RAZORPAY_KEY_ID: "rzp_live_fixture", RAZORPAY_KEY_SECRET: keySecret },
    { RAZORPAY_KEY_ID: "rzp_test_fixture" },
    { RAZORPAY_KEY_SECRET: keySecret },
  ])("rejects incomplete or live standard keys: %j", standard => {
    expect(() => createRazorpayTestClient({ ...testEnvironment,
      RAZORPAY_TEST_KEY_ID: undefined, RAZORPAY_TEST_KEY_SECRET: undefined, ...standard,
    })).toThrow();
    expect(sdkRequest).not.toHaveBeenCalled();
  });

  it.each([
    { RAZORPAY_KEY_ID: "rzp_test_other", RAZORPAY_KEY_SECRET: keySecret },
    { RAZORPAY_KEY_ID: "rzp_test_fixture", RAZORPAY_KEY_SECRET: "different-fixture-secret" },
    { RAZORPAY_KEY_ID: "rzp_test_fixture" },
  ])("does not silently combine or override conflicting key pairs: %j", standard => {
    expect(() => createRazorpayTestClient({ ...testEnvironment, ...standard })).toThrow();
    expect(sdkRequest).not.toHaveBeenCalled();
  });

  it("creates only the server-defined INR test order with partial payment disabled", async () => {
    const receipt = "11111111-1111-4111-8111-111111111111";
    const order = { id: "order_fixture", entity: "order", amount: 1_000_000,
      amount_paid: 0, amount_due: 1_000_000, currency: "INR", status: "created", receipt };
    respondWith(order);
    await expect(createRazorpayTestClient(testEnvironment).createOrder(receipt)).resolves.toEqual(order);
    expect(Razorpay.VERSION).toBe("2.9.8");
    expect(sdkRequest).toHaveBeenCalledTimes(1);
    const sent = sdkRequest.mock.calls[0][0];
    expect(sent).toMatchObject({ baseURL: "https://api.razorpay.com", url: "/v1/orders", method: "post",
      auth: { username: testEnvironment.RAZORPAY_TEST_KEY_ID, password: keySecret }, timeout: 15_000, maxRedirects: 0 });
    expect(sent.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(sent.data!)).toEqual({ amount: 1_000_000, currency: "INR", receipt, partial_payment: false });
  });

  it("does not retry an ambiguous provider mutation or expose provider error text", async () => {
    sdkRequest.mockRejectedValue(new Error("sensitive-provider-detail"));
    await expect(createRazorpayTestClient(testEnvironment).createOrder("11111111-1111-4111-8111-111111111111"))
      .rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(sdkRequest).toHaveBeenCalledTimes(1);
  });

  it("fetches orders and payments through the SDK with separate per-request signals", async () => {
    const client = createRazorpayTestClient(testEnvironment);
    const order = { id: "order_stored1", entity: "order", amount: 1_000_000, amount_paid: 1_000_000,
      amount_due: 0, currency: "INR", status: "paid", receipt: "fixture" };
    respondWith(order);
    await expect(client.fetchOrder(order.id)).resolves.toEqual(order);
    respondWith(capturedPayment);
    await expect(client.fetchPayment(capturedPayment.id)).resolves.toEqual(capturedPayment);
    expect(sdkRequest.mock.calls.map(([sent]) => [sent.method, sent.url])).toEqual([
      ["get", "/v1/orders/order_stored1"], ["get", "/v1/payments/pay_test1"],
    ]);
    expect(sdkRequest.mock.calls[0][0].signal).not.toBe(sdkRequest.mock.calls[1][0].signal);
  });

  it.each([302, 401, 429, 500])("sanitizes HTTP %i and never retries it", async status => {
    sdkRequest.mockRejectedValue({ response: { status, data: { error: { description: "sensitive-provider-detail" } } } });
    await expect(createRazorpayTestClient(testEnvironment).fetchPayment("pay_test1"))
      .rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(sdkRequest).toHaveBeenCalledTimes(1);
  });

  it("cancels the SDK request when its deadline expires", async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    sdkRequest.mockImplementation(config => new Promise((_resolve, reject) => {
      config.signal.addEventListener("abort", () => reject(config.signal.reason), { once: true });
      controller.abort(new DOMException("Expired", "TimeoutError"));
    }));
    await expect(createRazorpayTestClient(testEnvironment).createOrder("11111111-1111-4111-8111-111111111111"))
      .rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(timeout).toHaveBeenCalledWith(15_000);
    expect(sdkRequest).toHaveBeenCalledTimes(1);
    expect(sdkRequest.mock.calls[0][0].signal.aborted).toBe(true);
  });

  it("rejects malformed or mismatched provider evidence", async () => {
    respondWith({ ...capturedPayment, id: "pay_other" });
    await expect(createRazorpayTestClient(testEnvironment).fetchPayment("pay_test1"))
      .rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
  });

  it("rejects untrusted IDs before constructing a provider URL", async () => {
    await expect(createRazorpayTestClient(testEnvironment).fetchPayment("../orders")).rejects.toThrow();
    expect(sdkRequest).not.toHaveBeenCalled();
  });
});

describe("Razorpay checkout signature", () => {
  it("verifies the stored order and provider payment ID", () => {
    expect(verifyRazorpayCheckoutSignature(checkout)).toBe(true);
  });

  it.each([
    { storedOrderId: "order_different" },
    { paymentId: "pay_different" },
    { keySecret: "wrong-secret" },
    { keySecret: "" },
    { keySecret: undefined as unknown as string },
    { storedOrderId: "" },
    { storedOrderId: "order_bad|pay_test1" },
    { paymentId: "" },
  ])("rejects mismatched or missing signed identifiers/secrets: %j", override => {
    expect(verifyRazorpayCheckoutSignature({ ...checkout, ...override })).toBe(false);
  });

  it("does not accept a valid signature for a different client-supplied order", () => {
    const forgedSignature = createHmac("sha256", keySecret).update("order_client|pay_test1").digest("hex");
    expect(verifyRazorpayCheckoutSignature({ ...checkout, signature: forgedSignature })).toBe(false);
  });
});

describe("Razorpay webhook signature", () => {
  it("verifies the exact raw bytes with the separate webhook secret", () => {
    expect(verifyRazorpayWebhookSignature(webhook)).toBe(true);
    expect(verifyRazorpayWebhookSignature({ ...webhook, webhookSecret: keySecret })).toBe(false);
  });

  it("rejects reserialized JSON even when its meaning is unchanged", () => {
    const reserialized = Buffer.from(JSON.stringify(JSON.parse(rawBody.toString("utf8"))));
    expect(verifyRazorpayWebhookSignature({ ...webhook, rawBody: reserialized })).toBe(false);
  });

  it("rejects tampered bytes, empty input and missing secrets", () => {
    expect(verifyRazorpayWebhookSignature({ ...webhook, rawBody: Buffer.from("{}") })).toBe(false);
    expect(verifyRazorpayWebhookSignature({ ...webhook, rawBody: new Uint8Array() })).toBe(false);
    expect(verifyRazorpayWebhookSignature({ ...webhook, webhookSecret: "" })).toBe(false);
    expect(verifyRazorpayWebhookSignature({ ...webhook, rawBody: rawBody.toString() as unknown as Uint8Array })).toBe(false);
  });
});

describe("signature encoding", () => {
  it.each(["", "00", "x".repeat(64), "0".repeat(63), "0".repeat(65), "0".repeat(64), " ".repeat(64), undefined, null])(
    "rejects invalid or nonmatching signatures without throwing: %s", signature => {
      expect(verifyRazorpayCheckoutSignature({ ...checkout, signature: signature as string })).toBe(false);
      expect(verifyRazorpayWebhookSignature({ ...webhook, signature: signature as string })).toBe(false);
    },
  );
});

describe("captured payment shape and order binding", () => {
  it("matches an unrefunded captured INR payment to its stored order", () => {
    expect(capturedPaymentMatchesOrder(capturedPayment, storedOrder)).toBe(true);
  });

  it.each([
    { order_id: "order_other" },
    { amount: 800_000 },
    { amount: 1_000_001 },
    { amount: "1000000" },
    { amount: 0 },
    { amount: -1 },
    { amount: 1.1 },
    { amount: Number.MAX_SAFE_INTEGER + 1 },
    { amount: NaN },
    { currency: "USD" },
    { status: "authorized" },
    { status: "failed" },
    { status: "refunded" },
    { captured: false },
    { amount_refunded: 1 },
    { amount_refunded: undefined },
    { refund_status: "partial" },
    { refund_status: "full" },
    { refund_status: undefined },
    { entity: "order" },
    { id: "" },
  ])("rejects unsafe capture facts requiring reconciliation: %j", override => {
    expect(capturedPaymentMatchesOrder({ ...capturedPayment, ...override }, storedOrder)).toBe(false);
  });

  it.each([null, undefined, {}, { ...storedOrder, currency: "USD" }, { ...storedOrder, totalPaise: "1000000" }])(
    "rejects absent or malformed persisted order evidence: %j", order => {
      expect(capturedPaymentMatchesOrder(capturedPayment, order)).toBe(false);
    },
  );

  it.each([null, undefined, {}, [], "captured"])("rejects malformed payment data: %j", payment => {
    expect(capturedPaymentMatchesOrder(payment, storedOrder)).toBe(false);
  });
});