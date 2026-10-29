"use client";

import { useState } from "react";
import { AudienceSwitchStrip } from "@/components/audience-switch-strip";
import { CampaignVerdict } from "@/components/campaign-verdict";
import { RejectedAds } from "@/components/rejected-ads";
import { Button } from "@/components/ui/button";
import { GONE_LINES } from "@/lib/campaign/gone-in-meta";
import { verdict } from "@/lib/campaign/verdict";
import type { GalleryCard } from "@/lib/campaign/verdict-gallery";
import { formatMoney, formatNumber } from "@/lib/format";

const nothing = () => {};

/**
 * #1255 / #1841: one example card on the internal walk page, drawn by the real components. Its buttons are wired to
 * nothing (Run this again, Edit the ad, Pause), so walks see every action a card can offer without changing anything.
 */
export function VerdictGalleryCard({ card }: { card: GalleryCard }) {
  const judged = verdict(card.input);
  // #1854: the real card opens the words editor with the row's hint; here it says which.
  const [hint, setHint] = useState<string | null>(null);
  const whatsapp = card.input.destination === "whatsapp";
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold text-slate-900">{card.name}</h2>
        <span className="text-sm text-slate-600">{card.extra === "deleted_in_meta" ? "Deleted in Meta" : judged.label === "Live" || judged.label === "Ended" ? card.status : `${card.status} · ${judged.label}`}</span>
      </div>
      {card.extra === "deleted_in_meta" && <p className="text-sm text-slate-700">{GONE_LINES.deleted}</p>}
      {card.extra === "audience_waiting" && (
        <AudienceSwitchStrip campaignId="00000000-0000-4000-8000-000000001841" operationId="00000000-0000-4000-8000-000000001842"
          running={card.input.status === "active"} onDone={nothing} />
      )}
      {card.reviews && <RejectedAds reviews={card.reviews} spend={card.input.spend} running={card.input.status === "active"} vertical={card.vertical ?? null}
        onEditAd={(editHint) => setHint(editHint ?? "")} />}
      {hint !== null && <p role="status" className="text-sm text-slate-700">Opens the words editor{hint ? ` with: ${hint}` : "."}</p>}
      <CampaignVerdict verdict={judged} whatsapp={whatsapp} results={card.input.results} spend={card.input.spend}
        onRunAgain={nothing} onEditAd={nothing}
        adsManagerUrl="https://adsmanager.facebook.com/adsmanager/manage/campaigns"
        pauseOffer={card.input.weakAd && (
          <div className="my-2 rounded-sm bg-slate-50 p-3 text-xs text-slate-800">
            <p>“{card.input.weakAd.ad.creative?.headline}” costs {formatMoney(card.input.weakAd.ad.costPerResult ?? 0)} per chat vs {formatMoney(card.input.weakAd.reference.costPerResult ?? 0)} for “{card.input.weakAd.reference.creative?.headline}”. Pause it?</p>
            <div className="mt-2 flex gap-2"><Button type="button" variant="outline" size="sm" className="min-h-11">Pause this ad</Button><Button type="button" variant="ghost" size="sm" className="min-h-11">Keep</Button></div>
          </div>
        )}
        details={<p className="text-sm text-slate-700">{formatNumber(card.input.impressions)} impressions · {formatNumber(card.input.results)} {whatsapp ? "chats" : "leads"} · {formatMoney(card.input.spend)}</p>} />
    </li>
  );
}
