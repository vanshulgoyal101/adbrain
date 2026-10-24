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

  it("stops every campaign when there is no room and nothing spent, since only 0 could cap it and 0 means no limit (QA)", () => {
    expect(childSpendCap({ ...fresh, advertisingAllocationPaise: 0 })).toEqual({ action: "stop", reason: "no_allowance" });
    expect(childSpendCap({ ...fresh, held: true })).toEqual({ action: "stop", reason: "held" });
    // A live limit from before the refund or hold must not stay usable.
    const funded = { ...fresh, account: { spendCapPaise: 33_898, amountSpentPaise: 0 } };
    expect(childSpendCap({ ...funded, advertisingRefundedPaise: 40_000 })).toEqual({ action: "stop", reason: "no_allowance" });
    expect(childSpendCap({ ...funded, held: true })).toEqual({ action: "stop", reason: "held" });
  });

  it("counts Meta's spend when it is ahead of AdBrain's evidence (QA)", () => {
    const ahead = { ...fresh, lifetimeMediaSpentPaise: 0, account: { spendCapPaise: 33_898, amountSpentPaise: 20_000 } };
    expect(childSpendCap(ahead)).toEqual({ action: "keep", capPaise: 33_898, roomPaise: 13_898 });
  });

  it("refuses figures it cannot trust", () => {
    for (const broken of [
      { ...fresh, advertisingAllocationPaise: -1 }, { ...fresh, taxRateBps: 10_001 }, { ...fresh, lifetimeMediaSpentPaise: 1.5 },
      { ...fresh, account: { spendCapPaise: Number.NaN, amountSpentPaise: 0 } },
    ]) expect(() => childSpendCap(broken)).toThrow(/cannot be verified/);
  });

  it("never lets total media with GST pass the customer's ad share, whichever figure is ahead (QA)", () => {
    for (const ad of [100, 999, 40_000, 123_457, 800_000]) {
      for (const bps of [0, 500, 1800]) {
        for (const refunded of [0, Math.floor(ad / 4)]) {
          const net = ad - refunded;
          const allowance = Math.floor(net * 10_000 / (10_000 + bps));
          for (const other of [0, Math.floor(allowance / 5)]) {
            for (const [lifetimeShare, spentShare] of [[0, 0], [0.3, 0.1], [0.1, 0.5], [0, 0.9], [0.99, 0.99]]) {
              const lifetime = Math.floor(allowance * lifetimeShare);
              const spent = Math.floor(allowance * spentShare);
              const decision = childSpendCap({ ...fresh, advertisingAllocationPaise: ad, advertisingRefundedPaise: refunded, taxRateBps: bps,
                mediaOnOtherAccountsPaise: other, lifetimeMediaSpentPaise: lifetime, account: { spendCapPaise: 0, amountSpentPaise: spent } });
              if (decision.action !== "set" && decision.action !== "keep") continue;
              // The invariant from Meta's side: what it lets the account spend from here on.
              const room = decision.capPaise - spent;
              expect(room, `${ad}/${bps}/${refunded}/${other}/${lifetimeShare}/${spentShare}`).toBe(decision.roomPaise);
              expect(withTax(other + Math.max(lifetime, spent) + room, bps), `${ad}/${bps}/${refunded}/${other}/${lifetimeShare}/${spentShare}`).toBeLessThanOrEqual(net);
            }
          }
        }
      }
    }
  });
});
