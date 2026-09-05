/**
 * Pre-launch budget helper: translate a daily rupee budget into a plain-language
 * "leads per week" estimate for non-marketer users. Before a campaign has run,
 * we can only estimate from a rough cost-per-lead band; once real insights come
 * back, pass the actual CPL for an exact figure.
 */

/** Quick daily-budget presets shown as one-tap chips (INR). */
export const BUDGET_PRESETS = [200, 500, 1000] as const;

/**
 * Rough local lead-gen cost-per-lead band (INR), used ONLY for the pre-launch
 * estimate. Deliberately wide and clearly labelled an estimate; the real CPL
 * from the first results refresh supersedes it.
 */
export const ASSUMED_CPL_LOW = 80;
export const ASSUMED_CPL_HIGH = 250;

export interface LeadEstimate {
  weeklyBudget: number;
  low: number;
  high: number;
  exact: boolean;
}

/** Estimate weekly leads from a daily budget (and an actual CPL when known). */
export function estimateLeadsPerWeek(
  dailyBudget: number,
  cpl?: number | null,
): LeadEstimate | null {
  if (!Number.isFinite(dailyBudget) || dailyBudget <= 0) return null;
  const weeklyBudget = dailyBudget * 7;
  if (cpl && cpl > 0) {
    const n = Math.round(weeklyBudget / cpl);
    return { weeklyBudget, low: n, high: n, exact: true };
  }
  const low = Math.floor(weeklyBudget / ASSUMED_CPL_HIGH);
  const high = Math.round(weeklyBudget / ASSUMED_CPL_LOW);
  return { weeklyBudget, low, high, exact: false };
}

/** One-line, human-friendly budget description. */
export function describeBudget(dailyBudget: number, cpl?: number | null): string {
  const est = estimateLeadsPerWeek(dailyBudget, cpl);
  if (!est) return "Enter a daily budget to see an estimate.";
  if (est.exact) {
    const leads = est.low;
    return `About ${leads} lead${leads === 1 ? "" : "s"}/week at your current cost per lead.`;
  }
  if (est.high <= 0) {
    return "This budget may be too low for steady leads — try a bit more.";
  }
  if (est.low <= 0) {
    return `Roughly up to ${est.high} leads/week (rough estimate).`;
  }
  return `Roughly ${est.low}–${est.high} leads/week (rough estimate).`;
}

export type SpendTone = "idle" | "good" | "ok" | "warn";

export interface SpendHealth {
  tone: SpendTone;
  /** Short badge label. */
  label: string;
  /** One plain-language line for the owner. */
  detail: string;
}

/**
 * Turn a campaign's real results into a plain-language spend-health signal —
 * the thing a non-technical owner actually worries about: am I spending money
 * with nothing to show? Pure; formats money with the given formatter.
 */
function asMoneyFormatter(
  money: ((n: number) => string) | string = (n) => `₹${Math.round(n)}`,
): (n: number) => string {
  if (typeof money === "function") return money;
  return (n: number) => `${money}${Math.round(n)}`;
}

export function spendHealth(
  input: { spend: number; leads: number; cpl?: number | null },
  money: ((n: number) => string) | string = (n) => `₹${Math.round(n)}`,
): SpendHealth {
  const formatMoney = asMoneyFormatter(money);
  const spend = Number.isFinite(input.spend) ? input.spend : 0;
  const leads = Number.isFinite(input.leads) ? Math.max(0, Math.floor(input.leads)) : 0;

  if (spend <= 0) {
    return { tone: "idle", label: "No spend yet", detail: "This campaign hasn't spent anything yet." };
  }
  if (leads <= 0) {
    return {
      tone: "warn",
      label: "No leads yet",
      detail: `Spent ${formatMoney(spend)} with no leads yet — review the offer, creative, or targeting before spending more.`,
    };
  }
  const cpl = input.cpl && input.cpl > 0 ? input.cpl : spend / leads;
  if (cpl <= ASSUMED_CPL_LOW) {
    return { tone: "good", label: "Cheap leads", detail: `About ${formatMoney(cpl)} per lead — great value.` };
  }
  if (cpl <= ASSUMED_CPL_HIGH) {
    return { tone: "ok", label: "On track", detail: `About ${formatMoney(cpl)} per lead.` };
  }
  return {
    tone: "warn",
    label: "Pricey leads",
    detail: `About ${formatMoney(cpl)} per lead — consider adjusting the audience or offer.`,
  };
}

/**
 * Plain-language owner narrative for a campaign's early results. This is meant
 * to read like a confident operator summary, not costly metric jargon.
 */
export function campaignNarrative(
  input: { spend: number; leads: number; cpl?: number | null },
  money: ((n: number) => string) | string = (n) => `₹${Math.round(n)}`,
): string {
  const formatMoney = asMoneyFormatter(money);
  const spend = Number.isFinite(input.spend) ? input.spend : 0;
  const leads = Number.isFinite(input.leads) ? Math.max(0, Math.floor(input.leads)) : 0;

  if (spend <= 0) {
    return "No spend yet — this campaign is waiting for its first delivery.";
  }
  if (leads <= 0) {
    return `No leads yet — ${formatMoney(spend)} has been spent and the campaign is still learning.`;
  }

  const cpl = input.cpl && input.cpl > 0 ? input.cpl : spend / leads;
  if (cpl <= ASSUMED_CPL_LOW) {
    return `Healthy signal: ${leads} leads from ${formatMoney(spend)} with about ${formatMoney(cpl)} per lead.`;
  }
  if (cpl <= ASSUMED_CPL_HIGH) {
    return `Steady performance: ${leads} leads from ${formatMoney(spend)} and roughly ${formatMoney(cpl)} per lead.`;
  }
  return `Needs attention: ${leads} leads from ${formatMoney(spend)} with about ${formatMoney(cpl)} per lead.`;
}

export function campaignNextAction(
  input: { spend: number; leads: number; cpl?: number | null },
): string {
  const spend = Number.isFinite(input.spend) ? input.spend : 0;
  const leads = Number.isFinite(input.leads) ? Math.max(0, Math.floor(input.leads)) : 0;

  if (spend <= 0) {
    return "Waiting for its first delivery — keep the campaign paused until you're happy with the creative and audience.";
  }
  if (leads <= 0) {
    return "Review your offer, creative, or audience — the campaign is spending money but not converting yet.";
  }

  const cpl = input.cpl && input.cpl > 0 ? input.cpl : spend / leads;
  if (cpl <= ASSUMED_CPL_LOW) {
    return "Keep it running and scale the budget if the lead quality keeps holding up.";
  }
  if (cpl <= ASSUMED_CPL_HIGH) {
    return "Keep it running and monitor the lead quality before changing the offer or audience.";
  }
  return "Tighten the audience or offer — the current CPL is higher than the target range.";
}
