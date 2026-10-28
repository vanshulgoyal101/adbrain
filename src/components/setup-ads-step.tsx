"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { preload } from "react-dom";
import Link from "next/link";
import { Check, Loader2, Maximize2, Pencil } from "lucide-react";
import { setCreativeStatus } from "@/app/(app)/studio/actions";
import { applyCreateLine, readCreateResponse, type LiveAd } from "@/components/create-progress";
import { SampleViewer } from "@/components/sample-viewer";
import { SetupSpine } from "@/components/setup-spine";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { creativeThumbnailUrl } from "@/lib/creative/thumbnail";
import { downloadBlob } from "@/lib/download";
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
const RATE_LIMIT_WAIT_MS = 60_000;

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
 * #1534: the tab that gets a batch's ads publishes them, so other tabs waiting on the same batch show them at once
 * instead of polling the status route (30 reads per 5 minutes per owner, shared by every tab) into 429s.
 */
const resultKey = (businessId: string) => `setup-generation-result:${businessId}`;
function readResult(businessId: string, id: string, raw?: string | null): Creative[] | null {
  try {
    const value = JSON.parse(raw ?? window.localStorage.getItem(resultKey(businessId)) ?? "null") as { id?: string; at?: number; creatives?: Creative[] } | null;
    if (value && Date.now() - Number(value.at) > KEEP_MS) { window.localStorage.removeItem(resultKey(businessId)); return null; }
    return value?.id === id && Array.isArray(value.creatives) && value.creatives.length ? value.creatives : null;
  } catch { return null; }
}
function publish(businessId: string, id: string, creatives: Creative[]) {
  if (!creatives.length) return;
  try { window.localStorage.setItem(resultKey(businessId), JSON.stringify({ id, at: Date.now(), creatives })); } catch { /* the other tabs keep polling */ }
}
/** Waits up to `ms` for another tab to publish this batch; null if none did. */
function publishedWithin(businessId: string, id: string, ms: number): Promise<Creative[] | null> {
  return new Promise((resolve) => {
    const done = (value: Creative[] | null) => { window.clearTimeout(timer); window.removeEventListener("storage", heard); resolve(value); };
    const heard = (event: StorageEvent) => {
      if (event.key !== resultKey(businessId)) return;
      const found = readResult(businessId, id, event.newValue);
      if (found) done(found);
    };
    const timer = window.setTimeout(() => done(readResult(businessId, id)), ms);
    window.addEventListener("storage", heard);
  });
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The generate route stops by 300 s, so a batch whose first ad is older has ended, whatever its status says (#1289).
const BATCH_DEADLINE_MS = 6 * 60 * 1000;

/**
 * #1270 (#1251 WS1 step 2): makes 3 ads with the existing interview and Create stream, then shows them
 * with the best 2 picked (fixed rule, `setupPicks`). Leaving mid-way is safe: the generation id is kept,
 * and coming back reads what was saved instead of starting again (#1261).
 */
export function SetupAdsStep({ business, initialAds, sample = false, earlier = false }: {
  business: Business; initialAds: Creative[];
  /** #1475: the owner has ads from earlier details or Studio, so a paid batch starts only from a tap. */
  earlier?: boolean;
  /** #1407: a sales prospect's account takes its picks away as the marked sample pack, without Review or Go live. */
  sample?: boolean;
}) {
  const language = defaultAdLanguage(business.languages);
  const languageLabel = CREATE_LANGUAGES.find((item) => item.id === language)?.label ?? "English";
  const [ads, setAds] = useState<Creative[]>(initialAds);
  // #1407: a sales visit takes all of them; an owner starts with the best 2.
  const picksFor = (list: Creative[]) => sample ? list.map((ad) => ad.id) : setupPicks(list);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(picksFor(initialAds)));
  const [slots, setSlots] = useState<LiveAd[] | null>(null);
  const [making, setMaking] = useState(initialAds.length === 0 && !earlier);
  const [failedCount, setFailedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);
  const closeViewer = useCallback(() => {
    setViewing(false);
    document.getElementById("sample-full-screen")?.focus();
  }, []);
  // #1407: on return, ads of this batch still being made (they're added as they land).
  const [coming, setComing] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const startedRef = useRef(false);
  const briefRef = useRef<string | null>(null);

  useEffect(() => {
    if (startedRef.current || initialAds.length) return;
    // #1475: a batch already running (another tab) is still picked up; a new one waits for the tap.
    if (earlier && !readKept(business.id)) return;
    startedRef.current = true;
    void makeAds(FULL_BATCH);
    // Runs once per visit; makeAds reads only stable props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function finish(saved: Creative[], expected: number, replace: boolean) {
    const next = replace ? saved : [...ads, ...saved.filter((ad) => !ads.some((have) => have.id === ad.id))];
    setAds(next);
    setPicked(new Set(picksFor(next)));
    setFailedCount(Math.max(0, expected - saved.length));
    setSlots(null);
    setMaking(false);
    forget(business.id);
  }

  // #1407 (QA 2): coming back to a batch that ended short showed only what was saved. Ask the batch what it expected.
  // #1402: ads come oldest first and a "Make another" top-up last, so the newest batch is the one that may still run.
  const newestGroup = initialAds.at(-1)?.variant_group;
  const returnedBatch = newestGroup && UUID.test(newestGroup) ? newestGroup : null;
  useEffect(() => {
    if (!returnedBatch) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      const response = await fetch(`/api/creatives/generate?businessId=${encodeURIComponent(business.id)}&generationId=${encodeURIComponent(returnedBatch)}`, {
        cache: "no-store", signal: AbortSignal.timeout(10_000),
      }).catch(() => null);
      if (stopped || !response?.ok) return;
      const result = await response.json().catch(() => null) as { status?: string; creatives?: Creative[]; expectedCount?: number } | null;
      const saved = result?.creatives ?? [];
      if (stopped || !result?.expectedCount || !saved.length) return;
      const arrived = saved.filter((ad) => !initialAds.some((have) => have.id === ad.id));
      setAds((previous) => [...previous, ...arrived.filter((ad) => !previous.some((have) => have.id === ad.id))]);
      if (sample && arrived.length) setPicked((current) => new Set([...current, ...arrived.map((ad) => ad.id)]));
      const missing = Math.max(0, result.expectedCount - saved.length);
      const first = Math.min(...saved.map((ad) => Date.parse(ad.created_at ?? "") || Date.now()));
      const ended = (result.status !== "processing" && result.status !== "partial") || Date.now() - first > BATCH_DEADLINE_MS;
      setFailedCount(ended ? missing : 0);
      setComing(ended ? 0 : missing);
      if (!ended && missing) timer = setTimeout(() => void check(), 15_000);
    };
    void check();
    return () => { stopped = true; clearTimeout(timer); };
  }, [business.id, returnedBatch, initialAds, sample]);

  /**
   * The batch's ads once it has finished: `complete`, `failed`, or `unresolved` (finished short). `processing`
   * and `partial` (some saved, still running) keep waiting (#1402). Null when it's still running after ~4 minutes.
   */
  async function savedBatch(generationId: string, expected: number): Promise<Creative[] | null> {
    for (let attempt = 0; attempt < POLLS; attempt += 1) {
      const shared = readResult(business.id, generationId);
      if (shared) return shared;
      let wait = POLL_MS;
      try {
        const res = await fetch(`/api/creatives/generate?businessId=${encodeURIComponent(business.id)}&generationId=${encodeURIComponent(generationId)}&expectedCount=${expected}`, { cache: "no-store" });
        if (res.status === 404) return [];
        // #1534: every tab shares the owner's status budget; wait it out (another tab may publish meanwhile).
        if (res.status === 429) wait = Math.min(Math.max(POLL_MS, (Number(res.headers.get("Retry-After")) || 0) * 1000), RATE_LIMIT_WAIT_MS);
        if (res.ok) {
          const data = (await res.json()) as { status?: string; creatives?: Creative[] };
          if (data.status === "complete" || data.status === "failed" || data.status === "unresolved") {
            publish(business.id, generationId, data.creatives ?? []);
            return data.creatives ?? [];
          }
        }
      } catch {
        // Keep checking; never start the generation again.
      }
      const heard = await publishedWithin(business.id, generationId, wait);
      if (heard) return heard;
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
      if (saved?.length) return finish(saved, kept.count, false);
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
      if (status >= 200 && status < 300 && saved.length) {
        publish(business.id, generationId, saved);
        return finish(saved, count, count === FULL_BATCH);
      }
      if (status >= 400 && status < 500 && status !== 408) {
        // Refused before anything was made: nothing to recover.
        forget(business.id);
        generationId = "";
        throw new Error("refused");
      }
      const recovered = await savedBatch(generationId, count);
      if (recovered?.length) return finish(recovered, count, count === FULL_BATCH);
      throw new Error("none");
    } catch {
      if (generationId) {
        const recovered = await savedBatch(generationId, count);
        if (recovered?.length) return finish(recovered, count, count === FULL_BATCH);
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
    await approvePicks();
  }

  async function approvePicks() {
    // Picks become approved ads, the same state Review's Approve sets; Go live checks them again (#681).
    for (const id of ids) {
      const result = await setCreativeStatus(id, "approved");
      if (!result.ok) {
        setSaveError("Not saved. Check your connection.");
        throw new Error(result.error);
      }
    }
  }

  // #1407: the picks, approved as Continue would, through the same export that marks every picture (#1348).
  async function downloadSamplePack() {
    setSaveError(null);
    setDownloading(true);
    try {
      await approvePicks();
      const response = await fetch("/api/creatives/export", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ creativeIds: ids }),
      });
      if (!response.ok) throw new Error("export");
      downloadBlob(await response.blob(), "adbrain-sample-pack.zip");
    } catch {
      setSaveError((current) => current ?? "The download didn't finish. Check your connection and try again.");
    } finally {
      setDownloading(false);
    }
  }

  const story = storyFor(slots);
  const count = `${ids.length} ${ids.length === 1 ? "ad" : "ads"}`;
  const waiting = !making && !ads.length && !error && earlier;
  const primaryLabel = making ? "Making your ads…" : coming > 0 ? `${coming} more on the way…` : !ids.length ? "Pick at least 1 ad"
    : sample ? (downloading ? "Preparing download…" : `Download sample pack (${ids.length})`) : `Continue with ${count}`;

  return (
    <SetupSpine step={2} saved={saveError ? "failed" : null} beforeLeave={beforeLeave}
      primary={waiting ? { label: `Make ${FULL_BATCH} ads`, onClick: () => void makeAds(FULL_BATCH) } : sample
        ? { label: primaryLabel, disabled: making || coming > 0 || downloading || ids.length === 0, onClick: () => void downloadSamplePack() }
        : { label: primaryLabel, disabled: making || coming > 0 || ids.length === 0, href: `/campaigns?new=1&creatives=${ids.join(",")}` }}>
      {making ? (
        <div aria-live="polite" className="flex flex-col items-start gap-3 py-10">
          <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
          <p className="text-lg font-semibold text-slate-950">{SETUP_STORY[story](languageLabel)}</p>
          <p className="text-sm text-slate-600">Usually about a minute</p>
        </div>
      ) : waiting ? (
        <div className="flex flex-col items-start gap-2 py-6">
          <h2 className="text-xl font-semibold text-slate-950">Make ads from your details</h2>
          <p className="text-sm text-slate-600">Your earlier ads were made from older details or in Studio, so they aren&apos;t used here. Making ads is free.</p>
          <Link href="/campaigns?all=1" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4">Use your earlier ads</Link>
        </div>
      ) : error && !ads.length ? (
        <div className="flex flex-col items-start gap-3 py-6">
          <Alert variant="error">{error}</Alert>
          {error.startsWith("We couldn't") && <Button type="button" variant="outline" onClick={() => void makeAds(FULL_BATCH)}>Try again</Button>}
          {!error.startsWith("We couldn't") && <Button type="button" variant="outline" onClick={() => void makeAds(FULL_BATCH)}>Check again</Button>}
        </div>
      ) : (
        <>
          {/* #1564: opened mid-batch, it isn't ready until the rest lands (or the batch ends short). */}
          <h2 className="text-xl font-semibold text-slate-950">{coming > 0 ? "Making your ads…" : "Your ads are ready"}</h2>
          <p className="mt-1 text-sm text-slate-600">{sample
            ? "All of them go in the sample pack, each marked 'Sample ad: not live yet'. Tap an ad to leave it out, or the pencil to edit its words."
            : `We picked the ${Math.min(SETUP_PICKS, ads.length)} strongest. Tap an ad to change your pick, or the pencil to edit its words.`}</p>
          {sample && (
            <Button id="sample-full-screen" type="button" variant="outline" className="mt-4 w-full sm:w-auto" disabled={!ids.length || coming > 0}
              onClick={() => setViewing(true)}>
              <Maximize2 className="h-4 w-4" aria-hidden="true" /> Show full screen
            </Button>
          )}
          {viewing && <SampleViewer ads={ads.filter((ad) => picked.has(ad.id))} onClose={closeViewer} />}
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
          {coming > 0 && (
            <p role="status" className="mt-4 text-sm text-slate-700">
              {coming === 1 ? "1 more ad is still being made. It appears here when it's ready." : `${coming} more ads are still being made. They appear here when they're ready.`}
            </p>
          )}
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
