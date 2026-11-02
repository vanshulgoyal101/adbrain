/**
 * Learning loop: turn a business's past campaigns + their results into a compact
 * context block the planner can read, so new campaigns favour the angles/areas
 * that produced cheaper leads. Pure and side-effect free for easy testing.
 */

import { outcomeDefinition, type CampaignDestination } from "./outcomes";

export interface CampaignPerf {
  destination: CampaignDestination;
  name: string;
  angles: string[];
  area: string | null;
  dailyBudget: number | null;
  leads: number;
  spend: number;
  cpl: number | null;
  conversations?: number | null;
  costPerConversation?: number | null;
  /** #2601: a website campaign's result (Meta landing-page views). */
  landingPageViews?: number | null;
  status: string;
}

/** Rank: most leads first, then cheapest cost-per-lead. */
function rank(a: CampaignPerf, b: CampaignPerf): number {
  // #2601: website visits rank after leads and chats; they are far cheaper and are not enquiries.
  const group = (row: CampaignPerf) => {
    const definition = outcomeDefinition(row.destination);
    return definition.unit === "chat" && row[definition.insightField] == null ? 3 : definition.performanceRank;
  };
  if (group(a) !== group(b)) return group(a) - group(b);
  if (group(a) === 3) return b.spend - a.spend;
  const definition = outcomeDefinition(a.destination);
  const results = (row: CampaignPerf) => row[definition.insightField] ?? 0;
  const cost = (row: CampaignPerf) => definition.insightCostField ? row[definition.insightCostField] ?? Infinity
    : results(row) ? row.spend / results(row) : Infinity;
  return results(b) - results(a) || cost(a) - cost(b);
}

function resultText(r: CampaignPerf): string {
  const definition = outcomeDefinition(r.destination);
  const count = r[definition.insightField];
  if (!definition.comparable) return `INR ${Math.round(r.spend)} spent; comparable outcome metrics unavailable (${r.destination}).`;
  if (definition.unit === "chat" && count == null) return `INR ${Math.round(r.spend)} spent; WhatsApp conversation metrics unavailable. Refresh required.`;
  if (definition.unit === "visit") {
    const visits = count ?? 0;
    return visits > 0
      ? `${visits} website visit${visits === 1 ? "" : "s"} (landing-page views) at INR ${Math.round(r.spend / visits)} per visit; INR ${Math.round(r.spend)} spent. Visits are not enquiries.`
      : `INR ${Math.round(r.spend)} spent, no website visits yet.`;
  }
  if (definition.unit === "chat") return `${count} WhatsApp conversations started${r.costPerConversation != null ? ` at INR ${Math.round(r.costPerConversation)} per conversation` : ""}; INR ${Math.round(r.spend)} spent. Conversations are not verified leads or sales.`;
  if (count != null && count > 0) {
    return `${count} lead${count === 1 ? "" : "s"}${
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
  const meaningful = rows.filter((r) => r.leads > 0 || r.spend > 0 || (r.conversations ?? 0) > 0 || (r.landingPageViews ?? 0) > 0);
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
