"use client";

import { useState } from "react";
import type { MetaSpecResult, MetaSpecVerdict } from "@/lib/media/meta-specs";

/** Meta's Stories and Reels safe zone: keep text out of the top 14%, bottom 35% and 6% each side. */
export const SAFE_ZONE = { top: 14, bottom: 35, side: 6 } as const;

type Tab = "feed" | "tall" | "whatsapp";
const TABS: { id: Tab; label: string }[] = [
  { id: "feed", label: "Feed" },
  { id: "tall", label: "Stories & Reels" },
  { id: "whatsapp", label: "WhatsApp" },
];

/** The one note a tab shows: the worst of its placements (Stories and Reels share one fix); none when all are fine. */
export function placementNote(verdicts: MetaSpecResult | null, tab: Tab): string | null {
  if (!verdicts || tab === "whatsapp") return null;
  const picked: MetaSpecVerdict[] = tab === "feed" ? [verdicts.feed] : [verdicts.stories, verdicts.reels];
  const worst = picked.find((verdict) => verdict.status === "block") ?? picked.find((verdict) => verdict.status === "warn");
  return worst && worst.status !== "ok" ? worst.message : null;
}

/**
 * #781 / #744: one ad shown the way each placement will. Meta's format names never appear; the owner sees Feed (4:5),
 * Stories & Reels (9:16 with the safe-zone shading) and the WhatsApp opening, each with its #751 notes in plain words.
 */
export function PlacementPreview({ imageUrl, title, verdicts, whatsapp }: {
  imageUrl: string | null;
  title: string;
  verdicts: MetaSpecResult | null;
  whatsapp?: { greeting: string; message: string } | null;
}) {
  const [tab, setTab] = useState<Tab>("feed");
  const tabs = whatsapp ? TABS : TABS.filter((item) => item.id !== "whatsapp");
  const note = placementNote(verdicts, tab);
  const picture = imageUrl
    ? <img src={imageUrl} alt={title} className="h-full w-full object-cover" />
    : <span className="flex h-full w-full items-center justify-center text-sm text-slate-400">No picture</span>;

  return (
    <section aria-label={`Preview of ${title}`} className="flex flex-col gap-3">
      <div role="tablist" aria-label="Where it shows" className={`grid gap-1 rounded-lg bg-slate-100 p-1 ${tabs.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
        {tabs.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}
            className={`min-h-11 rounded-md px-2 text-sm font-medium ${tab === item.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>
            {item.label}
          </button>
        ))}
      </div>
      {tab === "feed" && <div data-testid="preview-feed" className="mx-auto aspect-[4/5] w-full max-w-xs overflow-hidden rounded-lg bg-slate-100">{picture}</div>}
      {tab === "tall" && (
        <div data-testid="preview-tall" className="relative mx-auto aspect-[9/16] w-full max-w-[220px] overflow-hidden rounded-lg bg-slate-100">
          {picture}
          <span aria-hidden="true" data-testid="safe-top" className="absolute inset-x-0 top-0 bg-slate-900/40" style={{ height: `${SAFE_ZONE.top}%` }} />
          <span aria-hidden="true" data-testid="safe-bottom" className="absolute inset-x-0 bottom-0 bg-slate-900/40" style={{ height: `${SAFE_ZONE.bottom}%` }} />
          <span aria-hidden="true" className="absolute inset-y-0 left-0 bg-slate-900/40" style={{ width: `${SAFE_ZONE.side}%` }} />
          <span aria-hidden="true" className="absolute inset-y-0 right-0 bg-slate-900/40" style={{ width: `${SAFE_ZONE.side}%` }} />
        </div>
      )}
      {tab === "whatsapp" && whatsapp && (
        <div data-testid="preview-whatsapp" className="flex flex-col gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-slate-800">
          <p>{whatsapp.greeting}</p>
          <p className="self-end rounded-lg bg-white px-3 py-2 shadow-sm">{whatsapp.message}</p>
        </div>
      )}
      {tab === "tall" && <p className="text-xs text-slate-500">Shaded areas can be covered by Meta&apos;s buttons and captions.</p>}
      {note && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{note}</p>}
    </section>
  );
}
