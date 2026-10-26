"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { AdResultView } from "@/lib/campaign/ad-results-store";
import { formatMoney, formatNumber } from "@/lib/format";
import { relativeAge } from "@/lib/leads/digest";

const SHOWN = 3;

type Loaded = { ads: AdResultView[]; syncedAt: string | null };

/** One quiet row: the ad, its enquiries and ₹ per enquiry ("—" before the first one, never ₹0). */
function Row({ ad }: { ad: AdResultView }) {
  return (
    <li className="flex items-start justify-between gap-3 py-2 text-[13px] leading-[15px]">
      <span className="min-w-0 wrap-break-word text-slate-900">
        {ad.best && <span className="mr-1.5 font-semibold text-primary">Best</span>}
        {ad.name ?? "Ad"}
        {ad.replaced && <span className="ml-1.5 text-slate-500">(replaced)</span>}
        {!ad.delivered && <span className="block text-slate-500">Meta hasn&apos;t shown this ad yet</span>}
      </span>
      <span className="shrink-0 text-right tabular-nums text-slate-700">
        {formatNumber(ad.results)} {ad.results === 1 ? "enquiry" : "enquiries"}
        <span className="block text-slate-500">{ad.costPerResult === null ? "—" : formatMoney(ad.costPerResult)} per enquiry</span>
      </span>
    </li>
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

  return (
    <details className="text-sm" onToggle={(event) => { if ((event.currentTarget as HTMLDetailsElement).open) void load(); }}>
      <summary className="min-h-10 cursor-pointer py-2 font-medium text-slate-900">Which ad worked</summary>
      {state === "loading" && <p className="flex items-center gap-2 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Loading ads…</p>}
      {state === "error" && <p role="alert" className="text-red-800">Couldn&apos;t load the ads. <button type="button" className="min-h-10 underline" onClick={() => void load()}>Try again</button></p>}
      {loaded && (loaded.ads.length === 0 ? (
        <p className="text-slate-500">No ad results yet. They appear after the next refresh.</p>
      ) : (
        <div>
          {!hasBest && <p className="text-slate-500">{anyResults ? "Early: too few enquiries to pick a winner." : "No enquiries yet, so no winner."}</p>}
          <ul className="divide-y divide-slate-100">
            {shown.map(ad => <Row key={ad.adId} ad={ad} />)}
          </ul>
          {loaded.ads.length > SHOWN && !all && (
            <button type="button" className="min-h-10 font-medium text-blue-700 underline" onClick={() => setAll(true)}>All ads ({loaded.ads.length})</button>
          )}
          {loaded.syncedAt && <p className="text-xs text-slate-500">Updated {relativeAge(loaded.syncedAt, new Date()) || "just now"}</p>}
        </div>
      ))}
    </details>
  );
}
