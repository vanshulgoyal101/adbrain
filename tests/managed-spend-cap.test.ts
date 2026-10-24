import { describe, expect, it } from "vitest";
import { childSpendCap, type ChildSpendCapInput } from "@/lib/managed/spend-cap";
import { createAnnualPaymentQuote } from "@/lib/payments/allocation";

// A customer who prepaid ₹500 on the annual quote: ₹100 service, ₹400 for Meta with GST included.
const quote = createAnnualPaymentQuote(50_000);
const fresh: ChildSpendCapInput = {
  advertisingAllocationPaise: quote.metaAllocationPaise, advertisingRefundedPaise: 0, held: false, taxRateBps: 1800,
  mediaOnOtherAccountsPaise: 0, lifetimeMediaSpentPaise: 0, account: { spendCapPaise: 0, amountSpentPaise: 0 },
};
const withTax = (mediaPaise: number, bps = 1800) => Math.ceil(mediaPaise * (10_000 + bps) / 10_000);

describe("managed ad account spending limit from the customer's allowance (#522)", () => {
  it("caps a ₹500 customer's new child account at their ₹400 ad share, net of GST", () => {
    expect(quote.metaAllocationPaise).toBe(40_000);
    expect(childSpendCap(fresh)).toEqual({ action: "set", capPaise: 33_898, roomPaise: 33_898 });
    expect(withTax(33_898)).toBeLessThanOrEqual(40_000);
    expect(withTax(33_899)).toBeGreaterThan(40_000);
  });

  it("leaves Meta only the media the customer has left, counting what is spent but not yet attributed", () => {
    const live = { ...fresh, lifetimeMediaSpentPaise: 20_000, account: { spendCapPaise: 33_898, amountSpentPaise: 20_000 } };
    expect(childSpendCap(live)).toEqual({ action: "keep", capPaise: 33_898, roomPaise: 13_898 });
    // Meta counts amount_spent from when the cap was set: room still ends at the customer's allowance.
    const recounted = { ...live, account: { spendCapPaise: 33_898, amountSpentPaise: 5_000 } };
    expect(childSpendCap(recounted)).toEqual({ action: "set", capPaise: 18_898, roomPaise: 13_898 });
  });

  it("raises the cap after a top-up and lowers it after a refund, never below what Meta already spent", () => {
    const spent = { ...fresh, lifetimeMediaSpentPaise: 30_000, account: { spendCapPaise: 33_898, amountSpentPaise: 30_000 } };
    expect(childSpendCap({ ...spent, advertisingAllocationPaise: 80_000 })).toEqual({ action: "set", capPaise: 67_796, roomPaise: 37_796 });
    expect(childSpendCap({ ...spent, advertisingRefundedPaise: 10_000 })).toEqual({ action: "freeze", capPaise: 30_000, reason: "exhausted" });
  });

  it("subtracts media the customer spent on other ad accounts", () => {
    expect(childSpendCap({ ...fresh, mediaOnOtherAccountsPaise: 8_898 })).toEqual({ action: "set", capPaise: 25_000, roomPaise: 25_000 });
  });

  it("freezes at the amount spent while payments or costs are held", () => {
    const spent = { ...fresh, held: true, lifetimeMediaSpentPaise: 1_000, account: { spendCapPaise: 33_898, amountSpentPaise: 1_000 } };
    expect(childSpendCap(spent)).toEqual({ action: "freeze", capPaise: 1_000, reason: "held" });
  });

  it("never writes 0, which Meta reads as no limit at all", () => {
    expect(childSpendCap({ ...fresh, advertisingAllocationPaise: 0 })).toEqual({ action: "block", reason: "no_allowance" });
    expect(childSpendCap({ ...fresh, held: true })).toEqual({ action: "block", reason: "held" });
  });

  it("refuses figures it cannot trust", () => {
    for (const broken of [
      { ...fresh, advertisingAllocationPaise: -1 }, { ...fresh, taxRateBps: 10_001 }, { ...fresh, lifetimeMediaSpentPaise: 1.5 },
      { ...fresh, account: { spendCapPaise: Number.NaN, amountSpentPaise: 0 } },
    ]) expect(() => childSpendCap(broken)).toThrow(/cannot be verified/);
  });

  it("never lets total media with GST pass the customer's ad share", () => {
    for (const ad of [100, 999, 40_000, 123_457, 800_000]) {
      for (const bps of [0, 500, 1800]) {
        for (const spentShare of [0, 0.3, 0.99]) {
          const allowance = Math.floor(ad * 10_000 / (10_000 + bps));
          const lifetime = Math.floor(allowance * spentShare);
          const decision = childSpendCap({ ...fresh, advertisingAllocationPaise: ad, taxRateBps: bps, lifetimeMediaSpentPaise: lifetime,
            account: { spendCapPaise: 0, amountSpentPaise: Math.floor(lifetime / 2) } });
          const room = "roomPaise" in decision ? decision.roomPaise : 0;
          expect(withTax(lifetime + room, bps), `${ad}/${bps}/${spentShare}`).toBeLessThanOrEqual(ad);
        }
      }
    }
  });
});
