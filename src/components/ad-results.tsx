"use client";

import { useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import type { AdResultView } from "@/lib/campaign/ad-results-store";
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

/**
 * #783: "Which ad worked" on a campaign card. Loads the stored per-ad results the first time it opens;
 * hidden altogether while the feature is off (the route answers 404).
 */
export function AdResults({ campaignId, onRunAgain, runAgainBusy = false }: {
  campaignId: string;
  /** #1050: with a Best ad, offer to copy the campaign into a new paused one. */
  onRunAgain?: () => void;
  runAgainBusy?: boolean;
}) {
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
          {!hasBest && <p className="pb-1 text-xs text-slate-500">{anyResults ? "Early: too few enquiries to pick a winner." : "No enquiries yet, so no winner."}</p>}
          <ul className="divide-y divide-slate-100 border-b border-slate-100">
            {shown.map(ad => <Row key={ad.adId} ad={ad} />)}
          </ul>
          {loaded.ads.length > SHOWN && !all && (
            <button type="button" className="mt-1 min-h-11 font-medium text-blue-700 underline-offset-4 hover:underline" onClick={() => setAll(true)}>All ads ({loaded.ads.length})</button>
          )}
          {loaded.syncedAt && <p className="pt-2 text-xs text-slate-500">Updated {relativeAge(loaded.syncedAt, new Date()) || "just now"}</p>}
          {hasBest && onRunAgain && (
            <div className="pt-3">
              <button type="button" disabled={runAgainBusy} onClick={onRunAgain}
                className="inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 bg-white px-4 font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-60">
                {runAgainBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                Run this again
              </button>
              <p className="pt-1 text-xs text-slate-500">Copies it into a new campaign, best ad first. Nothing goes to Meta until you review and send it, paused.</p>
            </div>
          )}
        </div>
      ))}
      </div>
    </details>
  );
}
