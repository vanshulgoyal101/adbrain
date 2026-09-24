import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
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