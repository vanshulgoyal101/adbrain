import { formatMoney } from "@/lib/format";
import { wouldExceedCap, type CampaignSpend } from "@/lib/campaign/spend";
import { fundingShortfall, type AccountFunding } from "@/lib/campaign/funding-check";
import type { FundingMode } from "@/lib/payments/operator-funding";

export type BudgetEditInput = {
  current: { status: string; dailyRupees: number; capRupees: number | null; endTime: string | null; spentRupees: number };
  /** What the owner last confirmed (activation or a previous edit). */
  approved: { dailyRupees: number; capRupees: number | null; capDays?: number | null };
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
  // Meta won't switch an ad set from a daily budget to a lifetime one (QA on #833).
  if (cap !== undefined && current.capRupees === null) {
    return refuse("This campaign runs on a daily budget with no total cap, and Meta can't add one to it. To cap the spend, start a new run.");
  }

  const nextDaily = daily ?? current.dailyRupees;
  if (current.status === "active" && daily !== undefined && daily > current.dailyRupees) {
    const guard = wouldExceedCap(input.otherActive, nextDaily, input.weeklyLimitRupees);
    if (guard.exceeds) {
      return refuse(!guard.verified || input.weeklyLimitRupees === null
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

  // A capped run spends what's left of its cap over the days left: a shorter end or a bigger cap speeds it up
  // (Reviewer on #901). Above both the approved pace (cap / days) and today's pace it needs a confirmation and, while running, the weekly limit.
  let fasterPace: number | null = null;
  if (current.capRupees !== null && (cap !== undefined || end !== undefined)) {
    const daysLeft = (iso: string | null) => iso === null ? null : Math.max((Date.parse(iso) - input.now) / 86_400_000, 1 / 24);
    const pace = (capRupees: number, endIso: string | null) => {
      const days = daysLeft(endIso);
      return days === null ? null : Math.max(capRupees - current.spentRupees, 0) / days;
    };
    const after = pace(cap ?? current.capRupees, end ?? current.endTime);
    // Only an edit that speeds spending up past both the approved pace and today's pace counts.
    const before = pace(current.capRupees, current.endTime);
    const approvedPace = approved.capRupees !== null && approved.capDays ? approved.capRupees / approved.capDays : before;
    if (after !== null && before !== null && approvedPace !== null && after > Math.max(approvedPace, before) + 0.005) {
      fasterPace = after;
      if (current.status === "active") {
        const guard = wouldExceedCap(input.otherActive, after, input.weeklyLimitRupees);
        if (guard.exceeds) {
          return refuse(!guard.verified || input.weeklyLimitRupees === null
            ? "AdBrain couldn't check this against your weekly limit. Try again."
            : `About ${formatMoney(Math.round(after))} a day would take your campaigns past your weekly limit of ${formatMoney(input.weeklyLimitRupees)} in Settings.`);
        }
      }
    }
  }

  // Running longer adds spend only when there's no cap to hold it (CTO on #833).
  const runsLonger = end !== undefined && current.capRupees === null && current.endTime !== null && Date.parse(end) > Date.parse(current.endTime);
  const needsConfirmation = nextDaily > approved.dailyRupees || runsLonger || fasterPace !== null || (cap !== undefined && (approved.capRupees === null || cap > approved.capRupees));
  const notices = daily !== undefined && current.dailyRupees > 0 && Math.abs(daily / current.dailyRupees - 1) >= LEARNING_CHANGE ? [LEARNING_NOTICE] : [];
  if (fasterPace !== null) notices.push(`Meta will spend about ${formatMoney(Math.round(fasterPace))} a day to use the total by the end date.`);
  return { ok: true, needsConfirmation, notices };
}
