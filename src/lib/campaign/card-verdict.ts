import type { PauseSuggestion } from "@/lib/campaign/ad-pause";
import { readCampaignHealth } from "@/lib/campaign/health";
import { campaignDestination } from "@/lib/campaign/outcomes";
import type { Comparison, VerdictInput } from "@/lib/campaign/verdict";
import type { Campaign, CampaignResult } from "@/lib/types";

type CardCampaign = Pick<Campaign, "id" | "status" | "created_at" | "raw" | "destination" | "objective">;
type CardResult = Pick<CampaignResult, "impressions" | "spend" | "leads" | "conversations" | "whatsapp_opens" | "destination">;

const resultsOf = (destination: "whatsapp" | "instant_form", result: CardResult) =>
  destination === "whatsapp" ? result.conversations ?? 0 : result.leads ?? 0;

/**
 * #1274 (#1255 slice 2): a campaign card's stored numbers as `verdict()` input. Only WhatsApp and form campaigns
 * get a verdict; others keep their figures. `liveSince` is when the run last started showing (health, #258).
 */
export function cardVerdictInput(campaign: CardCampaign, result: CardResult, extra: {
  now: number; waiting: number; weakAd: PauseSuggestion | null; comparison: Comparison | null;
}): VerdictInput | null {
  const destination = campaignDestination(campaign, result);
  if (destination !== "whatsapp" && destination !== "instant_form") return null;
  return {
    destination, status: campaign.status, liveSince: readCampaignHealth(campaign.raw)?.activeSince ?? null,
    impressions: result.impressions ?? 0, results: resultsOf(destination, result), spend: Number(result.spend ?? 0),
    opens: destination === "whatsapp" ? result.whatsapp_opens ?? null : null,
    waiting: extra.waiting, weakAd: extra.weakAd, comparison: extra.comparison, now: extra.now,
  };
}

/** The owner's own last campaign with the same destination, made before this one, as a comparison (gates apply in verdict()). */
export function lastCampaignComparison(campaign: CardCampaign, campaigns: CardCampaign[], results: Record<string, CardResult | undefined>): Comparison | null {
  const destination = campaignDestination(campaign, results[campaign.id]);
  if (destination !== "whatsapp" && destination !== "instant_form") return null;
  const before = Date.parse(campaign.created_at ?? "");
  const previous = campaigns
    .filter((other) => other.id !== campaign.id && results[other.id] && Date.parse(other.created_at ?? "") < before
      && campaignDestination(other, results[other.id]) === destination)
    .sort((a, b) => Date.parse(b.created_at ?? "") - Date.parse(a.created_at ?? ""))[0];
  const result = previous ? results[previous.id]! : null;
  const count = result ? resultsOf(destination, result) : 0;
  return result && count ? { kind: "own", results: count, typical: Number(result.spend ?? 0) / count } : null;
}
