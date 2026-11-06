"use client";

import { useState, type ReactNode } from "react";
import { Check, ImageIcon } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { campaignsTranslator, type Words } from "@/i18n/words";

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
  { id: "all", label: "picker.choose.tabs.all" },
  { id: "yours", label: "picker.choose.tabs.yours" },
  { id: "adbrain", label: "picker.choose.tabs.adbrain" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Advice only; the count is not a launch limit. */
export const budgetAdvice = (dailyBudgetInr: number, words?: Words<"campaigns">) =>
  campaignsTranslator(words)("picker.choose.budgetAdvice", { money: formatMoney(dailyBudgetInr) });
export const ADVICE_FROM_ADS = 4;

function tag(ad: ChoosableAd, t: ReturnType<typeof campaignsTranslator>): string {
  if (ad.kind === "adbrain") return t("picker.choose.adbrain");
  if (ad.kind === "video") return ad.durationSec != null
    ? t("picker.choose.videoWithDuration", { duration: formatDuration(ad.durationSec) })
    : t("picker.yourVideo");
  return t("picker.yourPhoto");
}

/**
 * #778 / #744 Designer frame 2: "Choose ads". The owner's photos and videos sit in one grid with AdBrain's ads, with
 * no Meta format names. Each pick runs as its own ad; up to MAX_ADS. Launch (#781) owns what happens on Use.
 */
export function ChooseAds({ ads, initial = [], selected, dailyBudgetInr = 300, maxAds = MAX_ADS, onUse, onSelectionChange, words, renderAd }: {
  ads: ChoosableAd[];
  initial?: string[];
  selected?: string[];
  dailyBudgetInr?: number;
  /** null leaves pilot-specific selection limits and warnings to the campaign flow. */
  maxAds?: number | null;
  onUse?: (ids: string[]) => void;
  onSelectionChange?: (ids: string[]) => void;
  words?: Words<"campaigns">;
  renderAd?: (ad: ChoosableAd, selected: boolean, onToggle: () => void, index: number) => ReactNode;
}) {
  const t = campaignsTranslator(words);
  const [tab, setTab] = useState<Tab>("all");
  const [localPicked, setLocalPicked] = useState<string[]>(() => {
    const valid = initial.filter((id) => ads.some((ad) => ad.id === id));
    return maxAds === null ? valid : valid.slice(0, maxAds);
  });
  const picked = selected ?? localPicked;
  const shown = ads.map((ad, index) => ({ ad, index })).filter(({ ad }) =>
    tab === "all" || (tab === "adbrain") === (ad.kind === "adbrain"));
  const full = maxAds !== null && picked.length >= maxAds;
  const toggle = (id: string) => {
    const next = picked.includes(id)
      ? picked.filter((item) => item !== id)
      : full ? picked : [...picked, id];
    if (selected === undefined) setLocalPicked(next);
    onSelectionChange?.(next);
  };

  return (
    <section aria-labelledby="choose-ads-title" className="flex flex-col gap-4">
      <div>
        <h2 id="choose-ads-title" className="text-lg font-semibold text-slate-900">{t("picker.choose.title")}</h2>
        <p className="text-sm text-slate-500">{t("picker.choose.description")}</p>
      </div>
      <div role="tablist" aria-label={t("picker.choose.filter")} className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
        {TABS.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}
            className={`min-h-11 rounded-md text-sm font-medium ${tab === item.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>
            {t(item.label)}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">{tab === "adbrain" ? t("picker.choose.emptyAdbrain") : t("picker.choose.emptyYours")}</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:gap-3 md:grid-cols-4">
          {shown.map(({ ad, index }) => {
            const on = picked.includes(ad.id);
            return (
              <li key={ad.id}>
                {renderAd ? renderAd(ad, on, () => toggle(ad.id), index) : (
                  <button type="button" aria-pressed={on} aria-label={`${ad.title}, ${tag(ad, t)}`} disabled={!on && full} onClick={() => toggle(ad.id)}
                    className={`relative block aspect-square w-full overflow-hidden rounded-lg border-2 bg-slate-100 disabled:opacity-50 ${on ? "border-blue-600" : "border-transparent"}`}>
                    {ad.imageUrl
                      ? <img src={ad.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                      : <span className="flex h-full w-full items-center justify-center"><ImageIcon className="h-6 w-6 text-slate-300" aria-hidden="true" /></span>}
                    <span aria-hidden="true" className={`absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full border-2 ${on ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white"}`}>
                      {on && <Check className="h-3.5 w-3.5" />}
                    </span>
                    <span className="absolute bottom-1.5 left-1.5 max-w-[calc(100%-0.75rem)] truncate rounded-full bg-white/90 px-2 py-0.5 text-xs font-medium text-slate-900">{tag(ad, t)}</span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{budgetAdvice(dailyBudgetInr, words)}</p>
      {onUse && <button type="button" disabled={picked.length === 0} onClick={() => onUse(picked)}
        className="inline-flex min-h-11 items-center justify-center rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
        {picked.length === 0 ? t("picker.choose.pickOne") : t("picker.choose.use", { n: picked.length })}
      </button>}
      {maxAds !== null && <p className="text-sm text-slate-500">{t("picker.choose.maxAds", { n: maxAds })}</p>}
    </section>
  );
}
