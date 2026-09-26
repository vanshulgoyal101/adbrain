import Razorpay from "razorpay";
import { z } from "zod";
import { createAnnualPaymentQuote } from "./allocation";
import { getProductionCollectionPolicy, getProductionPaymentConfig, ProductionPaymentError } from "./production-config";
import { razorpayTestOrderSchema as orderSchema, razorpayTestPaymentSchema as paymentSchema } from "./razorpay-test";

const identifier = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9]{1,100}$`));
const refundSchema = z.object({
  id: identifier("rfnd"), entity: z.literal("refund"), payment_id: identifier("pay"),
  amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), currency: z.literal("INR"),
  receipt: z.string().max(40).nullable(), status: z.enum(["pending", "processed", "failed"]),
});
const collectionSchema = <Schema extends z.ZodType>(schema: Schema, maximum = 100) => z.object({
  entity: z.literal("collection"), count: z.number().int().nonnegative().max(maximum), items: z.array(schema).max(maximum),
}).refine(value => value.count === value.items.length);

function validated<Schema extends z.ZodType>(schema: Schema, input: unknown): z.output<Schema> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ProductionPaymentError("INVALID_PROVIDER_RESPONSE");
  return parsed.data;
}

export function createProductionPaymentClient(environment: Readonly<Record<string, string | undefined>> = process.env, signal?: AbortSignal) {
  const config = getProductionPaymentConfig(environment);
  async function request(operation: (sdk: Razorpay) => Promise<unknown>) {
    const sdk = new Razorpay({ key_id: config.keyId, key_secret: config.keySecret });
    const transport = (sdk.api as typeof sdk.api & {
      rq: { defaults: { timeout: number; maxRedirects: number; maxContentLength: number; signal: AbortSignal } };
    }).rq;
    transport.defaults.timeout = 15_000;
    transport.defaults.maxRedirects = 0;
    transport.defaults.maxContentLength = 1_048_576;
    transport.defaults.signal = signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000);
    try { return await operation(sdk); }
    catch { throw new ProductionPaymentError("PROVIDER_UNAVAILABLE"); }
  }
  return {
    async createOrder(receipt: string, policyHash: string) {
      z.uuid().parse(receipt);
      if (getProductionCollectionPolicy(environment).hash !== policyHash) throw new ProductionPaymentError("COLLECTION_BLOCKED");
      const quote = createAnnualPaymentQuote();
      const order = validated(orderSchema, await request(sdk => sdk.orders.create({
        amount: quote.totalPaise, currency: quote.currency, receipt, partial_payment: false,
        notes: { quote_version: quote.version, policy_hash: policyHash },
      })));
      if (order.receipt !== receipt || order.amount !== quote.totalPaise || order.amount_paid !== 0
        || order.amount_due !== quote.totalPaise || order.status !== "created") throw new ProductionPaymentError("INVALID_PROVIDER_RESPONSE");
      return order;
    },
    async fetchOrder(orderId: string) {
      identifier("order").parse(orderId);
      const order = validated(orderSchema, await request(sdk => sdk.orders.fetch(orderId)));
      if (order.id !== orderId) throw new ProductionPaymentError("INVALID_PROVIDER_RESPONSE");
      return order;
    },
    async findOrder(receipt: string) {
      z.uuid().parse(receipt);
      const page = validated(collectionSchema(orderSchema, 2), await request(sdk => sdk.orders.all({ receipt, count: 2, skip: 0 })));
      if (page.items.length > 1 || page.items.some(order => order.receipt !== receipt)) throw new ProductionPaymentError("INVALID_PROVIDER_RESPONSE");
      return page.items[0] ?? null;
    },
    async fetchPayment(paymentId: string) {
      identifier("pay").parse(paymentId);
      const payment = validated(paymentSchema, await request(sdk => sdk.payments.fetch(paymentId)));
      if (payment.id !== paymentId || payment.amount_refunded > payment.amount) throw new ProductionPaymentError("INVALID_PROVIDER_RESPONSE");
      return payment;
    },
    async fetchOrderPayments(orderId: string) {
      identifier("order").parse(orderId);
      const page = validated(collectionSchema(paymentSchema), await request(sdk => sdk.orders.fetchPayments(orderId)));
      if (page.count === 100 || page.items.some(payment => payment.order_id !== orderId || payment.amount_refunded > payment.amount)
        || new Set(page.items.map(payment => payment.id)).size !== page.count) throw new ProductionPaymentError("INVALID_PROVIDER_RESPONSE");
      return page.items;
    },
    async createRefund(paymentId: string, receipt: string, amountPaise: number) {
      identifier("pay").parse(paymentId);
      z.uuid().parse(receipt);
      z.number().int().min(100).max(createAnnualPaymentQuote().totalPaise).parse(amountPaise);
      if (environment.PAYMENTS_LIVE_REFUNDS_ENABLED !== "true") throw new ProductionPaymentError("DISABLED");
      const refund = validated(refundSchema, await request(sdk => sdk.payments.refund(paymentId, {
        amount: amountPaise, receipt, speed: "normal",
      })));
      if (refund.payment_id !== paymentId || refund.receipt !== receipt || refund.amount !== amountPaise) {
        throw new ProductionPaymentError("INVALID_PROVIDER_RESPONSE");
      }
      return refund;
    },
    async fetchRefund(paymentId: string, refundId: string) {
      identifier("pay").parse(paymentId);
      identifier("rfnd").parse(refundId);
      const refund = validated(refundSchema, await request(sdk => sdk.refunds.fetch(refundId, { payment_id: paymentId })));
      if (refund.id !== refundId || refund.payment_id !== paymentId) throw new ProductionPaymentError("INVALID_PROVIDER_RESPONSE");
      return refund;
    },
    async fetchRefunds(paymentId: string, skip = 0) {
      identifier("pay").parse(paymentId);
      z.number().int().nonnegative().max(10_000).parse(skip);
      const page = validated(collectionSchema(refundSchema), await request(sdk => sdk.payments.fetchMultipleRefund(paymentId, { count: 100, skip })));
      if (page.items.some(refund => refund.payment_id !== paymentId)
        || new Set(page.items.map(refund => refund.id)).size !== page.count) throw new ProductionPaymentError("INVALID_PROVIDER_RESPONSE");
      return { items: page.items, nextSkip: page.count === 100 ? skip + page.count : null };
    },
  };
}