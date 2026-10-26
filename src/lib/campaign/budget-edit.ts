import { formatMoney } from "@/lib/format";
import { wouldExceedCap, type CampaignSpend } from "@/lib/campaign/spend";
import { fundingShortfall, type AccountFunding } from "@/lib/campaign/funding-check";
import type { FundingMode } from "@/lib/payments/operator-funding";

export type BudgetEditInput = {
  current: { status: string; dailyRupees: number; capRupees: number | null; endTime: string | null; spentRupees: number };
  /** What the owner last confirmed (activation or a previous edit). */
  approved: { dailyRupees: number; capRupees: number | null };
  change: { dailyRupees?: number; capRupees?: number; endTime?: string };
  /** The business's other active campaigns, for the weekly limit in Settings. */
  otherActive: CampaignSpend[];
  weeklyLimitRupees: number | null;
  /** Who pays Meta (#806) and what that payer has left: the ad account's funding, or the AdBrain allowance. */
  funding: { mode: FundingMode; account: AccountFunding | null; allowancePaise?: number | null };
  now: number;
};

export type BudgetEditCheck = { ok: true; needsConfirmation: boolean; notices: string[] } | { ok: false; message: string };

/** Meta's wording: a budget change "may or may not be significant, depending on the magnitude"; a fifth is our line. */
const LEARNING_CHANGE = 0.2;
export const LEARNING_NOTICE = "This is a big budget change, so it may restart Meta's learning; results can be slower for 2–3 days.";

/** #774: the money rules for editing a launched campaign's budget, cap and end date, before any Meta call. */
export function checkBudgetEdit(input: BudgetEditInput): BudgetEditCheck {
  const { current, approved, change } = input;
  const daily = change.dailyRupees;
  const cap = change.capRupees;
  const end = change.endTime;
  const refuse = (message: string): BudgetEditCheck => ({ ok: false, message });

  if ((daily === undefined || daily === current.dailyRupees) && (cap === undefined || cap === current.capRupees) && (end === undefined || end === current.endTime)) {
    return refuse("Nothing to change: the budget, cap and end date are as they are now.");
  }
  if (daily !== undefined && !(Number.isFinite(daily) && daily > 0)) return refuse("Set a daily budget above ₹0.");
  if (cap !== undefined && !(Number.isFinite(cap) && cap > current.spentRupees)) {
    return refuse(`This campaign has already spent ${formatMoney(current.spentRupees)}. Set a total cap above that.`);
  }
  if (end !== undefined && !(Date.parse(end) > input.now)) return refuse("Choose an end date in the future.");

  const nextDaily = daily ?? current.dailyRupees;
  if (current.status === "active" && daily !== undefined && daily > current.dailyRupees) {
    const guard = wouldExceedCap(input.otherActive, nextDaily, input.weeklyLimitRupees);
    if (guard.exceeds) {
      return refuse(input.weeklyLimitRupees === null
        ? "AdBrain couldn't check this against your weekly limit. Try again."
        : `${formatMoney(nextDaily)} a day would take your campaigns past your weekly limit of ${formatMoney(input.weeklyLimitRupees)} in Settings.`);
    }
  }
  if (cap !== undefined && (current.capRupees === null || cap > current.capRupees)) {
    // What the run may still spend under the new cap.
    const neededPaise = Math.round((cap - current.spentRupees) * 100);
    const short = fundingShortfall({ ...input.funding, neededPaise });
    if (short?.kind === "no_limit") return refuse("Set a spending limit on the Meta ad account before raising the cap.");
    if (short?.kind === "short") return refuse(`Meta has ${formatMoney(short.roomPaise / 100)} left under the ad account's spending limit; this cap needs ${formatMoney(short.neededPaise / 100)}. Add funds on Meta or choose a lower cap.`);
    if (short?.kind === "allowance") return refuse("The new cap is more than the available advertising funds.");
    if (short?.kind === "unverified") return refuse("AdBrain couldn't check the funding for this cap. Try again.");
  }

  const needsConfirmation = nextDaily > approved.dailyRupees || (cap !== undefined && (approved.capRupees === null || cap > approved.capRupees));
  const notices = daily !== undefined && current.dailyRupees > 0 && Math.abs(daily / current.dailyRupees - 1) >= LEARNING_CHANGE ? [LEARNING_NOTICE] : [];
  return { ok: true, needsConfirmation, notices };
}
