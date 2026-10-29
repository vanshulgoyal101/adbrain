import { cappedRunEnded } from "@/lib/campaign/activation";
import type { PauseSuggestion } from "@/lib/campaign/ad-pause";
import { readCampaignHealth } from "@/lib/campaign/health";
import { campaignDestination } from "@/lib/campaign/outcomes";
import type { Words } from "@/i18n/words";
import { restatesStatus, verdict, type Comparison, type Verdict, type VerdictInput } from "@/lib/campaign/verdict";
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
    // #2281: a capped run past its end time has ended, whatever its row says (results-summary agrees).
    destination, status: campaign.status !== "draft" && cappedRunEnded(campaign.raw, extra.now) ? "completed" : campaign.status, liveSince: readCampaignHealth(campaign.raw)?.activeSince ?? null,
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

/** #1274 slice 2b: which running campaign Home speaks for, best first (CPO: "the best live campaign"). */
const HOME_ORDER: string[] = ["working", "about_average", "measured", "early", "not_showing", "not_showing_day", "no_results", "costly", "weak_ad"];

/**
 * Home's one sentence and number: the best running campaign's verdict, with the account's waiting enquiries in front,
 * plus each listed campaign's one-word verdict (none when it would only repeat the status). Null when no running campaign has results.
 */
export function homeVerdicts(campaigns: Array<CardCampaign & { id: string }>, results: Record<string, CardResult | undefined>, extra: { now?: number; waiting: number; words?: Words<"verdict"> }) {
  const now = extra.now ?? Date.now();
  const labels = new Map<string, string>();
  const live: Array<{ id: string; verdict: Verdict; input: VerdictInput }> = [];
  for (const campaign of campaigns) {
    const result = results[campaign.id];
    if (!result) continue;
    const input = cardVerdictInput(campaign, result, { now, waiting: 0, weakAd: null, comparison: lastCampaignComparison(campaign, campaigns, results) });
    if (!input) continue;
    const judged = verdict(input, extra.words);
    // #1795: 'Live' and 'Ended' restate the row's status ('Ended · Ended', 'Paused · Live'), so the row shows no word.
    if (!restatesStatus(judged.state)) labels.set(campaign.id, judged.label);
    if (input.status === "active") live.push({ id: campaign.id, verdict: judged, input });
  }
  const best = live.sort((a, b) => HOME_ORDER.indexOf(a.verdict.state) - HOME_ORDER.indexOf(b.verdict.state))[0];
  return { labels, lead: best ? { campaignId: best.id, verdict: verdict({ ...best.input, waiting: extra.waiting }, extra.words), input: best.input } : null };
}
