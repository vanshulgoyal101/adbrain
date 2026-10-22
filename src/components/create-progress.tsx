"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import type { CreateStreamLine } from "@/app/api/creatives/generate/route";
import type { CreateProgressStage } from "@/lib/creative/generate";
import type { Creative } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface LiveAd {
  angleId?: string;
  angleName?: string;
  stage: CreateProgressStage | "starting";
  creative?: Creative;
}

/** Reads the live Create stream, or a plain JSON response, and returns the final status and body. */
export async function readCreateResponse(
  res: Response,
  onLine: (line: Exclude<CreateStreamLine, { type: "result" }>) => void,
): Promise<{ status: number; data: unknown }> {
  if (!res.body || !res.headers.get("content-type")?.includes("application/x-ndjson")) {
    return { status: res.status, data: await res.json().catch(() => ({})) };
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    buffer += value ?? "";
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const text = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (!text) continue;
      const line = JSON.parse(text) as CreateStreamLine;
      if (line.type === "result") {
        reader.cancel().catch(() => {});
        return { status: line.status, data: line.body };
      }
      onLine(line);
    }
    if (done) throw new Error("The Create stream ended without a result.");
  }
}

/** Applies one stream line to the ad slots; the first event for an angle claims the next free slot. */
export function applyCreateLine(ads: LiveAd[], line: Exclude<CreateStreamLine, { type: "result" }>): LiveAd[] {
  let index = ads.findIndex((ad) => ad.angleId === line.angleId);
  if (index < 0) index = ads.findIndex((ad) => !ad.angleId);
  if (index < 0) return ads;
  const next = [...ads];
  next[index] = line.type === "creative"
    ? { ...next[index], angleId: line.angleId, creative: line.creative }
    : { ...next[index], angleId: line.angleId, angleName: line.angleName, stage: line.stage };
  return next;
}

const STEPS = [
  { rank: 1, label: "Writing the copy" },
  { rank: 2, label: "Checking facts and claims against your Brand" },
  { rank: 3, label: "Designing the image" },
  { rank: 4, label: "Ready" },
];
const RANK: Record<LiveAd["stage"], number> = { starting: 0, queued: 0, writing: 1, checking: 2, fixing: 2, image: 3, ready: 4, failed: 0 };

function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function CreateProgress({ ads, renderReady }: {
  ads: LiveAd[];
  renderReady: (creative: Creative) => ReactNode;
}) {
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const ready = ads.filter((ad) => ad.stage === "ready" && ad.creative).length;
  const failed = ads.filter((ad) => ad.stage === "failed").length;
  const done = ads.reduce((total, ad) => total + (ad.stage === "failed" ? 4 : RANK[ad.stage]), 0);

  return (
    <section aria-label="Ads being created" className="flex min-w-0 flex-col gap-3">
      <div className="sticky top-0 z-10 flex flex-col gap-2 bg-white pb-2">
        <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
          <span className="font-medium text-slate-900">Creating {ads.length} ads</span>
          <span className="tabular-nums text-slate-500">
            {elapsed(now - startedAt)} elapsed · usually about a minute
          </span>
        </p>
        <div
          role="progressbar"
          aria-label="Ads created"
          aria-valuemin={0}
          aria-valuemax={ads.length * 4}
          aria-valuenow={done}
          className="h-1.5 overflow-hidden rounded-full bg-slate-100"
        >
          <div className="h-full rounded-full bg-blue-600 motion-safe:transition-[width] motion-safe:duration-500" style={{ width: `${(done / (ads.length * 4)) * 100}%` }} />
        </div>
        <p aria-live="polite" className="sr-only">
          {ready ? `${ready} of ${ads.length} ads ready.` : ""}{failed ? ` ${failed} could not be finished.` : ""}
        </p>
      </div>
      <ul className="grid min-w-0 gap-3 sm:grid-cols-3">
        {ads.map((ad, index) => (
          <li key={index} className="min-w-0">
            {ad.stage === "ready" && ad.creative ? renderReady(ad.creative) : <AdSkeleton ad={ad} index={index} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

function AdSkeleton({ ad, index }: { ad: LiveAd; index: number }) {
  const rank = RANK[ad.stage];
  const failed = ad.stage === "failed";
  return (
    <div aria-label={`${ad.angleName ?? `Ad ${index + 1}`}: ${failed ? "could not be finished" : ad.stage === "starting" || ad.stage === "queued" ? "waiting to start" : "in progress"}`} className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className={cn("relative aspect-[4/3] bg-slate-100 sm:aspect-square", !failed && "motion-safe:animate-pulse")}>
        <span className="absolute left-2 top-2 rounded-md bg-white/90 px-2 py-0.5 text-xs font-medium text-slate-700">
          {ad.angleName ?? `Ad ${index + 1}`}
        </span>
      </div>
      {failed ? (
        <p className="flex items-start gap-2 p-3 text-xs text-slate-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          This ad could not be finished. The other ads carry on.
        </p>
      ) : (
        <ol className="flex flex-col gap-1.5 p-3 text-xs">
          {STEPS.map((step) => {
            const state = rank > step.rank ? "done" : rank === step.rank ? "active" : "pending";
            const label = step.rank === 2 && ad.stage === "fixing" ? "Fixing a detail" : step.label;
            return (
              <li key={step.rank} aria-current={state === "active" ? "step" : undefined} className={cn("flex items-start gap-2", state === "pending" ? "text-slate-400" : "text-slate-700")}>
                {state === "done" ? (
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-label="Done" />
                ) : state === "active" ? (
                  <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600 motion-safe:animate-spin" aria-label="In progress" />
                ) : (
                  <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full border border-slate-300" aria-hidden="true" />
                )}
                <span className="min-w-0 break-words">{label}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
