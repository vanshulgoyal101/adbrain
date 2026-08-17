/**
 * Spend guardrails — pure evaluation logic (no I/O).
 *
 * Campaigns are created paused; money is only committed once a campaign is
 * ACTIVE. So the forward-looking guard is the **projected weekly commitment**
 * (sum of active campaigns' daily budgets × 7), and the backward-looking signal
 * is **tracked spend** (the latest insights snapshot summed across campaigns).
 * The cap is gauged against whichever is larger.
 */

export const WEEK_DAYS = 7;

/** Per-business guardrail configuration. */
export interface SpendLimits {
  /** Weekly ad-spend ceiling in rupees; null = no cap. */
  weeklyCapRupees: number | null;
  /** Warn once used spend reaches this percent of the cap (1–100). */
  alertPct: number;
  /** Auto-pause active campaigns once tracked spend reaches the cap. */
  autoPause: boolean;
}

export const DEFAULT_SPEND_LIMITS: SpendLimits = {
  weeklyCapRupees: null,
  alertPct: 80,
  autoPause: false,
};

/** The minimal campaign shape the guardrails need. */
export interface CampaignSpend {
  id: string;
  status: string;
  /** Daily budget in rupees (null when Meta uses ad-set budget). */
  dailyBudget: number | null;
  /** Actual tracked spend in rupees from the latest results snapshot. */
  spend: number;
}

export type GuardStatus = "off" | "ok" | "approaching" | "over";

export interface SpendEvaluation {
  capRupees: number | null;
  projectedWeekly: number;
  trackedSpend: number;
  /** The figure gauged against the cap: max(projected, tracked). */
  usedRupees: number;
  /** Percent of the cap used (0 when no cap). */
  pct: number;
  status: GuardStatus;
  /** Rupees of headroom left under the cap (0 when over or no cap). */
  headroomRupees: number;
}

const isActive = (c: CampaignSpend) => c.status === "active";
const num = (n: number | null | undefined) =>
  Number.isFinite(n as number) && (n as number) > 0 ? (n as number) : 0;

/** Projected weekly commitment from currently-active campaigns. */
export function projectedWeeklySpend(campaigns: CampaignSpend[]): number {
  return campaigns
    .filter(isActive)
    .reduce((sum, c) => sum + num(c.dailyBudget) * WEEK_DAYS, 0);
}

/** Total tracked spend across all campaigns (from latest snapshots). */
export function trackedSpend(campaigns: CampaignSpend[]): number {
  return campaigns.reduce((sum, c) => sum + num(c.spend), 0);
}

/** Evaluate the guardrail status for a business. */
export function evaluateSpend(
  campaigns: CampaignSpend[],
  limits: SpendLimits,
): SpendEvaluation {
  const projectedWeekly = projectedWeeklySpend(campaigns);
  const tracked = trackedSpend(campaigns);
  const usedRupees = Math.max(projectedWeekly, tracked);
  const cap = limits.weeklyCapRupees;

  if (!cap || cap <= 0) {
    return {
      capRupees: null,
      projectedWeekly,
      trackedSpend: tracked,
      usedRupees,
      pct: 0,
      status: "off",
      headroomRupees: 0,
    };
  }

  const pct = Math.round((usedRupees / cap) * 100);
  const status: GuardStatus =
    usedRupees >= cap ? "over" : pct >= limits.alertPct ? "approaching" : "ok";

  return {
    capRupees: cap,
    projectedWeekly,
    trackedSpend: tracked,
    usedRupees,
    pct,
    status,
    headroomRupees: Math.max(cap - usedRupees, 0),
  };
}

/**
 * Whether turning on (or creating active) a campaign with `newDailyBudget`
 * would push the projected weekly commitment past the cap.
 */
export function wouldExceedCap(
  activeCampaigns: CampaignSpend[],
  newDailyBudgetRupees: number,
  capRupees: number | null,
): { exceeds: boolean; projectedAfter: number } {
  const projectedAfter =
    projectedWeeklySpend(activeCampaigns) + num(newDailyBudgetRupees) * WEEK_DAYS;
  if (!capRupees || capRupees <= 0) return { exceeds: false, projectedAfter };
  return { exceeds: projectedAfter > capRupees, projectedAfter };
}

/**
 * Active campaign ids that should be auto-paused: only when auto-pause is on and
 * tracked spend has reached the cap. Returns [] otherwise.
 */
export function campaignsToAutoPause(
  campaigns: CampaignSpend[],
  limits: SpendLimits,
): string[] {
  const cap = limits.weeklyCapRupees;
  if (!limits.autoPause || !cap || cap <= 0) return [];
  if (trackedSpend(campaigns) < cap) return [];
  return campaigns.filter(isActive).map((c) => c.id);
}
