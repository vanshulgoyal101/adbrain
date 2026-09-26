import Razorpay from "razorpay";
import { z } from "zod";

export const TEST_PAYMENT_AMOUNT_PAISE = 1_000_000;

const identifier = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9]{1,100}$`));
const paise = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const razorpayTestOrderSchema = z.object({
  id: identifier("order"), entity: z.literal("order"), amount: paise,
  amount_paid: paise, amount_due: paise, currency: z.literal("INR"),
  receipt: z.string().max(40), status: z.enum(["created", "attempted", "paid"]),
});
export const razorpayTestPaymentSchema = z.object({
  id: identifier("pay"), entity: z.literal("payment"), order_id: identifier("order"),
  amount: paise, currency: z.literal("INR"), captured: z.boolean(),
  status: z.enum(["created", "authorized", "captured", "refunded", "failed"]),
  amount_refunded: paise, refund_status: z.enum(["partial", "full"]).nullable(),
});

export class TestPaymentError extends Error {
  constructor(readonly code: "DISABLED" | "PROVIDER_UNAVAILABLE" | "INVALID_PROVIDER_RESPONSE") {
    super(code === "DISABLED" ? "Test payments require explicit local configuration and Razorpay test credentials."
      : "Razorpay test payment state could not be verified. Do not repeat an uncertain payment operation.");
    this.name = "TestPaymentError";
  }
}

export function getRazorpayTestConfig(environment: Readonly<Record<string, string | undefined>> = process.env) {
  if (typeof window !== "undefined" || environment.PAYMENTS_TEST_ENABLED !== "true"
    || environment.NODE_ENV === "production" || environment.VERCEL_ENV) throw new TestPaymentError("DISABLED");
  const standardKeys = Boolean(environment.RAZORPAY_KEY_ID || environment.RAZORPAY_KEY_SECRET);
  const legacyKeys = Boolean(environment.RAZORPAY_TEST_KEY_ID || environment.RAZORPAY_TEST_KEY_SECRET);
  if (standardKeys && legacyKeys && (environment.RAZORPAY_KEY_ID !== environment.RAZORPAY_TEST_KEY_ID
    || environment.RAZORPAY_KEY_SECRET !== environment.RAZORPAY_TEST_KEY_SECRET)) throw new TestPaymentError("DISABLED");
  const parsed = z.object({
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    RAZORPAY_TEST_KEY_ID: z.string().regex(/^rzp_test_[A-Za-z0-9]{1,100}$/),
    RAZORPAY_TEST_KEY_SECRET: z.string().trim().min(1),
    RAZORPAY_TEST_ACCOUNT_ID: identifier("acc"),
    RAZORPAY_TEST_WEBHOOK_SECRET: z.string().trim().min(16),
  }).safeParse({
    ...environment,
    RAZORPAY_TEST_KEY_ID: standardKeys ? environment.RAZORPAY_KEY_ID : environment.RAZORPAY_TEST_KEY_ID,
    RAZORPAY_TEST_KEY_SECRET: standardKeys ? environment.RAZORPAY_KEY_SECRET : environment.RAZORPAY_TEST_KEY_SECRET,
  });
  if (!parsed.success) throw new TestPaymentError("DISABLED");
  const url = new URL(parsed.data.NEXT_PUBLIC_SUPABASE_URL);
  if (!["http:", "https:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash
    || parsed.data.RAZORPAY_TEST_KEY_SECRET === parsed.data.RAZORPAY_TEST_WEBHOOK_SECRET) throw new TestPaymentError("DISABLED");
  return {
    keyId: parsed.data.RAZORPAY_TEST_KEY_ID,
    keySecret: parsed.data.RAZORPAY_TEST_KEY_SECRET,
    accountId: parsed.data.RAZORPAY_TEST_ACCOUNT_ID,
    webhookSecret: parsed.data.RAZORPAY_TEST_WEBHOOK_SECRET,
  };
}

export function createRazorpayTestClient(environment: Readonly<Record<string, string | undefined>> = process.env) {
  const config = getRazorpayTestConfig(environment);
  const sdk = new Razorpay({ key_id: config.keyId, key_secret: config.keySecret });
  const transport = (sdk.api as typeof sdk.api & {
    rq: { defaults: { timeout: number; maxRedirects: number; signal?: AbortSignal } };
  }).rq;
  transport.defaults.timeout = 15_000;
  transport.defaults.maxRedirects = 0;

  async function request(operation: () => Promise<unknown>): Promise<unknown> {
    try {
      transport.defaults.signal = AbortSignal.timeout(15_000);
      return await operation();
    } catch {
      throw new TestPaymentError("PROVIDER_UNAVAILABLE");
    }
  }
  return {
    async createOrder(receipt: string) {
      z.uuid().parse(receipt);
      const parsed = razorpayTestOrderSchema.safeParse(await request(() => sdk.orders.create({
        amount: TEST_PAYMENT_AMOUNT_PAISE, currency: "INR", receipt, partial_payment: false,
      })));
      if (!parsed.success || parsed.data.receipt !== receipt || parsed.data.amount !== TEST_PAYMENT_AMOUNT_PAISE
        || parsed.data.amount_paid !== 0 || parsed.data.amount_due !== TEST_PAYMENT_AMOUNT_PAISE
        || parsed.data.status !== "created") throw new TestPaymentError("INVALID_PROVIDER_RESPONSE");
      return parsed.data;
    },
    async fetchOrder(orderId: string) {
      identifier("order").parse(orderId);
      const parsed = razorpayTestOrderSchema.safeParse(await request(() => sdk.orders.fetch(orderId)));
      if (!parsed.success || parsed.data.id !== orderId) throw new TestPaymentError("INVALID_PROVIDER_RESPONSE");
      return parsed.data;
    },
    async fetchPayment(paymentId: string) {
      identifier("pay").parse(paymentId);
      const parsed = razorpayTestPaymentSchema.safeParse(await request(() => sdk.payments.fetch(paymentId)));
      if (!parsed.success || parsed.data.id !== paymentId || parsed.data.amount_refunded > parsed.data.amount) {
        throw new TestPaymentError("INVALID_PROVIDER_RESPONSE");
      }
      return parsed.data;
    },
  };
}

export function isRazorpayTestEnabled(): boolean {
  try { getRazorpayTestConfig(); return true; }
  catch { return false; }
}