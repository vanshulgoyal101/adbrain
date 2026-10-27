"use client";

import { useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import type { AdResultView } from "@/lib/campaign/ad-results-store";
import { KEEP_HIDES_MS, pauseSuggestion, type PauseSuggestion } from "@/lib/campaign/ad-pause";
import { formatMoney, formatNumber } from "@/lib/format";
import { relativeAge } from "@/lib/leads/digest";

const SHOWN = 3;

type Loaded = { ads: AdResultView[]; syncedAt: string | null };

/** One quiet row: the ad, its enquiries and ₹ per enquiry ("—" before the first one, never ₹0). */
function Row({ ad }: { ad: AdResultView }) {
  return (
    <li className="flex min-h-14 items-center justify-between gap-4 py-2.5 text-sm">
      <span className="min-w-0 wrap-break-word text-slate-900">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-medium">{ad.name ?? "Ad"}</span>
          {ad.best && <span className="rounded-full bg-lime-wash px-2 py-0.5 text-xs font-medium text-slate-800">Best</span>}
          {ad.replaced && <span className="text-xs text-slate-500">(replaced)</span>}
        </span>
        {!ad.delivered && <span className="mt-0.5 block text-xs text-slate-500">Meta hasn&apos;t shown this ad yet</span>}
      </span>
      <span className="shrink-0 text-right tabular-nums text-slate-700">
        {formatNumber(ad.results)} {ad.results === 1 ? "enquiry" : "enquiries"}
        <span className="mt-0.5 block text-xs text-slate-500">{ad.costPerResult === null ? "—" : formatMoney(ad.costPerResult)} per enquiry</span>
      </span>
    </li>
  );
}

const keepKey = (campaignId: string, adId: string) => `adbrain.keepAd.${campaignId}.${adId}`;
const named = (name: string | null) => `“${name ?? "Ad"}”`;

/**
 * #1045: one line offering to pause the ad that costs far more per enquiry than the best one.
 * Never automatic; Keep hides it for 3 days; a pause can be undone here.
 */
export function PauseOffer({ campaignId, suggestion }: { campaignId: string; suggestion: PauseSuggestion }) {
  const { ad, reference } = suggestion;
  // Rendered only after the card's client-side load, so localStorage is there on first render.
  const [state, setState] = useState<"offer" | "busy" | "paused" | "resumed" | "kept" | { error: string }>(
    () => Number(window.localStorage.getItem(keepKey(campaignId, ad.adId)) ?? 0) > Date.now() ? "kept" : "offer",
  );

  async function send(action: "pause" | "undo") {
    setState("busy");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/ads/${ad.adId}/status`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(action === "pause" ? { reason: suggestion.reason } : {}) }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setState({ error: data.error ?? "Couldn't change the ad. Nothing changed." }); return; }
      setState(action === "pause" ? "paused" : "resumed");
    } catch {
      setState({ error: "Couldn't reach AdBrain. Nothing changed." });
    }
  }

  if (state === "kept") return null;
  const busy = state === "busy";
  if (state === "paused") return <p role="status" className="py-2 text-xs text-slate-700">Paused {named(ad.name)}. The other ads keep running. <button type="button" className="min-h-11 font-medium text-blue-700 underline" onClick={() => void send("undo")}>Undo</button></p>;
  if (state === "resumed") return <p role="status" className="py-2 text-xs text-slate-700">{named(ad.name)} is running again.</p>;
  const line = suggestion.reason === "no_enquiries"
    ? <>{named(ad.name)} has spent {formatMoney(ad.spend)} with no enquiries; {named(reference.name)} gets them at {formatMoney(reference.costPerResult ?? 0)} each. Pause it?</>
    : <>{named(ad.name)} costs {formatMoney(ad.costPerResult ?? 0)} per enquiry vs {formatMoney(reference.costPerResult ?? 0)} for {named(reference.name)}. Pause it?</>;
  return (
    <div className="my-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-slate-800">
      <p className="wrap-break-word">{line}</p>
      {typeof state === "object" && <p role="alert" className="mt-1 text-danger">{state.error}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" disabled={busy} className="min-h-11 rounded-md bg-slate-900 px-3 font-medium text-white disabled:opacity-60" onClick={() => void send("pause")}>{busy ? "Pausing…" : "Pause this ad"}</button>
        <button type="button" disabled={busy} className="min-h-11 rounded-md border border-slate-300 bg-white px-3 font-medium" onClick={() => { window.localStorage.setItem(keepKey(campaignId, ad.adId), String(Date.now() + KEEP_HIDES_MS)); setState("kept"); }}>Keep</button>
      </div>
    </div>
  );
}

/**
 * #783: "Which ad worked" on a campaign card. Loads the stored per-ad results the first time it opens;
 * hidden altogether while the feature is off (the route answers 404).
 */
export function AdResults({ campaignId }: { campaignId: string }) {
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
          {suggestion && <PauseOffer campaignId={campaignId} suggestion={suggestion} />}
          {!hasBest && <p className="pb-1 text-xs text-slate-500">{anyResults ? "Early: too few enquiries to pick a winner." : "No enquiries yet, so no winner."}</p>}
          <ul className="divide-y divide-slate-100 border-b border-slate-100">
            {shown.map(ad => <Row key={ad.adId} ad={ad} />)}
          </ul>
          {loaded.ads.length > SHOWN && !all && (
            <button type="button" className="mt-1 min-h-11 font-medium text-blue-700 underline-offset-4 hover:underline" onClick={() => setAll(true)}>All ads ({loaded.ads.length})</button>
          )}
          {loaded.syncedAt && <p className="pt-2 text-xs text-slate-500">Updated {relativeAge(loaded.syncedAt, new Date()) || "just now"}</p>}
        </div>
      ))}
      </div>
    </details>
  );
}
