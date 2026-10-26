import { formatMoney } from "@/lib/format";
import { wouldExceedCap, type CampaignSpend } from "@/lib/campaign/spend";

export type BudgetEditInput = {
  current: { status: string; dailyRupees: number; capRupees: number | null; endTime: string | null; spentRupees: number };
  /** What the owner last confirmed (activation or a previous edit). */
  approved: { dailyRupees: number; capRupees: number | null };
  change: { dailyRupees?: number; capRupees?: number; endTime?: string };
  /** The business's other active campaigns, for the weekly limit in Settings. */
  otherActive: CampaignSpend[];
  weeklyLimitRupees: number | null;
  /** Prepaid ad account room (operator-funded runs); null when the account isn't prepaid. */
  fundingRoomPaise: number | null;
  now: number;
};

export type BudgetEditCheck = { ok: true; needsConfirmation: boolean; notices: string[] } | { ok: false; message: string };

/** Meta's 18% GST on Indian ad spend, as `META_GST_RATE_BPS` (managed/spend-cap-sync.ts, server-only). */
const META_GST_RATE_BPS = 1800;
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
  if (cap !== undefined && input.fundingRoomPaise !== null && current.capRupees !== null && cap > current.capRupees) {
    const neededPaise = Math.ceil((cap - current.capRupees) * 100 * (10_000 + META_GST_RATE_BPS) / 10_000);
    if (neededPaise > input.fundingRoomPaise) {
      return refuse(`Raising the cap by ${formatMoney(cap - current.capRupees)} needs ${formatMoney(neededPaise / 100)} in the ad account, including 18% GST. It has ${formatMoney(input.fundingRoomPaise / 100)}. Add funds first.`);
    }
  }

  const needsConfirmation = nextDaily > approved.dailyRupees || (cap !== undefined && (approved.capRupees === null || cap > approved.capRupees));
  const notices = daily !== undefined && current.dailyRupees > 0 && Math.abs(daily / current.dailyRupees - 1) >= LEARNING_CHANGE ? [LEARNING_NOTICE] : [];
  return { ok: true, needsConfirmation, notices };
}
