export const PAYMENT_ALLOCATION_VERSION = "inr-20-80-v1";

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