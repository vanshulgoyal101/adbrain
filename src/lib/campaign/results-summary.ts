import { cappedRunEnded } from "@/lib/campaign/activation";
import { campaignAttention } from "@/lib/campaign/health";
import { campaignDestination, outcomeDefinition } from "@/lib/campaign/outcomes";
import type { Campaign, CampaignResult } from "@/lib/types";
import { formatMoney } from "@/lib/format";

type CampaignResultWithConversions = CampaignResult & { conversions?: number | null };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function capDays(raw: unknown): number | null {
  const days = (raw as { cap?: { days?: unknown } } | null)?.cap?.days;
  return typeof days === "number" && Number.isInteger(days) && days > 0 ? days : null;
}

/**
 * A plain campaign summary for WhatsApp (#372), from stored results only (no Meta call):
 * spend against the limit, chats or enquiries, cost per result and one next step.
 */
export function campaignWhatsAppSummary(
  campaign: Pick<Campaign, "name" | "status" | "daily_budget" | "objective" | "destination" | "raw">,
  result: CampaignResultWithConversions,
): string {
  const destination = campaignDestination(campaign, result);
  const definition = outcomeDefinition(destination, campaign.objective);
  const whatsapp = destination === "whatsapp";
  const days = capDays(campaign.raw);
  const spent = formatMoney(result.spend);
  const spendLine = days && campaign.daily_budget
    ? `Spent ${spent} of the ${formatMoney(campaign.daily_budget * days)} limit`
    : campaign.daily_budget ? `Spent ${spent} (${formatMoney(campaign.daily_budget)} a day)` : `Spent ${spent}`;

  const conversionsUnavailable = definition.insightField === "conversions" && result.conversions == null;
  const count = conversionsUnavailable ? null : result[definition.campaignField] ?? 0;
  const unit = definition.summaryUnit;
  const real = whatsapp && result.real_enquiries ? `, ${plural(result.real_enquiries, "real enquiry", "real enquiries")}` : "";
  const countLine = conversionsUnavailable ? "Conversion results unavailable"
    : count !== null && count > 0 ? `${plural(count, unit.one, unit.many)}${real}` : `No ${unit.many} yet${real}`;
  const cost = conversionsUnavailable ? null : definition.costField ? result[definition.costField] : count !== null && count > 0 ? result.spend / count : null;
  const costLine = conversionsUnavailable ? `Cost per ${unit.per}: unavailable`
    : count !== null && count > 0 && cost != null ? `${formatMoney(cost)} per ${unit.per}` : `Cost per ${unit.per}: not yet`;

  const attention = campaignAttention(campaign);
  const next = campaign.status === "paused" ? "paused. Open AdBrain to review and resume."
    : campaign.status === "completed" || cappedRunEnded(campaign.raw) ? "finished. Open AdBrain to run it again."
    : campaign.status !== "active" ? "not running yet. Open AdBrain to launch it."
    : attention ? `needs a look. ${attention}`
    : result.spend > 0 ? "running fine, nothing to do."
    : "waiting for Meta to start showing the ad.";

  return [campaign.name ?? "Your campaign", spendLine, countLine, costLine, `Next: ${next}`].join("\n");
}
