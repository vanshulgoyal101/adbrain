import { formatMoney, formatNumber } from "@/lib/format";
import type { CampaignDestination } from "@/lib/campaign/outcomes";
import type { CampaignResult } from "@/lib/types";

type Figures = Pick<CampaignResult, "spend" | "leads" | "cpl" | "conversations" | "cost_per_conversation" | "landing_page_views" | "link_clicks">;
type FigureKey = "figures.chats" | "figures.leads" | "figures.visits" | "figures.unavailable";
type CostKey = "figures.costChat" | "figures.costLead" | "figures.costVisit" | "figures.costResult";

/** The card's headline result: chats, form leads or (#2601) website visits; 0 for a destination it can't judge. */
export function cardResultCount(outcome: CampaignDestination, r: Figures): number {
  return outcome === "whatsapp" ? r.conversations ?? 0 : outcome === "website" ? r.landing_page_views ?? 0 : r.leads;
}

/** The card's result and cost-per-result figures, as verdict message keys and display values ("—" when unknown). */
export function cardFigures(outcome: CampaignDestination, r: Figures): { label: FigureKey; value: string; costLabel: CostKey; cost: string; linkClicks?: string; cpc?: string } {
  if (outcome === "whatsapp") {
    return {
      label: "figures.chats", value: r.conversations != null ? formatNumber(r.conversations) : "—",
      costLabel: "figures.costChat", cost: r.conversations != null && r.cost_per_conversation != null ? formatMoney(r.cost_per_conversation) : "—",
    };
  }
  if (outcome === "instant_form") {
    return { label: "figures.leads", value: formatNumber(r.leads), costLabel: "figures.costLead", cost: r.cpl != null ? formatMoney(r.cpl) : "—" };
  }
  if (outcome === "website") {
    const visits = r.landing_page_views ?? 0;
    return {
      label: "figures.visits", value: formatNumber(visits), costLabel: "figures.costVisit", cost: visits > 0 ? formatMoney(Number(r.spend) / visits) : "—",
      linkClicks: r.link_clicks != null ? formatNumber(r.link_clicks) : "—",
      cpc: r.link_clicks != null && r.link_clicks > 0 ? formatMoney(Number(r.spend) / r.link_clicks) : "—",
    };
  }
  return { label: "figures.unavailable", value: "—", costLabel: "figures.costResult", cost: "—" };
}
