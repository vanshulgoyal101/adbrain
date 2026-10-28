"use client";

import { useEffect, useRef, useState } from "react";
import { preload } from "react-dom";
import Link from "next/link";
import { Check, Loader2, Pencil } from "lucide-react";
import { setCreativeStatus } from "@/app/(app)/studio/actions";
import { applyCreateLine, readCreateResponse, type LiveAd } from "@/components/create-progress";
import { SetupSpine } from "@/components/setup-spine";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { creativeThumbnailUrl } from "@/lib/creative/thumbnail";
import { SETUP_PICKS, setupGoal, setupPicks } from "@/lib/creative/setup-picks";
import { CREATE_LANGUAGES, defaultAdLanguage } from "@/lib/languages";
import type { Business, Creative } from "@/lib/types";
import { cn } from "@/lib/utils";

const FULL_BATCH = 3;
const AI_ANSWER = "Let the AI decide the best option based on the brand.";
const MAX_INTERVIEW_TURNS = 4;

type Story = "reading" | "writing" | "checking" | "pictures" | "almost";
/** One line at a time (#1251 CPO strings); a table so each step can carry option-specific words later (#1320). */
export const SETUP_STORY: Record<Story, (language: string) => string> = {
  reading: () => "Reading your business…",
  writing: (language) => `Writing 3 ads in ${language}…`,
  checking: () => "Checking each ad against Meta's rules…",
  pictures: () => "Making the pictures…",
  almost: () => "Almost ready…",
};

/** The furthest any ad has got; the story never goes backwards. */
export function storyFor(slots: LiveAd[] | null): Story {
  if (!slots) return "reading";
  if (slots.some((slot) => slot.creative || slot.stage === "ready")) return "almost";
  if (slots.some((slot) => slot.stage === "image")) return "pictures";
  if (slots.some((slot) => slot.stage === "checking" || slot.stage === "fixing")) return "checking";
  return "writing";
}

const generationKey = (businessId: string) => `setup-generation:${businessId}`;
/** A batch takes 1–3 minutes; a kept id older than this is a leftover, not a run in progress. */
const KEEP_MS = 15 * 60_000;
// #1402: the status GET allows 30 reads per 5 minutes; every 10 s for 4 minutes stays inside it.
const POLL_MS = 10_000;
const POLLS = 24;

/** #1402: the run in progress lives in localStorage, so a second tab resumes it instead of paying for another. */
function readKept(businessId: string): { id: string; count: number } | null {
  try {
    const [id, count, at] = (window.localStorage.getItem(generationKey(businessId)) ?? "").split(":");
    if (!id || Date.now() - Number(at) > KEEP_MS) return null;
    return { id, count: Number(count) || FULL_BATCH };
  } catch { return null; }
}
function keep(businessId: string, id: string, count: number) {
  try { window.localStorage.setItem(generationKey(businessId), `${id}:${count}:${Date.now()}`); } catch { /* private mode: this tab still guards itself */ }
}
function forget(businessId: string) {
  try { window.localStorage.removeItem(generationKey(businessId)); } catch { /* nothing kept */ }
}

/**
 * #1270 (#1251 WS1 step 2): makes 3 ads with the existing interview and Create stream, then shows them
 * with the best 2 picked (fixed rule, `setupPicks`). Leaving mid-way is safe: the generation id is kept,
 * and coming back reads what was saved instead of starting again (#1261).
 */
export function SetupAdsStep({ business, initialAds, pendingBatch = null }: {
  business: Business;
  initialAds: Creative[];
  /** #1402: the newest batch is recent and short, so it may still be running (e.g. started on another device). */
  pendingBatch?: { generationId: string } | null;
}) {
  const language = defaultAdLanguage(business.languages);
  const languageLabel = CREATE_LANGUAGES.find((item) => item.id === language)?.label ?? "English";
  const [ads, setAds] = useState<Creative[]>(initialAds);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(setupPicks(initialAds)));
  const [slots, setSlots] = useState<LiveAd[] | null>(null);
  const [making, setMaking] = useState(initialAds.length === 0 || Boolean(pendingBatch));
  const [failedCount, setFailedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const startedRef = useRef(false);
  const briefRef = useRef<string | null>(null);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (pendingBatch) void resume(pendingBatch.generationId);
    else if (!initialAds.length) void makeAds(FULL_BATCH);
    // Runs once per visit; makeAds reads only stable props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function finish(saved: Creative[], expected: number, replace: boolean) {
    const next = replace ? saved : [...ads, ...saved.filter((ad) => !ads.some((have) => have.id === ad.id))];
    setAds(next);
    setPicked(new Set(setupPicks(next)));
    setFailedCount(Math.max(0, expected - saved.length));
    setSlots(null);
    setMaking(false);
    forget(business.id);
  }

  /** #1402: wait for a batch already running (this or another tab or device) instead of starting one. */
  async function resume(generationId: string, expected?: number) {
    const done = await savedBatch(generationId, expected);
    if (done) return finish(done.creatives, done.expected, false);
    setMaking(false);
    setError("Your ads are still being made. Check again in a minute; we won't start another batch.");
  }

  /**
   * The batch once it has finished: `complete`, `failed`, or `unresolved` (finished short). `processing` and
   * `partial` (some ads saved, still running) keep waiting (#1402). Null when it's still running after ~4 minutes.
   */
  async function savedBatch(generationId: string, expected?: number): Promise<{ creatives: Creative[]; expected: number } | null> {
    for (let attempt = 0; attempt < POLLS; attempt += 1) {
      try {
        const res = await fetch(`/api/creatives/generate?businessId=${encodeURIComponent(business.id)}&generationId=${encodeURIComponent(generationId)}${expected ? `&expectedCount=${expected}` : ""}`, { cache: "no-store" });
        if (res.status === 404) return { creatives: [], expected: expected ?? FULL_BATCH };
        if (res.ok) {
          const data = (await res.json()) as { status?: string; creatives?: Creative[]; expectedCount?: number };
          if (data.status === "complete" || data.status === "failed" || data.status === "unresolved") {
            return { creatives: data.creatives ?? [], expected: data.expectedCount ?? expected ?? FULL_BATCH };
          }
        }
      } catch {
        // Keep checking; never start the generation again.
      }
      await new Promise((resolve) => window.setTimeout(resolve, POLL_MS));
    }
    return null;
  }

  async function brief(): Promise<string> {
    // "Make another" reuses this visit's brief: no second interview.
    if (briefRef.current) return briefRef.current;
    const answers: { question: string; answer: string; questionId?: string; field?: string; options?: string[] }[] = [];
    for (let turn = 0; turn < MAX_INTERVIEW_TURNS; turn += 1) {
      const res = await fetch("/api/creatives/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: business.id, goal: setupGoal(business), answers }),
        signal: AbortSignal.timeout(50_000),
      });
      const data = (await res.json()) as { ready?: boolean; brief?: string; question?: { id?: string; question: string; field?: string; options?: string[] } };
      if (!res.ok) throw new Error("assistant");
      if (data.ready && data.brief?.trim()) return (briefRef.current = data.brief.trim());
      if (!data.question) throw new Error("assistant");
      // The first-timer isn't asked: AdBrain decides from the business, as Create's "Let AdBrain decide" does.
      answers.push({ question: data.question.question, answer: AI_ANSWER, questionId: data.question.id, field: data.question.field, options: data.question.options });
    }
    throw new Error("assistant");
  }

  async function makeAds(count: number) {
    setError(null);
    setMaking(true);
    setSlots(null);
    const kept = readKept(business.id);
    if (kept) {
      const saved = await savedBatch(kept.id, kept.count);
      if (saved?.creatives.length) return finish(saved.creatives, saved.expected, false);
      if (saved === null) {
        setMaking(false);
        setError("Your ads are still being made. Check again in a minute; we won't start another batch.");
        return;
      }
      forget(business.id);
    }
    let generationId = "";
    try {
      const adBrief = await brief();
      generationId = crypto.randomUUID();
      keep(business.id, generationId, count);
      let live: LiveAd[] = Array.from({ length: count }, () => ({ stage: "starting" as const }));
      setSlots(live);
      const res = await fetch("/api/creatives/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        body: JSON.stringify({ businessId: business.id, brief: adBrief, count, language, generationId, sourceFacts: [setupGoal(business)] }),
      });
      const { status, data } = await readCreateResponse(res, (line) => {
        live = applyCreateLine(live, line);
        setSlots(live);
      });
      const saved = (data as { creatives?: Creative[] } | null)?.creatives ?? [];
      if (status >= 200 && status < 300 && saved.length) return finish(saved, count, count === FULL_BATCH);
      if (status >= 400 && status < 500 && status !== 408) {
        // Refused before anything was made: nothing to recover.
        forget(business.id);
        generationId = "";
        throw new Error("refused");
      }
      const recovered = await savedBatch(generationId, count);
      if (recovered?.creatives.length) return finish(recovered.creatives, recovered.expected, count === FULL_BATCH);
      throw new Error("none");
    } catch {
      if (generationId) {
        const recovered = await savedBatch(generationId, count);
        if (recovered?.creatives.length) return finish(recovered.creatives, recovered.expected, count === FULL_BATCH);
        if (recovered === null) {
          setMaking(false);
          setSlots(null);
          setError("Your ads are still being made. Check again in a minute; we won't start another batch.");
          return;
        }
        forget(business.id);
      }
      setMaking(false);
      setSlots(null);
      if (!ads.length) setError("We couldn't make your ads this time.");
      else setFailedCount(count);
    }
  }

  function toggle(id: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // #1393: the first picture is the step's LCP on a phone; start it before the page's scripts, not after.
  const firstPicture = ads.find((ad) => ad.image_url)?.image_url;
  if (firstPicture) preload(creativeThumbnailUrl(firstPicture), { as: "image", fetchPriority: "high" });

  const chosen = ads.filter((ad) => picked.has(ad.id));
  const ids = chosen.map((ad) => ad.id);

  async function beforeLeave() {
    setSaveError(null);
    if (making || !ids.length) throw new Error("not ready");
    // Picks become approved ads, the same state Review's Approve sets; Go live checks them again (#681).
    for (const id of ids) {
      const result = await setCreativeStatus(id, "approved");
      if (!result.ok) {
        setSaveError("Not saved. Check your connection.");
        throw new Error(result.error);
      }
    }
  }

  const story = storyFor(slots);
  const primaryLabel = making ? "Making your ads…" : ids.length ? `Continue with ${ids.length} ${ids.length === 1 ? "ad" : "ads"}` : "Pick at least 1 ad";

  return (
    <SetupSpine step={2} saved={saveError ? "failed" : null} beforeLeave={beforeLeave}
      primary={{ label: primaryLabel, disabled: making || ids.length === 0, href: `/campaigns?new=1&creatives=${ids.join(",")}` }}>
      {making ? (
        <div aria-live="polite" className="flex flex-col items-start gap-3 py-10">
          <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
          <p className="text-lg font-semibold text-slate-950">{SETUP_STORY[story](languageLabel)}</p>
          <p className="text-sm text-slate-600">Usually about a minute</p>
        </div>
      ) : error && !ads.length ? (
        <div className="flex flex-col items-start gap-3 py-6">
          <Alert variant="error">{error}</Alert>
          {error.startsWith("We couldn't") && <Button type="button" variant="outline" onClick={() => void makeAds(FULL_BATCH)}>Try again</Button>}
          {!error.startsWith("We couldn't") && <Button type="button" variant="outline" onClick={() => void makeAds(FULL_BATCH)}>Check again</Button>}
        </div>
      ) : (
        <>
          <h2 className="text-xl font-semibold text-slate-950">Your ads are ready</h2>
          <p className="mt-1 text-sm text-slate-600">We picked the {Math.min(SETUP_PICKS, ads.length)} strongest. Tap an ad to change your pick, or the pencil to edit its words.</p>
          <ul className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {ads.map((ad) => {
              const on = picked.has(ad.id);
              return (
                <li key={ad.id} className={cn("relative overflow-hidden rounded-xl border-2 bg-white", on ? "border-primary" : "border-slate-200")}>
                  {/* #1251 Designer walk: a phone shows a row per ad (picture 96×120), so all 3 and Continue fit one screen; sm+ keeps the 3-up grid. */}
                  <button type="button" aria-pressed={on} onClick={() => toggle(ad.id)} className="flex w-full items-start text-left sm:block">
                    {ad.image_url && (
                      // Studio's thumbnail, falling back to the full picture (as Review does).
                      <img src={creativeThumbnailUrl(ad.image_url)} alt="" width={960} height={960} className="h-[120px] w-24 shrink-0 bg-slate-100 object-cover sm:aspect-square sm:h-auto sm:w-full sm:object-contain"
                        // #1393: only the first card is on screen on a phone; the others wait so they don't share its bandwidth.
                        fetchPriority={ad.image_url === firstPicture ? "high" : "auto"} loading={ad.image_url === firstPicture ? "eager" : "lazy"}
                        onError={(event) => { if (ad.image_url && event.currentTarget.src !== ad.image_url) event.currentTarget.src = ad.image_url; }} />
                    )}
                    <span className="block min-w-0 p-3 pr-14 sm:pr-3">
                      <span className="block font-medium text-slate-950">{ad.headline}</span>
                      <span className={cn("mt-2 inline-flex min-h-6 items-center gap-1 text-sm font-medium", on ? "text-primary" : "text-slate-600")}>
                        {on ? <><Check className="h-4 w-4" aria-hidden="true" /> Picked</> : "Tap to pick"}
                      </span>
                    </span>
                  </button>
                  <Link href={`/studio?creative=${ad.id}`} aria-label={`Edit the words of ${ad.headline ?? "this ad"}`}
                    className="absolute top-2 right-2 inline-flex size-11 items-center justify-center rounded-full bg-white/90 text-slate-800 shadow">
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
          {failedCount > 0 && (
            <p className="mt-4 text-sm text-slate-700">
              {failedCount === 1 ? "1 ad couldn't be made." : `${failedCount} ads couldn't be made.`}{" "}
              <button type="button" className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4" onClick={() => void makeAds(failedCount)}>Make another</button>
            </p>
          )}
          {error && ads.length > 0 && <Alert variant="error" className="mt-4">{error}</Alert>}
          {saveError && <Alert variant="error" className="mt-4">{saveError}</Alert>}
        </>
      )}
    </SetupSpine>
  );
}
