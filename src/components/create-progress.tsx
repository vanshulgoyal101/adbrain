"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import type { CreateStreamLine } from "@/app/api/creatives/generate/route";
import type { CreateProgressStage } from "@/lib/creative/generate";
import { CREATE_IDLE_MS, CREATE_IDLE_NO_HEARTBEAT_MS } from "@/lib/creative/stream";
import type { Creative } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface LiveAd {
  angleId?: string;
  angleName?: string;
  stage: CreateProgressStage | "starting";
  creative?: Creative;
  /** #1542: its picture is coming from the slower free provider. */
  slowPictures?: boolean;
}

/**
 * Reads the live Create stream, or a plain JSON response, and returns the final status and body.
 * A stream that goes silent too long throws, so the caller falls back to reading saved results (#666).
 */
export async function readCreateResponse(
  res: Response,
  onLine: (line: Exclude<CreateStreamLine, { type: "result" }>) => void,
): Promise<{ status: number; data: unknown }> {
  if (!res.body || !res.headers.get("content-type")?.includes("application/x-ndjson")) {
    return { status: res.status, data: await res.json().catch(() => ({})) };
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  // Before the first heartbeat (an older route, or a proxy holding bytes back), wait out the route's deadline.
  let heartbeats = false;
  const read = () => new Promise<ReadableStreamReadResult<string>>((resolve, reject) => {
    const timer = setTimeout(() => {
      reader.cancel().catch(() => {});
      reject(new Error("The Create stream went silent."));
    }, heartbeats ? CREATE_IDLE_MS : CREATE_IDLE_NO_HEARTBEAT_MS);
    reader.read().then(
      (chunk) => { clearTimeout(timer); resolve(chunk); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
  let buffer = "";
  for (;;) {
    const { value, done } = await read();
    buffer += value ?? "";
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const text = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (!text) {
        heartbeats = true;
        continue;
      }
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
  if (line.type === "topUp") return ads;
  let index = ads.findIndex((ad) => ad.angleId === line.angleId);
  if (index < 0) index = ads.findIndex((ad) => !ad.angleId);
  if (index < 0) return ads;
  const next = [...ads];
  next[index] = line.type === "creative"
    ? { ...next[index], angleId: line.angleId, creative: line.creative }
    : { ...next[index], angleId: line.angleId, angleName: line.angleName, stage: line.stage,
      ...(line.slowPictures || next[index].slowPictures ? { slowPictures: true } : {}) };
  return next;
}

/** Orders saved creatives by the live slot that showed them; creatives no slot showed go last. */
export function orderBySlots(ads: LiveAd[], creatives: Creative[]): Creative[] {
  const slotIds = ads.map((ad) => ad.creative?.id).filter((id): id is string => Boolean(id));
  const rank = (c: Creative) => {
    const i = slotIds.indexOf(c.id);
    return i < 0 ? slotIds.length : i;
  };
  return [...creatives].sort((a, b) => rank(a) - rank(b));
}

const STEPS = [
  { rank: 1, label: "Writing the copy" },
  { rank: 2, label: "Checking facts and claims against your Brand" },
  { rank: 3, label: "Designing the image" },
  { rank: 4, label: "Ready" },
];
const RANK: Record<LiveAd["stage"], number> = { starting: 0, queued: 0, writing: 1, checking: 2, fixing: 2, image: 3, ready: 4, failed: 0 };

/** p90 of a 3-ad Create on production models: 66 s serial, 75 s parallel (#713 timing run, Oct 26). */
export const CREATE_PROMISE_MS = 90_000;

function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function CreateProgress({ ads, makingMore = 0, makingMorePictures = false, renderReady, onUseSaved }: {
  ads: LiveAd[];
  /** #1123: ads the route is remaking in the same request after the first pass came up short. */
  makingMore?: number;
  /** #1547: only their pictures are being tried again (the words already passed). */
  makingMorePictures?: boolean;
  renderReady: (creative: Creative) => ReactNode;
  /** #760: move on with the saved ads while the rest keep going on the server. */
  onUseSaved?: () => void;
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
  const saved = ads.filter((ad) => ad.creative).length;
  // #1542: say why the wait is long instead of a silent one; only while those ads are still coming.
  const coming = ads.filter((ad) => ad.stage !== "ready" && ad.stage !== "failed").length;
  const slow = coming > 0 && ads.some((ad) => ad.slowPictures && ad.stage !== "ready" && ad.stage !== "failed");

  return (
    <section aria-label="Ads being created" className="flex min-w-0 flex-col gap-3">
      {/* Below the workspace top bar (60–65 px) when the page scrolls; inside the history box on desktop (#344). */}
      <div className="sticky top-[68px] z-10 flex flex-col gap-2 bg-white pb-2 lg:top-0">
        <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
          <span className="font-medium text-slate-900">Creating {ads.length} ads</span>
          <span className="tabular-nums text-slate-500">
            {elapsed(now - startedAt)} elapsed ·{" "}
            {slow ? "still going" : now - startedAt < CREATE_PROMISE_MS ? "usually under 1½ minutes" : "taking longer than usual, still going"}
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
        {slow && (
          <p role="status" className="text-sm text-slate-600">
            Pictures are taking longer today. {coming === 1 ? "Your last ad is still coming." : `Your ${coming} ads are still coming.`}
          </p>
        )}
        {makingMore > 0 && (
          <p role="status" className="text-sm text-slate-600">
            {makingMorePictures
              ? `${makingMore === 1 ? "1 picture" : `${makingMore} pictures`} didn't come through. Trying again…`
              : <>{makingMore} didn&apos;t pass our checks. Making {makingMore} more…</>}
          </p>
        )}
        <p aria-live="polite" className="sr-only">
          {ready ? `${ready} of ${ads.length} ads ready.` : ""}{failed ? ` ${failed} could not be finished.` : ""}
        </p>
        {onUseSaved && saved >= 2 && saved < ads.length && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <button
              type="button"
              onClick={onUseSaved}
              className="inline-flex min-h-11 items-center rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            >
              Use these {saved} now
            </button>
            <span className="text-xs text-slate-500">
              {ads.length - saved === 1 ? "The last one keeps going and is added when it's ready." : "The rest keep going and are added when they're ready."}
            </span>
          </div>
        )}
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
