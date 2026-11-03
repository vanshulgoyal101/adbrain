"use client";

import { useState } from "react";
import { Check, ImageIcon } from "lucide-react";
import { formatPerDay } from "@/lib/format";

/** Meta's guidance the CPO set for #744: more ads than this share a small budget too thinly. */
export const MAX_ADS = 6;

export type ChoosableAd = {
  id: string;
  kind: "photo" | "video" | "adbrain";
  /** Picture or video poster; null shows a placeholder. */
  imageUrl: string | null;
  title: string;
  durationSec?: number;
};

const TABS = [
  { id: "all", label: "All" },
  { id: "yours", label: "Yours" },
  { id: "adbrain", label: "By AdBrain" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Shown while more than 3 ads are picked; advice only, the number waits for #588's data. */
export const budgetAdvice = (dailyBudgetInr: number) => `At ${formatPerDay(dailyBudgetInr)}, Meta tests about 3–4 ads well; more ads share the budget thinly.`;
export const ADVICE_FROM_ADS = 4;

function tag(ad: ChoosableAd): string {
  if (ad.kind === "adbrain") return "AdBrain";
  if (ad.kind === "video") return ad.durationSec != null ? `Your video · ${formatDuration(ad.durationSec)}` : "Your video";
  return "Your photo";
}

/**
 * #778 / #744 Designer frame 2: "Choose ads". The owner's photos and videos sit in one grid with AdBrain's ads, with
 * no Meta format names. Each pick runs as its own ad; up to MAX_ADS. Launch (#781) owns what happens on Use.
 */
export function ChooseAds({ ads, initial = [], dailyBudgetInr = 300, onUse }: {
  ads: ChoosableAd[];
  initial?: string[];
  dailyBudgetInr?: number;
  onUse: (ids: string[]) => void;
}) {
  const [tab, setTab] = useState<Tab>("all");
  const [picked, setPicked] = useState<string[]>(() => initial.filter((id) => ads.some((ad) => ad.id === id)).slice(0, MAX_ADS));
  const shown = ads.filter((ad) => tab === "all" || (tab === "adbrain") === (ad.kind === "adbrain"));
  const full = picked.length >= MAX_ADS;
  const toggle = (id: string) => setPicked((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length >= MAX_ADS ? current : [...current, id]);

  return (
    <section aria-labelledby="choose-ads-title" className="flex flex-col gap-4">
      <div>
        <h2 id="choose-ads-title" className="text-lg font-semibold text-slate-900">Choose ads</h2>
        <p className="text-sm text-slate-500">Pick any mix. Each one runs as its own ad, and Meta spends more on the one that works.</p>
      </div>
      <div role="tablist" aria-label="Show" className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={`min-h-11 rounded-md text-sm font-medium ${tab === t.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>
            {t.label}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">{tab === "adbrain" ? "No ads made yet." : "No photos or videos yet."}</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2">
          {shown.map((ad) => {
            const on = picked.includes(ad.id);
            return (
              <li key={ad.id}>
                <button type="button" aria-pressed={on} aria-label={`${ad.title}, ${tag(ad)}`} disabled={!on && full} onClick={() => toggle(ad.id)}
                  className={`relative block aspect-square w-full overflow-hidden rounded-lg border-2 bg-slate-100 disabled:opacity-50 ${on ? "border-blue-600" : "border-transparent"}`}>
                  {ad.imageUrl
                    ? <img src={ad.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                    : <span className="flex h-full w-full items-center justify-center"><ImageIcon className="h-6 w-6 text-slate-300" aria-hidden="true" /></span>}
                  <span aria-hidden="true" className={`absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full border-2 ${on ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white"}`}>
                    {on && <Check className="h-3.5 w-3.5" />}
                  </span>
                  <span className="absolute bottom-1.5 left-1.5 max-w-[calc(100%-0.75rem)] truncate rounded-full bg-white/90 px-2 py-0.5 text-xs font-medium text-slate-900">{tag(ad)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
        {budgetAdvice(dailyBudgetInr)}
      </p>
      <button type="button" disabled={picked.length === 0} onClick={() => onUse(picked)}
        className="inline-flex min-h-11 items-center justify-center rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
        {picked.length === 0 ? "Pick at least 1 ad" : `Use ${picked.length} ${picked.length === 1 ? "ad" : "ads"}`}
      </button>
      <p className="text-sm text-slate-500">Up to {MAX_ADS} ads per campaign.</p>
    </section>
  );
}
