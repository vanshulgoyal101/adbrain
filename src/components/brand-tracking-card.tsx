"use client";

import Link from "next/link";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReviewTracking } from "@/lib/campaign/website-tracking";

export type BrandTrackingCopy = {
  title: string;
  intro: string;
  legend: string;
  noSource: string;
  noSourceHelp: string;
  unreadable: string;
  unreadableHelp: string;
  choose: string;
  quiet: string;
  missing: string;
  selectionUnavailable: string;
  pixelUnavailable: string;
  unnamed: (number: number) => string;
  leadCount: (count: number) => string;
  purchaseCount: (count: number) => string;
  window: (since: string, until: string) => string;
  countsNote: string;
  checkAgain: string;
  checking: string;
  checkAccess: string;
  eventsManager: string;
};

export type BrandTrackingCardProps = {
  tracking: ReviewTracking;
  copy: BrandTrackingCopy;
  onCheckAgain: (pixelId: string | null) => void;
  onSelect?: (pixelId: string) => void;
  checking?: boolean;
  error?: string | null;
};

export function BrandTrackingCard({ tracking, copy, onCheckAgain, onSelect, checking = false, error }: BrandTrackingCardProps) {
  const id = useId();
  const status = tracking.status;
  const chosen = status?.pixels.find((pixel) => pixel.id === tracking.pixelId);
  const counts = status?.counts;
  const window = status?.window;
  const validCounts = counts && [counts.Lead, counts.Purchase].every((count) => Number.isSafeInteger(count) && count >= 0);
  const validWindow = window && Number.isFinite(Date.parse(window.since)) && Number.isFinite(Date.parse(window.until))
    && Date.parse(window.since) <= Date.parse(window.until);
  const checked = status && status.pixelId === tracking.pixelId && chosen && !chosen.unavailable
    && status.state !== "none" && status.state !== "unreadable" && validCounts && validWindow;
  const noSources = status?.state === "none" && status.pixels.length === 0;
  const unreadable = !noSources && (!status || status.state === "unreadable" || status.state === "none"
    || (tracking.pixelId !== null && !checked));
  const guidance = noSources ? copy.noSource : unreadable ? copy.unreadable : !tracking.pixelId ? copy.choose
    : status?.state === "quiet" ? copy.quiet : status?.state === "event_missing" ? copy.missing : null;
  const names = status?.pixels.map((pixel, index) => pixel.name.trim() || copy.unnamed(index + 1)) ?? [];
  const nameCounts = new Map<string, number>();
  for (const name of names) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);

  return (
    <section id="brand-tracking" aria-labelledby={`${id}-title`} className="scroll-mt-6">
      <Card>
        <CardHeader>
          <CardTitle as="h2" id={`${id}-title`}>{copy.title}</CardTitle>
          <p className="mt-1 text-sm text-slate-600">{copy.intro}</p>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-3">
          {guidance && <p role="status" className="text-sm text-slate-800">{guidance}</p>}
          {noSources && <p className="text-sm text-slate-600">{copy.noSourceHelp}</p>}
          {unreadable && <p className="text-sm text-slate-600">{copy.unreadableHelp}</p>}
          {status && status.pixels.length > 0 && (
            <fieldset className="min-w-0">
              <legend className="mb-2 text-sm font-medium text-slate-900">{copy.legend}</legend>
              <div className="flex flex-col gap-2">
                {status.pixels.map((pixel, index) => {
                  const name = names[index];
                  const label = (nameCounts.get(name) ?? 0) > 1 ? `${name} (${copy.unnamed(index + 1)})` : name;
                  const unavailable = pixel.unavailable || !onSelect || checking;
                  const reasonId = pixel.unavailable ? `${id}-pixel-${index}-unavailable` : !onSelect ? `${id}-selection-unavailable` : undefined;
                  return (
                    <label key={pixel.id} className="flex min-h-11 min-w-0 items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue-600">
                      <input type="radio" name={`brand-tracking-${id}`} checked={tracking.pixelId === pixel.id}
                        aria-label={label} aria-disabled={unavailable || undefined} aria-describedby={reasonId}
                        onChange={() => { if (!unavailable) onSelect?.(pixel.id); }} className="h-4 w-4 flex-none accent-blue-600" />
                      <span className="min-w-0 break-words font-medium text-slate-900">{label}</span>
                      {pixel.unavailable && <span id={reasonId} className="text-xs text-slate-600">{copy.pixelUnavailable}</span>}
                    </label>
                  );
                })}
              </div>
              {!onSelect && <p id={`${id}-selection-unavailable`} className="mt-2 text-sm text-slate-600">{copy.selectionUnavailable}</p>}
            </fieldset>
          )}
          {checked && counts && window && (
            <div className="space-y-1 text-sm text-slate-700">
              <p>{copy.leadCount(counts.Lead)}</p>
              <p>{copy.purchaseCount(counts.Purchase)}</p>
              <p className="text-xs text-slate-500">{copy.window(window.since, window.until)}</p>
              <p className="text-xs text-slate-500">{copy.countsNote}</p>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button type="button" variant="outline" onClick={() => onCheckAgain(tracking.pixelId)} disabled={checking}>
              {checking ? copy.checking : copy.checkAgain}
            </Button>
            {(noSources || unreadable) && <Link href="/settings" className="inline-flex min-h-11 items-center text-sm font-medium text-blue-700 underline underline-offset-4">{copy.checkAccess}</Link>}
            <a href="https://business.facebook.com/events_manager2" target="_blank" rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center text-sm font-medium text-blue-700 underline underline-offset-4">{copy.eventsManager}</a>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
