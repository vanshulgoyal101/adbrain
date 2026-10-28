import { notFound } from "next/navigation";
import { CampaignVerdict } from "@/components/campaign-verdict";
import { RejectedAds } from "@/components/rejected-ads";
import { Button } from "@/components/ui/button";
import { galleryCards } from "@/lib/campaign/verdict-gallery";
import { verdict } from "@/lib/campaign/verdict";
import { formatMoney, formatNumber } from "@/lib/format";
import { isInternalUser } from "@/lib/internal-accounts";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Card states" };

/** #1255 (CPO): every campaign-card state on one page, for the team's walks. Internal accounts only; no data read. */
export default async function VerdictGalleryPage() {
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!isInternalUser(user)) notFound();
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-950">Card states</h1>
        <p className="mt-1 text-sm text-slate-600">Examples for the team&apos;s walks. Nothing here is a real campaign; buttons don&apos;t change anything.</p>
      </header>
      <ul className="grid gap-4 lg:grid-cols-2">
        {galleryCards().map((card) => {
          const judged = verdict(card.input);
          const whatsapp = card.input.destination === "whatsapp";
          return (
            <li key={card.name} className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:p-6">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold text-slate-900">{card.name}</h2>
                <span className="text-sm text-slate-600">{card.status} · {judged.label}</span>
              </div>
              {card.reviews && <RejectedAds reviews={card.reviews} spend={card.input.spend} running={card.input.status === "active"} />}
              <CampaignVerdict verdict={judged} whatsapp={whatsapp} results={card.input.results} spend={card.input.spend}
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
        })}
      </ul>
    </div>
  );
}
