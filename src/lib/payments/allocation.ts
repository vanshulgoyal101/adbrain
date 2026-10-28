import { z } from "zod";

export const PAYMENT_ALLOCATION_VERSION = "inr-20-80-v1";

export const ANNUAL_PAYMENT_VERSION = "inr-annual-total-v1";

export const DEFAULT_ANNUAL_PAYMENT_PAISE = 1_000_000;

export const MIN_ANNUAL_PAYMENT_PAISE = 50_000;

/** #1271: the most a capped run of `days` × `dailyRupees` can cost with Meta's GST: activation's reserve check, ceil(cap × (10000 + GST bps) / 10000). */
export function capWithGstPaise(input: { dailyRupees: number; days: number; taxRateBps?: number }): number {
  const capPaise = Math.round(input.dailyRupees * 100) * input.days;
  return Math.ceil(capPaise * (10_000 + (input.taxRateBps ?? 1_800)) / 10_000);
}

/**
 * #1251: the whole-rupee payment that funds a capped run of `days` × `dailyRupees` plus Meta's GST, after what is
 * already available. It mirrors activation's reserve check (ceil(cap × (10000 + GST bps) / 10000) ≤ available) and the
 * quote's ad share (total − floor(total / 5)). 0 when the balance already covers it; never below the ₹500 minimum.
 */
export function paymentToCoverPaise(input: { dailyRupees: number; days: number; availablePaise: number; taxRateBps?: number }): number {
  const neededPaise = capWithGstPaise(input);
  const shortPaise = neededPaise - Math.max(input.availablePaise, 0);
  if (shortPaise <= 0) return 0;
  return Math.max(Math.ceil(shortPaise * 5 / 400) * 100, MIN_ANNUAL_PAYMENT_PAISE);
}

export function createAnnualPaymentQuote(totalPaise: number = DEFAULT_ANNUAL_PAYMENT_PAISE) {
  requirePaise(totalPaise, "totalPaise", 100);
  if (totalPaise > DEFAULT_ANNUAL_PAYMENT_PAISE) {
    throw new RangeError("Annual payment must not exceed 1000000 paise.");
  }
  const serviceAllocationPaise = Number(BigInt(totalPaise) / BigInt(5));
  return Object.freeze({
    version: totalPaise === DEFAULT_ANNUAL_PAYMENT_PAISE ? ANNUAL_PAYMENT_VERSION : "inr-annual-configurable-v1",
    merchantDisplay: "Vanshul Goyal",
    currency: "INR",
    totalPaise,
    serviceAllocationPaise,
    metaAllocationPaise: totalPaise - serviceAllocationPaise,
    additionalCustomerTaxPaise: 0,
    metaTaxTreatment: "included-in-meta-allocation",
    gatewayFees: "absorbed-by-adbrain",
    automaticRenewal: false,
  } as const);
}

export function createVerificationPaymentQuote(totalPaise = 1_000) {
  return Object.freeze({
    ...createAnnualPaymentQuote(totalPaise),
    version: "inr-payment-verification-v1",
    serviceAllocationPaise: 0,
    metaAllocationPaise: 0,
    verificationAllocationPaise: totalPaise,
  } as const);
}

const quotePaise = z.number().int().min(0).max(DEFAULT_ANNUAL_PAYMENT_PAISE);
export const productionPaymentQuoteSchema = z.strictObject({
  version: z.enum([ANNUAL_PAYMENT_VERSION, "inr-annual-configurable-v1", "inr-payment-verification-v1"]),
  merchantDisplay: z.literal("Vanshul Goyal"), currency: z.literal("INR"),
  totalPaise: quotePaise.min(100), serviceAllocationPaise: quotePaise, metaAllocationPaise: quotePaise,
  verificationAllocationPaise: quotePaise.optional(),
  additionalCustomerTaxPaise: z.literal(0), metaTaxTreatment: z.literal("included-in-meta-allocation"),
  gatewayFees: z.literal("absorbed-by-adbrain"), automaticRenewal: z.literal(false),
}).refine(quote => {
  if (quote.version === "inr-payment-verification-v1") {
    return quote.serviceAllocationPaise === 0 && quote.metaAllocationPaise === 0
      && quote.verificationAllocationPaise === quote.totalPaise;
  }
  return quote.verificationAllocationPaise === undefined
    && quote.serviceAllocationPaise === Math.floor(quote.totalPaise / 5)
    && quote.metaAllocationPaise === quote.totalPaise - quote.serviceAllocationPaise
    && (quote.version === ANNUAL_PAYMENT_VERSION) === (quote.totalPaise === DEFAULT_ANNUAL_PAYMENT_PAISE);
});
export type ProductionPaymentQuote = z.infer<typeof productionPaymentQuoteSchema>;
// #1235 (owner): what reaches the browser. The service and Meta allocations would show AdBrain's margin in devtools, so
// they stay server-side; the stored quote, its checks and the Razorpay order still use the full quote.
export const paymentQuoteViewSchema = z.object({
  version: z.enum([ANNUAL_PAYMENT_VERSION, "inr-annual-configurable-v1", "inr-payment-verification-v1"]),
  merchantDisplay: z.literal("Vanshul Goyal"), currency: z.literal("INR"), totalPaise: quotePaise.min(100),
  additionalCustomerTaxPaise: z.literal(0), metaTaxTreatment: z.literal("included-in-meta-allocation"),
  gatewayFees: z.literal("absorbed-by-adbrain"), automaticRenewal: z.literal(false),
});
export type PaymentQuoteView = z.infer<typeof paymentQuoteViewSchema>;
export const toPaymentQuoteView = (quote: ProductionPaymentQuote): PaymentQuoteView => paymentQuoteViewSchema.parse(quote);

export interface PaymentAllocationPolicy {
  readonly version: string;
  readonly platformFeeBps: number;
}

export const DEFAULT_PAYMENT_ALLOCATION_POLICY: PaymentAllocationPolicy = Object.freeze({
  version: PAYMENT_ALLOCATION_VERSION,
  platformFeeBps: 2_000,
});

export interface PaymentQuote {
  version: string;
  platformFeeBps: number;
  currency: "INR";
  basePaise: number;
  platformFeePaise: number;
  adAllocationPaise: number;
  taxPaise: number;
  totalPaise: number;
}

function requirePaise(value: number, name: string, minimum = 0): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${name} must be a safe integer of at least ${minimum} paise.`);
  }
}

export function createPaymentQuote(
  basePaise: number,
  taxPaise: number,
  policy: PaymentAllocationPolicy = DEFAULT_PAYMENT_ALLOCATION_POLICY,
): Readonly<PaymentQuote> {
  requirePaise(basePaise, "basePaise", 1);
  requirePaise(taxPaise, "taxPaise");
  if (!policy || typeof policy.version !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(policy.version)
    || !Number.isInteger(policy.platformFeeBps) || policy.platformFeeBps < 0 || policy.platformFeeBps > 10_000) {
    throw new RangeError("A versioned allocation policy with a fee from 0 to 10000 basis points is required.");
  }
  const totalPaise = basePaise + taxPaise;
  requirePaise(totalPaise, "totalPaise", 1);
  const platformFeePaise = Number(BigInt(basePaise) * BigInt(policy.platformFeeBps) / BigInt(10_000));

  return Object.freeze({
    version: policy.version,
    platformFeeBps: policy.platformFeeBps,
    currency: "INR",
    basePaise,
    platformFeePaise,
    adAllocationPaise: basePaise - platformFeePaise,
    taxPaise,
    totalPaise,
  });
}