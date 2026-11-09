"use client";

import { useEffect, useState } from "react";
import { PauseOffer, useWeakAd } from "@/components/ad-results";
import { CampaignVerdict } from "@/components/campaign-verdict";
import { Stat } from "@/components/campaign-parts";
import { BEST_AD_MIN_RESULTS } from "@/lib/campaign/ad-results";
import { cardFigures, cardResultCount } from "@/lib/campaign/card-figures";
import { cardVerdictInput } from "@/lib/campaign/card-verdict";
import { campaignDestination } from "@/lib/campaign/outcomes";
import { verdict, type Comparison } from "@/lib/campaign/verdict";
import { formatNumber } from "@/lib/format";
import { verdictTranslator, type Words } from "@/i18n/words";
import type { Campaign, CampaignResult } from "@/lib/types";

/** A launched campaign's results and cost, with supporting figures under Details. */
export function CardResults({ campaign, result: r, outcome, comparison, waiting, onRunAgain, runAgainBusy, adsManagerUrl, onEditAd, perAd, onWeakAd, metaMessage = null, words }: {
  campaign: Campaign; result: CampaignResult; outcome: ReturnType<typeof campaignDestination>; comparison: Comparison | null;
  /** #1841: Meta's own words for a rejected ad, in the card's one Details. */
  metaMessage?: string | null;
  waiting: number; onRunAgain: () => void; runAgainBusy: boolean; adsManagerUrl?: string; onEditAd?: () => void;
  /** #783's per-ad rows are on; a running campaign with enough results reads them for the weak-ad state. */
  perAd: boolean; onWeakAd: (campaignId: string, shown: boolean) => void; words?: Words<"verdict">;
}) {
  const [now] = useState(() => Date.now());
  const enough = cardResultCount(outcome, r, campaign.objective) >= BEST_AD_MIN_RESULTS;
  const shown = cardFigures(outcome, r, campaign.objective);
  const [weakAd, clearWeakAd] = useWeakAd(campaign.id, perAd && campaign.status === "active" && Boolean(campaign.meta_campaign_id) && enough);
  const t = verdictTranslator(words);
  const figureColumns = outcome !== "website" ? "sm:grid-cols-4"
    : shown.returnOnSpend !== undefined ? "sm:grid-cols-7"
      : shown.conversionValue !== undefined ? "sm:grid-cols-6" : "sm:grid-cols-5";
  const figures = <>
    <div className={`grid grid-cols-2 gap-3 ${figureColumns}`}>
      <Stat label={t("figures.impressions")} value={formatNumber(r.impressions)} />
      <Stat label={t(outcome === "website" ? "figures.linkClicks" : "figures.clicks")} value={shown.linkClicks ?? formatNumber(r.clicks)} />
      {shown.cpc !== undefined && <Stat label={t("figures.cpc")} value={shown.cpc} />}
      <Stat label={t(shown.label)} value={shown.value} />
      <Stat label={t(shown.costLabel)} value={shown.cost} />
      {shown.conversionValue !== undefined && <Stat label={t("figures.conversionValue")} value={shown.conversionValue} />}
      {shown.returnOnSpend !== undefined && <Stat label={t("figures.returnOnSpend")} value={`${shown.returnOnSpend.toFixed(2)}x`} />}
    </div>
    {outcome === "whatsapp" && r.whatsapp_opens != null && r.conversations != null && (
      // #493: people reach WhatsApp and leave; show the drop-off plainly.
      <p className="text-sm text-slate-700">
        {t("figures.opens", { opens: formatNumber(r.whatsapp_opens), conversations: formatNumber(r.conversations) })}
      </p>
    )}
    {metaMessage && <p className="wrap-break-word text-sm text-slate-700">{t("figures.metaMessage", { message: metaMessage })}</p>}
  </>;
  const input = cardVerdictInput(campaign, r, { now, waiting, weakAd, comparison });
  const judged = input ? verdict(input, words) : null;
  const weakShown = judged?.state === "weak_ad";
  useEffect(() => { onWeakAd(campaign.id, weakShown); }, [campaign.id, weakShown, onWeakAd]);
  // A paused card that never showed keeps its one "nothing has spent" line (#173), with no verdict beside it.
  if (!input || !judged || (campaign.status !== "active" && campaign.status !== "completed" && !r.impressions)) return figures;
  return <CampaignVerdict verdict={judged} words={words} destination={input.destination} websiteGoal={input.websiteGoal} results={input.results} spend={input.spend}
    details={figures} onRunAgain={onRunAgain} runAgainBusy={runAgainBusy} adsManagerUrl={adsManagerUrl} onEditAd={onEditAd}
    pauseOffer={weakAd && <PauseOffer campaignId={campaign.id} suggestion={weakAd} destination={input.destination} websiteGoal={input.websiteGoal} onKeep={clearWeakAd} words={words} />} />;
}
