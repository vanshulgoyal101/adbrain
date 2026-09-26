import { describe, expect, it } from "vitest";
import {
  createAnnualPaymentQuote,
  ANNUAL_PAYMENT_VERSION,
  createPaymentQuote,
  DEFAULT_PAYMENT_ALLOCATION_POLICY,
  PAYMENT_ALLOCATION_VERSION,
  type PaymentAllocationPolicy,
} from "@/lib/payments/allocation";

describe("payment allocation", () => {
  it("keeps the annual total contract separate from pre-tax quote-v1", () => {
    const annual = createAnnualPaymentQuote();
    expect(annual).toEqual({
      version: ANNUAL_PAYMENT_VERSION, merchantDisplay: "Vanshul Goyal", currency: "INR",
      totalPaise: 1_000_000, serviceAllocationPaise: 200_000, metaAllocationPaise: 800_000,
      additionalCustomerTaxPaise: 0, metaTaxTreatment: "included-in-meta-allocation",
      gatewayFees: "absorbed-by-adbrain", automaticRenewal: false,
    });
    expect(annual.serviceAllocationPaise + annual.metaAllocationPaise).toBe(annual.totalPaise);
    expect(annual.version).not.toBe(PAYMENT_ALLOCATION_VERSION);
    expect(Object.isFrozen(annual)).toBe(true);
    expect(createPaymentQuote(1_000_000, 180_000).totalPaise).toBe(1_180_000);
  });

  it("allocates INR 10,000 as INR 2,000 fee and INR 8,000 advertising", () => {
    expect(createPaymentQuote(1_000_000, 0)).toEqual({
      version: PAYMENT_ALLOCATION_VERSION,
      platformFeeBps: 2_000,
      currency: "INR",
      basePaise: 1_000_000,
      platformFeePaise: 200_000,
      adAllocationPaise: 800_000,
      taxPaise: 0,
      totalPaise: 1_000_000,
    });
  });

  it("adds an explicitly supplied tax amount without changing the split", () => {
    const quote = createPaymentQuote(1_000_000, 123_456);
    expect(quote.platformFeePaise).toBe(200_000);
    expect(quote.adAllocationPaise).toBe(800_000);
    expect(quote.totalPaise).toBe(1_123_456);
  });

  it.each([1, 2, 3, 4, 5, 6, 99, 100, 101, 999_999, Number.MAX_SAFE_INTEGER])(
    "conserves every paise and rounds in favor of ads for %i paise",
    basePaise => {
      const quote = createPaymentQuote(basePaise, 0);
      expect(quote.platformFeePaise + quote.adAllocationPaise).toBe(basePaise);
      expect(BigInt(quote.platformFeePaise)).toBe(BigInt(basePaise) / BigInt(5));
      expect(Number.isSafeInteger(quote.adAllocationPaise)).toBe(true);
    },
  );

  it("conserves allocations across a range of rounding boundaries", () => {
    for (let basePaise = 1; basePaise <= 10_000; basePaise += 1) {
      const quote = createPaymentQuote(basePaise, 7);
      expect(quote.platformFeePaise + quote.adAllocationPaise + quote.taxPaise).toBe(quote.totalPaise);
      expect(basePaise - quote.platformFeePaise * 5).toBeGreaterThanOrEqual(0);
      expect(basePaise - quote.platformFeePaise * 5).toBeLessThan(5);
    }
  });

  it.each([0, -1, 0.1, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid base amount %s", amount => {
      expect(() => createPaymentQuote(amount, 0)).toThrow(RangeError);
    },
  );

  it.each([-1, 0.1, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid tax amount %s", amount => {
      expect(() => createPaymentQuote(100, amount)).toThrow(RangeError);
    },
  );

  it("requires an explicit tax amount, including an explicit zero", () => {
    expect(() => createPaymentQuote(100, undefined as unknown as number)).toThrow(RangeError);
    expect(() => createPaymentQuote("100" as unknown as number, 0)).toThrow(RangeError);
    expect(() => createPaymentQuote(100, null as unknown as number)).toThrow(RangeError);
  });

  it("rejects an unsafe total even when its individual components are safe", () => {
    expect(() => createPaymentQuote(Number.MAX_SAFE_INTEGER, 1)).toThrow(RangeError);
  });

  it("snapshots a revised server policy without changing an earlier quote", () => {
    const original = createPaymentQuote(1_000_000, 0);
    const revisedPolicy = { version: "inr-15-85-v2", platformFeeBps: 1_500 };
    const revised = createPaymentQuote(1_000_000, 0, revisedPolicy);
    revisedPolicy.platformFeeBps = 3_000;
    expect(original.platformFeePaise).toBe(200_000);
    expect(original.version).toBe(PAYMENT_ALLOCATION_VERSION);
    expect(revised.platformFeePaise).toBe(150_000);
    expect(revised.adAllocationPaise).toBe(850_000);
    expect(revised.platformFeeBps).toBe(1_500);
    expect(revised.version).toBe("inr-15-85-v2");
    expect(Object.isFrozen(original)).toBe(true);
    expect(Object.isFrozen(revised)).toBe(true);
    expect(Object.isFrozen(DEFAULT_PAYMENT_ALLOCATION_POLICY)).toBe(true);
  });

  it.each([0, 1, 1_500, 2_000, 3_333, 9_999, 10_000])(
    "keeps revised policies exact at the safe-integer limit for %i basis points", platformFeeBps => {
      const basePaise = Number.MAX_SAFE_INTEGER;
      const quote = createPaymentQuote(basePaise, 0, { version: "fixture-v2", platformFeeBps });
      expect(quote.platformFeePaise).toBe(Number(BigInt(basePaise) * BigInt(platformFeeBps) / BigInt(10_000)));
      expect(quote.platformFeePaise + quote.adAllocationPaise).toBe(basePaise);
    },
  );

  it.each([-1, 10_001, 0.1, NaN, Infinity, "2000", null])(
    "rejects an invalid fee rate %s", platformFeeBps => {
      expect(() => createPaymentQuote(100, 0, {
        version: "fixture-v2", platformFeeBps: platformFeeBps as number,
      })).toThrow(RangeError);
    },
  );

  it.each(["", " ", "A".repeat(65), undefined, null])(
    "requires a valid policy version %s", version => {
      expect(() => createPaymentQuote(100, 0, { version: version as string, platformFeeBps: 2_000 })).toThrow(RangeError);
    },
  );

  it("rejects a missing policy object when explicitly supplied as null", () => {
    expect(() => createPaymentQuote(100, 0, null as unknown as PaymentAllocationPolicy)).toThrow(RangeError);
  });
});