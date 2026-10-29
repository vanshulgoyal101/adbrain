"use client";

import { useEffect, useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import type { AdResultView } from "@/lib/campaign/ad-results-store";
import { KEEP_HIDES_MS, pauseSuggestion, type PauseSuggestion } from "@/lib/campaign/ad-pause";
import { formatMoney, formatNumber } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { ageParts } from "@/lib/leads/digest";
import { creativeThumbnailUrl } from "@/lib/creative/thumbnail";
import { verdictTranslator, type Words } from "@/i18n/words";

const SHOWN = 3;

type Loaded = { ads: AdResultView[]; syncedAt: string | null };
type T = ReturnType<typeof verdictTranslator>;
/** A WhatsApp campaign's results are chats (Designer on #1048, matching the card's "WhatsApp conversations"). */
type Unit = { one: string; many: string };
const unitFor = (t: T, whatsapp: boolean): Unit => {
  const key = whatsapp ? "card.noun" : "card.nounEnquiry";
  return { one: t(key, { n: 1 }), many: t(key, { n: 2 }) };
};

/** An AdBrain ad reads by its headline (Designer, #783); an outside ad keeps Meta's name. */
type Named = Pick<AdResultView, "name"> & { creative?: AdResultView["creative"] };
const adLabel = (ad: Named, t: T) => ad.creative?.headline || ad.name || t("ads.ad");

/** One quiet row: the ad, its enquiries and ₹ per enquiry ("—" before the first one, never ₹0). */
function Row({ ad, unit, t }: { ad: AdResultView; unit: Unit; t: T }) {
  const image = ad.creative?.imageUrl;
  return (
    <li className="flex min-h-14 items-center justify-between gap-4 py-2.5 text-sm">
      <span className="flex min-w-0 items-center gap-3">
        {image && (
          <img
            src={creativeThumbnailUrl(image)} alt="" width={40} height={40} loading="lazy"
            className="h-10 w-10 shrink-0 rounded-sm bg-slate-100 object-cover"
            onError={(event) => { if (event.currentTarget.src !== image) event.currentTarget.src = image; }}
          />
        )}
        <span className="min-w-0 wrap-break-word text-slate-900">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-medium">{adLabel(ad, t)}</span>
            {ad.best && <span className="rounded-full bg-lime-wash px-2 py-0.5 text-xs font-medium text-slate-800">{t("ads.best")}</span>}
            {ad.replaced && <span className="text-xs text-slate-500">{t("ads.replaced")}</span>}
            {ad.earlier && !ad.replaced && <span className="text-xs text-slate-500">{t("ads.earlier")}</span>}
          </span>
          {!ad.delivered && <span className="mt-0.5 block text-xs text-slate-500">{t("ads.notShown")}</span>}
        </span>
      </span>
      <span className="shrink-0 text-right tabular-nums text-slate-700">
        {t("ads.count", { n: formatNumber(ad.results), unit: ad.results === 1 ? unit.one : unit.many })}
        <span className="mt-0.5 block text-xs text-slate-500">{t("ads.per", { cost: ad.costPerResult === null ? "—" : formatMoney(ad.costPerResult), unit: unit.one })}</span>
      </span>
    </li>
  );
}

const updatedAge = (t: T, iso: string) => {
  const age = ageParts(iso, new Date());
  return !age || age.unit === "now" ? t("ads.age.now") : t(`ads.age.${age.unit}`, { n: age.n });
};

const keepKey = (campaignId: string, adId: string) => `adbrain.keepAd.${campaignId}.${adId}`;
const named = (ad: Named, t: T) => `“${adLabel(ad, t)}”`;

/**
 * #1045: one line offering to pause the ad that costs far more per enquiry than the best one.
 * Never automatic; Keep hides it for 3 days; a pause can be undone here. A suggestion, not a warning:
 * a canvas strip, not amber (#847 keeps amber for Needs review).
 */
export function PauseOffer({ campaignId, suggestion, whatsapp = false, onKeep, words }: {
  campaignId: string; suggestion: PauseSuggestion; whatsapp?: boolean; onKeep?: () => void;
  /** #1438: the owner's language (`verdict` namespace); English without. */
  words?: Words<"verdict">;
}) {
  const { ad, reference } = suggestion;
  const t = verdictTranslator(words);
  const unit = unitFor(t, whatsapp);
  // Rendered only after the card's client-side load, so localStorage is there on first render.
  const [state, setState] = useState<"offer" | "busy" | "paused" | "resumed" | "already" | "kept" | { error: string }>(
    () => Number(window.localStorage.getItem(keepKey(campaignId, ad.adId)) ?? 0) > Date.now() ? "kept" : "offer",
  );

  async function send(action: "pause" | "undo") {
    setState("busy");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/ads/${ad.adId}/status`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(action === "pause" ? { reason: suggestion.reason } : {}) }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string; result?: { changed?: boolean } };
      if (!response.ok) { setState({ error: data.error ?? t("ads.failed") }); return; }
      if (action === "pause" && data.result?.changed === false) { setState("already"); return; }
      setState(action === "pause" ? "paused" : "resumed");
    } catch {
      setState({ error: t("ads.unreachable") });
    }
  }

  if (state === "kept") return null;
  const busy = state === "busy";
  if (state === "paused") return <p role="status" className="py-2 text-xs text-slate-700">{t("ads.paused", { ad: named(ad, t) })} <button type="button" className="min-h-11 font-medium text-blue-700 underline" onClick={() => void send("undo")}>{t("ads.undo")}</button></p>;
  if (state === "already") return <p role="status" className="py-2 text-xs text-slate-700">{t("ads.already", { ad: named(ad, t) })}</p>;
  if (state === "resumed") return <p role="status" className="py-2 text-xs text-slate-700">{t("ads.resumed", { ad: named(ad, t) })}</p>;
  const line = suggestion.reason === "no_enquiries"
    ? t("ads.noResults", { ad: named(ad, t), amount: formatMoney(ad.spend), units: unit.many, reference: named(reference, t), cost: formatMoney(reference.costPerResult ?? 0) })
    : t("ads.costly", { ad: named(ad, t), cost: formatMoney(ad.costPerResult ?? 0), unit: unit.one, refCost: formatMoney(reference.costPerResult ?? 0), reference: named(reference, t) });
  return (
    <div className="my-2 rounded-sm bg-slate-50 p-3 text-xs text-slate-800">
      <p className="wrap-break-word">{line}</p>
      {typeof state === "object" && <p role="alert" className="mt-1 text-danger">{state.error}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={busy} className="min-h-11" onClick={() => void send("pause")}>{busy ? t("ads.pausing") : t("ads.pause")}</Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} className="min-h-11" onClick={() => { window.localStorage.setItem(keepKey(campaignId, ad.adId), String(Date.now() + KEEP_HIDES_MS)); setState("kept"); onKeep?.(); }}>{t("ads.keep")}</Button>
      </div>
    </div>
  );
}

/**
 * #1274 slice 2c: the card's weak-ad state. Reads the stored per-ad rows once (no Meta call) and returns the ad
 * worth pausing, or null: feature off, read failed, nothing to pause, or the owner tapped Keep in the last 3 days.
 */
export function useWeakAd(campaignId: string, enabled: boolean): [PauseSuggestion | null, () => void] {
  const [suggestion, setSuggestion] = useState<PauseSuggestion | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetch(`/api/campaigns/${campaignId}/ads`).then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as { ads?: AdResultView[] };
      const found = Array.isArray(data.ads) ? pauseSuggestion(data.ads) : null;
      if (live && found && !(Number(window.localStorage.getItem(keepKey(campaignId, found.ad.adId)) ?? 0) > Date.now())) setSuggestion(found);
    }).catch(() => undefined);
    return () => { live = false; };
  }, [campaignId, enabled]);
  return [suggestion, () => setSuggestion(null)];
}

/**
 * #783: "Which ad worked" on a campaign card. Loads the stored per-ad results the first time it opens;
 * hidden altogether while the feature is off (the route answers 404).
 */
export function AdResults({ campaignId, whatsapp = false, onRunAgain, runAgainBusy = false, runAgainError = null, offerPause = true, words }: {
  campaignId: string;
  /** #1274: false while the card's sentence already offers the pause, so it isn't offered twice. */
  offerPause?: boolean;
  whatsapp?: boolean;
  /** #1050: with a Best ad, offer to copy the campaign into a new paused one. */
  onRunAgain?: () => void;
  runAgainBusy?: boolean;
  /** Shown under the button, where the owner tapped (Designer, #1050). */
  runAgainError?: string | null;
  /** #1438: the owner's language (`verdict` namespace); English without. */
  words?: Words<"verdict">;
}) {
  const t = verdictTranslator(words);
  const unit = unitFor(t, whatsapp);
  const [state, setState] = useState<"idle" | "loading" | "off" | "error" | Loaded>("idle");
  const [all, setAll] = useState(false);

  async function load() {
    if (state !== "idle" && state !== "error") return;
    setState("loading");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/ads`);
      if (response.status === 404) { setState("off"); return; }
      const data = await response.json() as { ads?: AdResultView[]; syncedAt?: string | null };
      if (!response.ok || !Array.isArray(data.ads)) throw new Error("unavailable");
      setState({ ads: data.ads, syncedAt: data.syncedAt ?? null });
    } catch {
      setState("error");
    }
  }

  if (state === "off") return null;
  const loaded = typeof state === "object" ? state : null;
  const shown = loaded ? (all ? loaded.ads : loaded.ads.slice(0, SHOWN)) : [];
  const anyResults = loaded?.ads.some(ad => ad.results > 0) ?? false;
  const hasBest = loaded?.ads.some(ad => ad.best) ?? false;
  // Only an AdBrain ad can be copied; an outside Best ad would only lead to an error.
  const canRunAgain = loaded?.ads.some(ad => ad.best && ad.creative) ?? false;
  const suggestion = loaded && offerPause ? pauseSuggestion(loaded.ads) : null;

  return (
    <details className="group border-t border-slate-200 pt-2 text-sm" onToggle={(event) => { if ((event.currentTarget as HTMLDetailsElement).open) void load(); }}>
      <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 py-2 font-medium text-slate-900 [&::-webkit-details-marker]:hidden">
        <ChevronRight size={16} aria-hidden="true" className="transition-transform group-open:rotate-90" />
        <span>{t("ads.title")}</span>
      </summary>
      <div className="pb-1 pl-6">
      {state === "loading" && <p className="flex min-h-11 items-center gap-2 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{t("ads.loading")}</p>}
      {state === "error" && <p role="alert" className="text-danger">{t("ads.loadFailed")} <button type="button" className="min-h-11 underline" onClick={() => void load()}>{t("ads.tryAgain")}</button></p>}
      {loaded && (loaded.ads.length === 0 ? (
        <p className="text-slate-500">{t("ads.none")}</p>
      ) : (
        <div>
          {suggestion && <PauseOffer campaignId={campaignId} suggestion={suggestion} whatsapp={whatsapp} words={words} />}
          {!hasBest && <p className="pb-1 text-xs text-slate-500">{anyResults ? t("ads.early", { units: unit.many }) : t("ads.noWinner", { units: unit.many })}</p>}
          <ul className="divide-y divide-slate-100 border-b border-slate-100">
            {shown.map(ad => <Row key={ad.adId} ad={ad} unit={unit} t={t} />)}
          </ul>
          {loaded.ads.length > SHOWN && !all && (
            <button type="button" className="mt-1 min-h-11 font-medium text-blue-700 underline-offset-4 hover:underline" onClick={() => setAll(true)}>{t("ads.all", { n: loaded.ads.length })}</button>
          )}
          {loaded.syncedAt && <p className="pt-2 text-xs text-slate-500">{t("ads.updated", { age: updatedAge(t, loaded.syncedAt) })}</p>}
          {canRunAgain && onRunAgain && (
            <div className="pt-3">
              <button type="button" disabled={runAgainBusy} onClick={onRunAgain}
                className="inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 bg-white px-4 font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-60">
                {runAgainBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {t("ads.runAgain")}
              </button>
              {runAgainError && <p role="alert" className="pt-1 text-sm font-medium text-danger">{runAgainError}</p>}
              <p className="pt-1 text-xs text-slate-500">{t("ads.runAgainNote")}</p>
            </div>
          )}
        </div>
      ))}
      </div>
    </details>
  );
}
