"use client";

import { useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import type { AdResultView } from "@/lib/campaign/ad-results-store";
import { KEEP_HIDES_MS, pauseSuggestion, type PauseSuggestion } from "@/lib/campaign/ad-pause";
import { formatMoney, formatNumber } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { relativeAge } from "@/lib/leads/digest";
import { creativeThumbnailUrl } from "@/lib/creative/thumbnail";

const SHOWN = 3;

type Loaded = { ads: AdResultView[]; syncedAt: string | null };
/** A WhatsApp campaign's results are chats (Designer on #1048, matching the card's "WhatsApp conversations"). */
type Unit = { one: string; many: string };
const UNITS: Record<"whatsapp" | "form", Unit> = { whatsapp: { one: "chat", many: "chats" }, form: { one: "enquiry", many: "enquiries" } };

/** An AdBrain ad reads by its headline (Designer, #783); an outside ad keeps Meta's name. */
type Named = Pick<AdResultView, "name"> & { creative?: AdResultView["creative"] };
const adLabel = (ad: Named) => ad.creative?.headline || ad.name || "Ad";

/** One quiet row: the ad, its enquiries and ₹ per enquiry ("—" before the first one, never ₹0). */
function Row({ ad, unit }: { ad: AdResultView; unit: Unit }) {
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
            <span className="font-medium">{adLabel(ad)}</span>
            {ad.best && <span className="rounded-full bg-lime-wash px-2 py-0.5 text-xs font-medium text-slate-800">Best</span>}
            {ad.replaced && <span className="text-xs text-slate-500">(replaced)</span>}
            {ad.earlier && !ad.replaced && <span className="text-xs text-slate-500">(earlier run)</span>}
          </span>
          {!ad.delivered && <span className="mt-0.5 block text-xs text-slate-500">Meta hasn&apos;t shown this ad yet</span>}
        </span>
      </span>
      <span className="shrink-0 text-right tabular-nums text-slate-700">
        {formatNumber(ad.results)} {ad.results === 1 ? unit.one : unit.many}
        <span className="mt-0.5 block text-xs text-slate-500">{ad.costPerResult === null ? "—" : formatMoney(ad.costPerResult)} per {unit.one}</span>
      </span>
    </li>
  );
}

const keepKey = (campaignId: string, adId: string) => `adbrain.keepAd.${campaignId}.${adId}`;
const named = (ad: Named) => `“${adLabel(ad)}”`;

/**
 * #1045: one line offering to pause the ad that costs far more per enquiry than the best one.
 * Never automatic; Keep hides it for 3 days; a pause can be undone here. A suggestion, not a warning:
 * a canvas strip, not amber (#847 keeps amber for Needs review).
 */
export function PauseOffer({ campaignId, suggestion, unit = UNITS.form }: { campaignId: string; suggestion: PauseSuggestion; unit?: Unit }) {
  const { ad, reference } = suggestion;
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
      if (!response.ok) { setState({ error: data.error ?? "Couldn't change the ad. Nothing changed." }); return; }
      if (action === "pause" && data.result?.changed === false) { setState("already"); return; }
      setState(action === "pause" ? "paused" : "resumed");
    } catch {
      setState({ error: "Couldn't reach AdBrain. Nothing changed." });
    }
  }

  if (state === "kept") return null;
  const busy = state === "busy";
  if (state === "paused") return <p role="status" className="py-2 text-xs text-slate-700">Paused {named(ad)}. The other ads keep running. <button type="button" className="min-h-11 font-medium text-blue-700 underline" onClick={() => void send("undo")}>Undo</button></p>;
  if (state === "already") return <p role="status" className="py-2 text-xs text-slate-700">{named(ad)} is already paused in Meta. AdBrain didn&apos;t change it.</p>;
  if (state === "resumed") return <p role="status" className="py-2 text-xs text-slate-700">{named(ad)} is running again.</p>;
  const line = suggestion.reason === "no_enquiries"
    ? <>{named(ad)} has spent {formatMoney(ad.spend)} with no {unit.many}; {named(reference)} gets them at {formatMoney(reference.costPerResult ?? 0)} each. Pause it?</>
    : <>{named(ad)} costs {formatMoney(ad.costPerResult ?? 0)} per {unit.one} vs {formatMoney(reference.costPerResult ?? 0)} for {named(reference)}. Pause it?</>;
  return (
    <div className="my-2 rounded-sm bg-slate-50 p-3 text-xs text-slate-800">
      <p className="wrap-break-word">{line}</p>
      {typeof state === "object" && <p role="alert" className="mt-1 text-danger">{state.error}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={busy} className="min-h-11" onClick={() => void send("pause")}>{busy ? "Pausing…" : "Pause this ad"}</Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} className="min-h-11" onClick={() => { window.localStorage.setItem(keepKey(campaignId, ad.adId), String(Date.now() + KEEP_HIDES_MS)); setState("kept"); }}>Keep</Button>
      </div>
    </div>
  );
}

/**
 * #783: "Which ad worked" on a campaign card. Loads the stored per-ad results the first time it opens;
 * hidden altogether while the feature is off (the route answers 404).
 */
export function AdResults({ campaignId, whatsapp = false, onRunAgain, runAgainBusy = false, runAgainError = null }: {
  campaignId: string;
  whatsapp?: boolean;
  /** #1050: with a Best ad, offer to copy the campaign into a new paused one. */
  onRunAgain?: () => void;
  runAgainBusy?: boolean;
  /** Shown under the button, where the owner tapped (Designer, #1050). */
  runAgainError?: string | null;
}) {
  const unit = UNITS[whatsapp ? "whatsapp" : "form"];
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
  const suggestion = loaded ? pauseSuggestion(loaded.ads) : null;

  return (
    <details className="group border-t border-slate-200 pt-2 text-sm" onToggle={(event) => { if ((event.currentTarget as HTMLDetailsElement).open) void load(); }}>
      <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 py-2 font-medium text-slate-900 [&::-webkit-details-marker]:hidden">
        <ChevronRight size={16} aria-hidden="true" className="transition-transform group-open:rotate-90" />
        <span>Which ad worked</span>
      </summary>
      <div className="pb-1 pl-6">
      {state === "loading" && <p className="flex min-h-11 items-center gap-2 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Loading ads…</p>}
      {state === "error" && <p role="alert" className="text-danger">Couldn&apos;t load the ads. <button type="button" className="min-h-11 underline" onClick={() => void load()}>Try again</button></p>}
      {loaded && (loaded.ads.length === 0 ? (
        <p className="text-slate-500">No ad results yet. They appear after the next refresh.</p>
      ) : (
        <div>
          {suggestion && <PauseOffer campaignId={campaignId} suggestion={suggestion} unit={unit} />}
          {!hasBest && <p className="pb-1 text-xs text-slate-500">{anyResults ? `Early: too few ${unit.many} to pick a winner.` : `No ${unit.many} yet, so no winner.`}</p>}
          <ul className="divide-y divide-slate-100 border-b border-slate-100">
            {shown.map(ad => <Row key={ad.adId} ad={ad} unit={unit} />)}
          </ul>
          {loaded.ads.length > SHOWN && !all && (
            <button type="button" className="mt-1 min-h-11 font-medium text-blue-700 underline-offset-4 hover:underline" onClick={() => setAll(true)}>All ads ({loaded.ads.length})</button>
          )}
          {loaded.syncedAt && <p className="pt-2 text-xs text-slate-500">Updated {relativeAge(loaded.syncedAt, new Date()) || "just now"}</p>}
          {canRunAgain && onRunAgain && (
            <div className="pt-3">
              <button type="button" disabled={runAgainBusy} onClick={onRunAgain}
                className="inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 bg-white px-4 font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-60">
                {runAgainBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                Run this again
              </button>
              {runAgainError && <p role="alert" className="pt-1 text-sm font-medium text-danger">{runAgainError}</p>}
              <p className="pt-1 text-xs text-slate-500">Copies it into a new campaign, best ad first. Nothing goes to Meta until you review and send it, paused.</p>
            </div>
          )}
        </div>
      ))}
      </div>
    </details>
  );
}
