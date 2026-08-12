/**
 * Pre-launch budget helper: translate a daily rupee budget into a plain-language
 * "leads per week" estimate for non-marketer users. Before a campaign has run,
 * we can only estimate from a rough cost-per-lead band; once real insights come
 * back, pass the actual CPL for an exact figure.
 */

/** Quick daily-budget presets shown as one-tap chips (INR). */
export const BUDGET_PRESETS = [200, 500, 1000] as const;

/**
 * Rough solar lead-gen cost-per-lead band (INR), used ONLY for the pre-launch
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
