/**
 * Learning loop: turn a business's past campaigns + their results into a compact
 * context block the planner can read, so new campaigns favour the angles/areas
 * that produced cheaper leads. Pure and side-effect free for easy testing.
 */

export interface CampaignPerf {
  name: string;
  angles: string[];
  area: string | null;
  dailyBudget: number | null;
  leads: number;
  spend: number;
  cpl: number | null;
  status: string;
}

/** Rank: most leads first, then cheapest cost-per-lead. */
function rank(a: CampaignPerf, b: CampaignPerf): number {
  if (a.leads !== b.leads) return b.leads - a.leads;
  return (a.cpl ?? Infinity) - (b.cpl ?? Infinity);
}

function resultText(r: CampaignPerf): string {
  if (r.leads > 0) {
    return `${r.leads} lead${r.leads === 1 ? "" : "s"}${
      r.cpl != null ? ` at ₹${Math.round(r.cpl)} per lead` : ""
    }`;
  }
  if (r.spend > 0) return `₹${Math.round(r.spend)} spent, no leads yet`;
  return "no delivery yet";
}

/**
 * Build a short, ranked summary of past campaigns and their results. Only
 * campaigns that have spent or produced leads are included (drafts/paused-unrun
 * campaigns carry no signal). Returns "" when there's nothing to learn from.
 */
export function buildPerformanceContext(
  rows: CampaignPerf[],
  max = 8,
): string {
  const meaningful = rows.filter((r) => r.leads > 0 || r.spend > 0);
  if (!meaningful.length) return "";

  const lines = [...meaningful]
    .sort(rank)
    .slice(0, max)
    .map((r) => {
      const parts = [`"${r.name}"`];
      if (r.angles.length) parts.push(`angle ${r.angles.join("/")}`);
      if (r.area) parts.push(r.area);
      if (r.dailyBudget) parts.push(`₹${Math.round(r.dailyBudget)}/day`);
      return `- ${parts.join(", ")} → ${resultText(r)}`;
    });

  return lines.join("\n");
}
