import { formatMoney, formatNumber } from "@/lib/format";
import { outcomeDefinition, type CampaignDestination } from "@/lib/campaign/outcomes";
import type { CampaignResult } from "@/lib/types";

type Figures = Pick<CampaignResult, "spend" | "leads" | "cpl" | "conversations" | "cost_per_conversation" | "landing_page_views" | "link_clicks">;
type FigureKey = "figures.chats" | "figures.leads" | "figures.visits" | "figures.unavailable";
type CostKey = "figures.costChat" | "figures.costLead" | "figures.costVisit" | "figures.costResult";

/** The headline count; unjudged destinations retain the legacy lead fallback, but no figures below. */
export function cardResultCount(outcome: CampaignDestination, r: Figures): number {
  return r[outcomeDefinition(outcome).campaignField] ?? 0;
}

/** The card's result and cost-per-result figures, as verdict message keys and display values ("—" when unknown). */
export function cardFigures(outcome: CampaignDestination, r: Figures): { label: FigureKey; value: string; costLabel: CostKey; cost: string; linkClicks?: string; cpc?: string } {
  const definition = outcomeDefinition(outcome);
  if (!definition.comparable) return { label: "figures.unavailable", value: "—", costLabel: "figures.costResult", cost: "—" };
  const count = r[definition.campaignField] ?? (definition.unit === "chat" ? null : 0);
  const cost = definition.costField ? r[definition.costField] : count && count > 0 ? Number(r.spend) / count : null;
  return {
    label: definition.figure, value: count != null ? formatNumber(count) : "—",
    costLabel: definition.costFigure, cost: count != null && cost != null ? formatMoney(cost) : "—",
    ...(definition.unit === "visit" ? {
      linkClicks: r.link_clicks != null ? formatNumber(r.link_clicks) : "—",
      cpc: r.link_clicks != null && r.link_clicks > 0 ? formatMoney(Number(r.spend) / r.link_clicks) : "—",
    } : {}),
  };
}
