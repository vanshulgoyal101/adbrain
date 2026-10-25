/**
 * The Meta ad account spending limit for a managed customer's child ad account (#522). Pure: the
 * caller reads the customer's balance and Meta's live account, then applies the decision.
 *
 * Meta stops all delivery when the account's `amount_spent` reaches `spend_cap`, and a new cap
 * "only applies to spend AFTER the time at which you set it" (Ad Account reference). So the limit
 * is set as Meta's live `amount_spent` plus the media the customer has left; it is never written
 * as 0, which Meta reads as no limit at all. Defence in depth: per-campaign caps and reservations
 * (#208) still apply.
 */

export interface ChildSpendCapInput {
  /** The customer's ad share of captured payments, GST included (`customer_ad_balance`). */
  advertisingAllocationPaise: number;
  advertisingRefundedPaise: number;
  /** The balance is held for payment, refund or cost reconciliation. */
  held: boolean;
  /** GST on Meta media, in basis points (1800 by default). */
  taxRateBps: number;
  /** Media AdBrain attributes to this customer on ad accounts other than the child. */
  mediaOnOtherAccountsPaise: number;
  /** The child account's lifetime media as best known (Insights or attributed costs). */
  lifetimeMediaSpentPaise: number;
  /** Meta's live read of the child account, both in paise. */
  account: { spendCapPaise: number; amountSpentPaise: number };
}

export type ChildSpendCapDecision =
  | { action: "set" | "keep"; capPaise: number; roomPaise: number }
  | { action: "freeze"; capPaise: number; reason: "held" | "exhausted" }
  /**
   * No room and nothing spent: only a cap of 0 would stop Meta, and 0 means no limit. Pause every
   * campaign on the child account and lower its limit to the smallest Meta accepts (#527 records it).
   */
  | { action: "stop"; reason: "held" | "no_allowance" };

export class SpendCapInputError extends Error {
  constructor() {
    super("The managed account's spending limit cannot be verified. Keep its campaigns paused.");
    this.name = "SpendCapInputError";
  }
}

const paise = (value: number) => Number.isSafeInteger(value) && value >= 0;

/** The media (excluding GST) a customer can buy in total, net of media on their other accounts, in paise. */
export function lifetimeMediaAllowancePaise(input: Pick<ChildSpendCapInput,
  "advertisingAllocationPaise" | "advertisingRefundedPaise" | "taxRateBps" | "mediaOnOtherAccountsPaise">): number {
  const net = Math.max(0, input.advertisingAllocationPaise - input.advertisingRefundedPaise);
  // The largest media m with ceil(m × (1 + GST)) ≤ net, so media plus Meta's GST fits the ad share.
  const media = Number(BigInt(net) * BigInt(10_000) / BigInt(10_000 + input.taxRateBps));
  return Math.max(0, media - input.mediaOnOtherAccountsPaise);
}

export function childSpendCap(input: ChildSpendCapInput): ChildSpendCapDecision {
  const figures = [input.advertisingAllocationPaise, input.advertisingRefundedPaise, input.mediaOnOtherAccountsPaise,
    input.lifetimeMediaSpentPaise, input.account.spendCapPaise, input.account.amountSpentPaise];
  if (!figures.every(paise) || !Number.isInteger(input.taxRateBps) || input.taxRateBps < 0 || input.taxRateBps > 10_000) {
    throw new SpendCapInputError();
  }
  const spentNow = input.account.amountSpentPaise;
  // Meta may count amount_spent from when the cap was set; the lifetime figure is the upper bound.
  const lifetime = Math.max(input.lifetimeMediaSpentPaise, spentNow);
  const room = input.held ? 0 : Math.max(0, lifetimeMediaAllowancePaise(input) - lifetime);
  if (room > 0) {
    const capPaise = spentNow + room;
    return { action: input.account.spendCapPaise === capPaise ? "keep" : "set", capPaise, roomPaise: room };
  }
  // A cap equal to the amount spent stops delivery. With nothing spent only 0 would, and 0 means no limit,
  // so an older limit could stay usable after a refund or hold: the caller stops the account instead.
  if (spentNow === 0) return { action: "stop", reason: input.held ? "held" : "no_allowance" };
  return { action: "freeze", capPaise: spentNow, reason: input.held ? "held" : "exhausted" };
}
