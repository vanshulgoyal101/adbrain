import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const orderIdSchema = z.string().regex(/^order_[A-Za-z0-9]+$/);
const paymentIdSchema = z.string().regex(/^pay_[A-Za-z0-9]+$/);
const positivePaiseSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

const storedOrderSchema = z.object({
  providerOrderId: orderIdSchema,
  totalPaise: positivePaiseSchema,
  currency: z.literal("INR"),
});

const capturedPaymentSchema = z.object({
  entity: z.literal("payment"),
  id: paymentIdSchema,
  order_id: orderIdSchema,
  amount: positivePaiseSchema,
  currency: z.literal("INR"),
  status: z.literal("captured"),
  captured: z.literal(true),
  amount_refunded: z.literal(0),
  refund_status: z.null(),
});

function verifyHmac(message: string | Uint8Array, signature: string, secret: string): boolean {
  if (typeof secret !== "string" || secret.length === 0
    || typeof signature !== "string" || !/^[a-fA-F0-9]{64}$/.test(signature)) return false;

  const expected = createHmac("sha256", secret).update(message).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

export function verifyRazorpayCheckoutSignature(input: {
  storedOrderId: string;
  paymentId: string;
  signature: string;
  keySecret: string;
}): boolean {
  if (!orderIdSchema.safeParse(input.storedOrderId).success
    || !paymentIdSchema.safeParse(input.paymentId).success) return false;

  return verifyHmac(`${input.storedOrderId}|${input.paymentId}`, input.signature, input.keySecret);
}

export function verifyRazorpayWebhookSignature(input: {
  rawBody: Uint8Array;
  signature: string;
  webhookSecret: string;
}): boolean {
  if (!(input.rawBody instanceof Uint8Array) || input.rawBody.byteLength === 0) return false;
  return verifyHmac(input.rawBody, input.signature, input.webhookSecret);
}

export function capturedPaymentMatchesOrder(payment: unknown, storedOrder: unknown): boolean {
  const parsedPayment = capturedPaymentSchema.safeParse(payment);
  const parsedOrder = storedOrderSchema.safeParse(storedOrder);
  if (!parsedPayment.success || !parsedOrder.success) return false;

  return parsedPayment.data.order_id === parsedOrder.data.providerOrderId
    && parsedPayment.data.amount === parsedOrder.data.totalPaise
    && parsedPayment.data.currency === parsedOrder.data.currency;
}