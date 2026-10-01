import { z } from "zod";

export const PAYMENT_ALLOCATION_VERSION = "inr-20-80-v1";

export const ANNUAL_PAYMENT_VERSION = "inr-annual-total-v1";

export const DEFAULT_ANNUAL_PAYMENT_PAISE = 1_000_000;

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