"use client";
import { takePendingIdea } from "@/lib/ideas/pending";
import { creativeThumbnailUrl } from "@/lib/creative/thumbnail";

import { Fragment, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
  CalendarDays,
  CheckCircle2,
  Loader2,
  Pencil,
  RotateCcw,
  Send,
  Shuffle,
  Sparkles,
  Wand2,
} from "lucide-react";
import { setCreativeStatus } from "@/app/(app)/studio/actions";
import { AdLanguagePicker } from "@/components/ad-language-picker";
import { CopyEditNotice, CreativeEditor, UnsavedPreviewBadge, sameAdText, savedAdText, type AdText, type CopyEditNotes } from "@/components/creative-copy-editor";
import { LivePicture, type PicturePreview } from "@/components/live-picture";
import { applyCreateLine, CreateProgress, orderBySlots, readCreateResponse, type LiveAd } from "@/components/create-progress";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { useMounted } from "@/lib/use-mounted";
import type { InterviewAnswer, InterviewQuestion } from "@/lib/creative/interview";
import { isWriteYourOwnOption } from "@/lib/creative/interview-options";
import { creativeFollowUps, creativeRecommendations, hasCreateFacts } from "@/lib/creative/recommendations";
import { CREATE_LANGUAGES, defaultAdLanguage, type CreateLanguageId } from "@/lib/languages";
import type { OpeningLine } from "@/lib/campaign/result-evidence";
import type { Suggestion } from "@/lib/seasonal";
import type { Business, Creative } from "@/lib/types";
import { cn } from "@/lib/utils";
import { z } from "zod";

z.config({ jitless: true });

type Question = InterviewQuestion;
type Answer = InterviewAnswer;
type PreparedBrief = { brief: string; language?: string; recommendations?: { label: string; prompt: string }[] };
type Turn =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; progress?: boolean }
  | { role: "question"; question: Question }
  // `missing` ads failed and can be made again from the same brief (#634).
  | { role: "result"; creatives: Creative[]; missing?: number; brief?: string; language?: string };

const FULL_BATCH = 3;
const withoutProgress = (turns: Turn[]) => turns.filter((turn) => !(turn.role === "assistant" && turn.progress));

const RANDOM_ANSWER = "Surprise me — pick a fun, on-brand option.";
const AI_ANSWER = "Let the AI decide the best option based on the brand.";

interface Draft {
  goal: string;
  started: boolean;
  turns: Turn[];
  answers: Answer[];
  phase: "chat" | "review" | "done";
  prepared?: PreparedBrief;
  recentGoals?: string[];
  generationId?: string;
  /** How many ads `generationId` asked for: 3, or fewer when making the missing ones (#634). */
  generationCount?: number;
  referenceBrief?: string;
  language?: CreateLanguageId;
  languagePicked?: boolean;
}

function isCreateLanguage(value: unknown): value is CreateLanguageId {
  return CREATE_LANGUAGES.some((language) => language.id === value);
}

const draftKey = (businessId: string) => `adbrain:assistant:${businessId}`;

/**
 * Session-scoped draft so navigating to another tab and back doesn't throw away
 * a half-finished conversation. Only settled phases are kept — a request that
 * was in flight when the page unmounted can't be resumed.
 */
function readDraft(businessId: string): Draft | null {
  try {
    const raw = sessionStorage.getItem(draftKey(businessId));
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<Draft>;
    if (typeof d.goal !== "string" || !Array.isArray(d.turns)) return null;
    return {
      goal: d.goal,
      started: d.started === true,
      turns: d.turns as Turn[],
      answers: Array.isArray(d.answers) ? (d.answers as Answer[]) : [],
      phase: d.phase === "done" ? "done" : d.phase === "review" ? "review" : "chat",
      prepared: typeof d.prepared?.brief === "string" ? {
        brief: d.prepared.brief.slice(0, 2000),
        language: typeof d.prepared.language === "string" ? d.prepared.language : undefined,
        recommendations: Array.isArray(d.prepared.recommendations) ? d.prepared.recommendations.filter((item) => typeof item?.label === "string" && typeof item?.prompt === "string").slice(0, 3).map((item) => ({ label: item.label.slice(0, 80), prompt: item.prompt.slice(0, 500) })) : undefined,
      } : undefined,
      recentGoals: Array.isArray(d.recentGoals) ? d.recentGoals.filter((item): item is string => typeof item === "string").slice(-6) : [],
      generationId: typeof d.generationId === "string" && /^[0-9a-f-]{36}$/i.test(d.generationId) ? d.generationId : undefined,
      generationCount: Number.isInteger(d.generationCount) && d.generationCount! >= 1 && d.generationCount! <= FULL_BATCH ? d.generationCount : undefined,
      referenceBrief: typeof d.referenceBrief === "string" ? d.referenceBrief.slice(0, 2000) : undefined,
      language: isCreateLanguage(d.language) ? d.language : undefined,
      languagePicked: d.languagePicked === true,
    };
  } catch {
    return null;
  }
}

function writeDraft(businessId: string, draft: Draft): void {
  try {
    sessionStorage.setItem(draftKey(businessId), JSON.stringify(draft));
  } catch {
    // Private mode or a full quota — losing the draft is not worth throwing.
  }
}

function clearDraft(businessId: string): void {
  try {
    sessionStorage.removeItem(draftKey(businessId));
  } catch {
    // Ignore — see writeDraft.
  }
}

/** #1004 (CPO wording): the Brand facts the 3 ads will use (areas, then the offer or else a proof point), above 'Make 3 ads'. */
function createFactsLine(business: Pick<Business, "locations" | "offers" | "usps">): string {
  const first = (values?: string[] | null) => (values ?? []).map((value) => value.trim()).filter(Boolean);
  const cut = (value: string) => (value.length > 40 ? `${value.slice(0, 39).trimEnd()}…` : value);
  // #1034: Create sends every Brand area, so none is dropped here: the first 3, then how many more.
  const areas = first(business.locations);
  const places = areas.slice(0, 3).join(", ") + (areas.length > 3 ? ` +${areas.length - 3} more` : "");
  const offer = first(business.offers)[0];
  const proof = offer ? undefined : first(business.usps)[0];
  const facts = [places, offer && `offer: ${cut(offer)}`, proof && `proof: ${cut(proof)}`].filter(Boolean).join(" · ");
  return `Your 3 ads will use: ${facts}`;
}

export function AdAssistant({ business, opening = null, occasions = [], onFlowStep }: {
  business: Business;
  opening?: OpeningLine | null;
  /** #700: today's festivals and seasons (IST), worked out on the server. */
  occasions?: Suggestion[];
  /** #760: "Brief" while the owner answers, "Create" once ads are being or have been made. */
  onFlowStep?: (step: "Brief" | "Create") => void;
}) {
  const [goal, setGoal] = useState("");
  const [started, setStarted] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [custom, setCustom] = useState("");
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<"chat" | "review" | "generating" | "done">("chat");
  const [prepared, setPrepared] = useState<PreparedBrief | undefined>();
  const [recentGoals, setRecentGoals] = useState<string[]>([]);
  const [referenceBrief, setReferenceBrief] = useState<string | undefined>();
  const [language, setLanguage] = useState<CreateLanguageId>(() => defaultAdLanguage(business.languages, business.vertical));
  // An explicit pick wins over the language the interview suggests.
  const [languagePicked, setLanguagePicked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Remembers the last network action so an error can be retried in place.
  const [lastAction, setLastAction] = useState<
    { type: "step"; answers: Answer[] } | { type: "generate"; brief: string; language?: string; count?: number } | null
  >(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const followConversationRef = useRef(true);
  const resultCountRef = useRef(0);
  const inFlightRef = useRef(false);
  const [generationId, setGenerationId] = useState<string | null>(null);
  const [generationCount, setGenerationCount] = useState(FULL_BATCH);
  const [live, setLive] = useState<LiveAd[] | null>(null);
  // #760: ads still being made after the owner moved on with the saved ones; the same request finishes them.
  const [stillMaking, setStillMaking] = useState(0);
  const [makingMore, setMakingMore] = useState(0);
  const [makingMorePictures, setMakingMorePictures] = useState(false);
  const movedOnRef = useRef(false);
  const useSavedRef = useRef<(() => void) | null>(null);
  // #858/#1004: any goal on a Brand with offer, area and phone skips the brief review ('Edit brief' keeps it).
  const quickStartRef = useRef(false);
  const [quickBrief, setQuickBrief] = useState<string | null>(null);

  // Restore after mount (never during SSR) so server and client markup agree.
  const mounted = useMounted();
  const [restored, setRestored] = useState(false);
  if (mounted && !restored) {
    setRestored(true);
    const saved = readDraft(business.id);
    // "Make one like this" from /ideas starts a fresh goal instead of the last session (#289).
    const idea = takePendingIdea();
    if (idea) setGoal(idea);
    else if (saved) {
      setGoal(saved.goal);
      setStarted(saved.started);
      setTurns(saved.turns);
      setAnswers(saved.answers);
      setPhase(saved.phase);
      setPrepared(saved.prepared);
      setRecentGoals(saved.recentGoals ?? []);
      setReferenceBrief(saved.referenceBrief);
      setGenerationId(saved.generationId ?? null);
      setGenerationCount(saved.generationCount ?? FULL_BATCH);
      // Older drafts kept only the interview's language on the prepared brief.
      const savedLanguage = saved.language ?? (isCreateLanguage(saved.prepared?.language) ? saved.prepared.language : undefined);
      if (savedLanguage) setLanguage(savedLanguage);
      setLanguagePicked(saved.languagePicked === true);
      if (saved.generationId && saved.phase !== "done" && saved.prepared) {
        setPhase("chat");
        setLastAction({ type: "generate", ...saved.prepared, count: saved.generationCount });
        setError("An earlier generation may still be processing. Check for saved results before starting another.");
      } else if (saved.started && saved.phase === "chat" && saved.turns.at(-1)?.role === "user") {
        setLastAction({ type: "step", answers: saved.answers });
        setError("The last assistant response was interrupted. Retry to continue your brief.");
      }
    }
  }

  useEffect(() => {
    if (!restored) return;
    if (!goal && !started && turns.length === 0 && !recentGoals.length && !languagePicked) {
      clearDraft(business.id);
      return;
    }
    writeDraft(business.id, {
      goal,
      started,
      turns,
      answers,
      phase: phase === "generating" ? "chat" : phase,
      prepared,
      recentGoals,
      generationId: generationId ?? undefined,
      generationCount,
      referenceBrief,
      language,
      languagePicked,
    });
  }, [restored, business.id, goal, started, turns, answers, phase, prepared, recentGoals, referenceBrief, generationId, generationCount, language, languagePicked]);

  useLayoutEffect(() => {
    const node = scrollRef.current;
    const results = turns.filter((turn) => turn.role === "result").length;
    const newResult = results > resultCountRef.current;
    resultCountRef.current = results;
    if (!node) return;
    // On a phone the cards stack, so open new results at their heading, not at the last card.
    if (newResult) {
      const headings = node.querySelectorAll<HTMLElement>("[data-result-heading]");
      headings[headings.length - 1]?.scrollIntoView?.({ block: "start", behavior: "instant" });
      return;
    }
    if (!followConversationRef.current) return;
    if (node.scrollHeight > node.clientHeight) node.scrollTo({ top: node.scrollHeight, behavior: "instant" });
    else node.lastElementChild?.scrollIntoView?.({ block: "end", behavior: "instant" });
  }, [turns, loading, live]);

  const lastTurn = turns[turns.length - 1];
  const activeQuestion =
    phase === "chat" && !loading && lastTurn?.role === "question"
      ? lastTurn.question
      : null;
  const selectedIds = (turns.findLast((t): t is Extract<Turn, { role: "result" }> => t.role === "result")?.creatives ?? [])
    .filter((c) => c.status === "approved")
    .map((c) => c.id);

  function setResultStatus(id: string, status: "draft" | "approved") {
    setTurns((t) => t.map((turn) => turn.role === "result"
      ? { ...turn, creatives: turn.creatives.map((c) => (c.id === id ? { ...c, status } : c)) }
      : turn));
  }

  // Edits made on a card while the rest of the batch is still generating (#280).
  const liveEditsRef = useRef(new Map<string, Creative>());
  const withLiveEdits = (creatives: Creative[]) =>
    creatives.map((c) => {
      const edited = liveEditsRef.current.get(c.id);
      if (!edited) return c;
      const { headline, primary_text, cta, generation, image_url } = edited;
      return { ...c, headline, primary_text, cta, generation, image_url };
    });

  function setResultCopy(edited: Creative) {
    const { headline, primary_text, cta, generation, image_url } = edited;
    setTurns((t) => t.map((turn) => turn.role === "result"
      ? { ...turn, creatives: turn.creatives.map((c) => (c.id === edited.id ? { ...c, headline, primary_text, cta, generation, image_url } : c)) }
      : turn));
  }

  async function step(nextAnswers: Answer[]) {
    if (loading || inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    setError(null);
    setLastAction({ type: "step", answers: nextAnswers });
    let quick: { brief: string; language: CreateLanguageId } | null = null;
    try {
      const res = await fetch("/api/creatives/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: business.id, goal: goal.trim(), answers: nextAnswers, recentGoals, referenceBrief }),
        signal: AbortSignal.timeout(50_000),
      });
      const data = (await res.json()) as {
        ready?: boolean;
        question?: Question;
        brief?: string;
        language?: string;
        recommendations?: PreparedBrief["recommendations"];
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "The assistant had trouble. Please try again.");
        return;
      }
      if (data.ready && data.brief) {
        setPrepared({ brief: data.brief, language: data.language, recommendations: data.recommendations });
        if (!languagePicked && isCreateLanguage(data.language)) setLanguage(data.language);
        setPhase("review");
        setLastAction(null);
        if (quickStartRef.current && nextAnswers.length === 0) {
          quick = { brief: data.brief.trim(), language: !languagePicked && isCreateLanguage(data.language) ? data.language : language };
        }
        quickStartRef.current = false;
      } else if (data.question) {
        quickStartRef.current = false;
        setTurns((t) => [...t, { role: "question", question: data.question! }]);
      } else {
        setError("The assistant had trouble. Please try again.");
      }
    } catch {
      setError("Couldn't reach the assistant — check your connection.");
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
    if (quick?.brief) {
      setQuickBrief(quick.brief);
      generate(quick.brief, quick.language);
    }
  }

  // A full batch adds a result; making the missing ones adds to the last result (#634).
  function showResult(creatives: Creative[], count: number, brief?: string, language?: string, final = true) {
    // While a generation is still running, the rest may yet arrive; don't offer to remake them.
    const missing = final ? Math.max(0, count - creatives.length) : 0;
    if (movedOnRef.current) {
      // The owner already has the saved ads on screen; add only the ones that are new.
      setTurns((t) => {
        const index = t.findLastIndex((turn) => turn.role === "result");
        if (index < 0) return [...withoutProgress(t), { role: "result", creatives, missing, brief, language }];
        return withoutProgress(t.map((turn, i) => {
          if (i !== index || turn.role !== "result") return turn;
          const shown = new Set(turn.creatives.map((c) => c.id));
          const merged = [...turn.creatives, ...creatives.filter((c) => !shown.has(c.id))];
          return { ...turn, creatives: merged, missing: final ? Math.max(0, count - merged.length) : 0 };
        }));
      });
      setPhase("done");
      return;
    }
    setTurns((t) => {
      const settled = withoutProgress(t);
      const index = count < FULL_BATCH ? settled.findLastIndex((turn) => turn.role === "result") : -1;
      if (index < 0) return [...settled, { role: "result", creatives, missing, brief, language }];
      return settled.map((turn, i) => (i === index && turn.role === "result"
        ? { ...turn, creatives: [...turn.creatives, ...creatives], missing }
        : turn));
    });
    setPhase("done");
  }

  async function generate(brief: string, language?: string, count = FULL_BATCH, fresh = false) {
    if (inFlightRef.current) return;
    const ownsLock = !inFlightRef.current;
    if (ownsLock) inFlightRef.current = true;
    setPhase("generating");
    setError(null);
    setLastAction({ type: "generate", brief, language, count });
    if (generationId && !fresh) {
      try {
        const recovered = await recoverPersistedGeneration(generationId, count, brief, language);
        if (!recovered) {
          setError("No saved ads found yet. Check again shortly or open Review. No new ads were started.");
          setPhase("chat");
        }
      } finally {
        setTurns(withoutProgress);
        if (ownsLock) inFlightRef.current = false;
      }
      return;
    }
    const newGenerationId = crypto.randomUUID();
    setGenerationId(newGenerationId);
    setGenerationCount(count);
    writeDraft(business.id, { goal, started, turns, answers, phase: "chat", prepared: { ...prepared, brief, language }, recentGoals, generationId: newGenerationId, generationCount: count, referenceBrief, language: isCreateLanguage(language) ? language : undefined, languagePicked });
    setTurns((t) => [
      ...withoutProgress(t),
      { role: "assistant", progress: true, text: "Creating your campaign images and copy. This can take a few minutes. Keep this page open; nothing will be published." },
    ]);
    let slots: LiveAd[] = Array.from({ length: count }, () => ({ stage: "starting" as const }));
    setLive(slots);
    movedOnRef.current = false;
    useSavedRef.current = () => {
      const saved = slots.map((ad) => ad.creative).filter((c): c is Creative => Boolean(c));
      if (movedOnRef.current || saved.length < 2) return;
      showResult(withLiveEdits(orderBySlots(slots, saved)), count, brief, language, false);
      movedOnRef.current = true;
      setStillMaking(count - saved.length);
      setLive(null);
    };
    try {
      const res = await fetch("/api/creatives/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        body: JSON.stringify({
          businessId: business.id, brief, count, language, generationId: newGenerationId,
          sourceFacts: [goal.trim().slice(0, 500), ...answers
            .filter((answer) => !(answer.options ?? []).includes(answer.answer) && answer.answer !== AI_ANSWER && answer.answer !== RANDOM_ANSWER)
            .map((answer) => answer.answer.trim().slice(0, 500))].filter(Boolean).slice(0, 12),
        }),
      });
      const { status, data: body } = await readCreateResponse(res, (line) => {
        if (line.type === "topUp") {
          setMakingMore(line.missing);
          setMakingMorePictures(line.kind === "picture");
        }
        slots = applyCreateLine(slots, line);
        if (!movedOnRef.current) setLive(slots);
      });
      const data = (body ?? {}) as {
        creatives?: Creative[];
        error?: string;
      };
      // The owner already moved on with the saved ads: add any new ones, never raise an error over them.
      if (movedOnRef.current && (status < 200 || status >= 300 || !data.creatives?.length)) return;
      if (status < 200 || status >= 300) {
        if (status >= 500 || status === 408) {
          const recovered = await recoverPersistedGeneration(newGenerationId, count, brief, language);
          if (recovered) return;
          setError("We can't confirm your ads were saved yet. Check again shortly or open Review. No new ads were started.");
          setPhase("chat");
          return;
        }
        setGenerationId(null);
        setError(
          data.error ??
            `Couldn't create the ad (server returned ${status}). Please try again.`,
        );
        setPhase("chat");
        return;
      }
      if (!data.creatives?.length) {
        const recovered = await recoverPersistedGeneration(newGenerationId, count, brief, language);
        if (recovered) return;
        setError("Your ads finished, but none came back here. Open Review to see what was saved.");
        setPhase("chat");
        return;
      }
      showResult(withLiveEdits(orderBySlots(slots, data.creatives!)), count, brief, language);
    } catch {
      if (movedOnRef.current) return;
      const recovered = await recoverPersistedGeneration(newGenerationId, count, brief, language);
      if (!recovered) {
        setError("Your ads are still being made, or the server stopped responding. Open Review shortly; don't try again yet, because finished ads may already be saved.");
        setPhase("chat");
      }
    } finally {
      movedOnRef.current = false;
      useSavedRef.current = null;
      setStillMaking(0);
      setMakingMore(0);
      setLive(null);
      setTurns(withoutProgress);
      if (ownsLock) inFlightRef.current = false;
    }
  }

  async function recoverPersistedGeneration(generationId: string, count: number, brief: string, language?: string): Promise<boolean> {
    for (let attempt = 0; attempt < 15; attempt += 1) {
      try {
        const res = await fetch(
          `/api/creatives/generate?businessId=${encodeURIComponent(business.id)}&generationId=${encodeURIComponent(generationId)}&expectedCount=${count}`,
          { cache: "no-store" },
        );
        if (res.status === 429) {
          setPhase("chat");
          setError("Too many status checks. Wait a few minutes before checking again. Do not start another generation.");
          return true;
        }
        if (res.ok) {
          const data = (await res.json()) as {
            status?: "processing" | "partial" | "complete" | "failed" | "unresolved" | "ended";
            creatives?: Creative[];
          };
          if (data.creatives?.length) {
            showResult(withLiveEdits(data.creatives!), count, brief, language, data.status !== "partial" && data.status !== "processing");
            if (data.status === "partial") {
              setError("Some ads finished while we reconnected. See them in Review; no duplicate ads were started.");
            }
            return true;
          }
          if (data.status === "failed") {
            setGenerationId(null);
            setPhase("chat");
            setError("No ads were saved. This attempt failed. You can try again.");
            return true;
          }
          if (data.status === "unresolved") {
            setPhase("chat");
            setError("No ads were saved yet; this attempt is held for a check. Look in Review later, and don't start another one yet.");
            return true;
          }
        }
      } catch {
        // Keep reconciling transient status failures without retrying generation.
      }
      await new Promise((resolve) => window.setTimeout(resolve, 2_000));
    }
    return false;
  }

  const lastResultIndex = turns.findLastIndex((turn) => turn.role === "result");
  const flowStep = phase === "generating" || phase === "done" || lastResultIndex >= 0 ? "Create" : "Brief";
  useEffect(() => { onFlowStep?.(flowStep); }, [flowStep, onFlowStep]);

  function makeMissing() {
    const result = turns[lastResultIndex];
    if (result?.role !== "result" || !result.missing || loading || phase === "generating") return;
    const brief = (result.brief ?? prepared?.brief ?? "").trim();
    if (!brief) return;
    generate(brief, result.brief ? result.language : language, Math.min(result.missing, FULL_BATCH), true);
  }

  function retry() {
    if (!lastAction || loading) return;
    if (lastAction.type === "step") step(lastAction.answers);
    else generate(lastAction.brief, lastAction.language, lastAction.count);
  }

  function changeAnswer() {
    if (loading || lastAction?.type !== "step") return;
    const sent = lastAction.answers;
    const last = sent.at(-1);
    setError(null);
    setLastAction(null);
    if (!last) {
      setStarted(false);
      setTurns([]);
      setAnswers([]);
      return;
    }
    setAnswers(sent.slice(0, -1));
    setTurns((t) => (t.at(-1)?.role === "user" ? t.slice(0, -1) : t));
    const typed = !(last.options ?? []).includes(last.answer) && last.answer !== AI_ANSWER && last.answer !== RANDOM_ANSWER && !isWriteYourOwnOption(last.answer);
    setCustom(typed ? last.answer : "");
  }

  function answer(q: Question, text: string, displayText?: string) {
    if (loading) return;
    const next = [...answers, { question: q.question, answer: text, questionId: q.id, field: q.field, options: q.options }];
    setAnswers(next);
    setCustom("");
    setTurns((t) => [...t, { role: "user", text: displayText ?? text }]);
    step(next);
  }

  function start(reviewFirst = false) {
    if (loading) return;
    const g = goal.trim();
    if (!g) return;
    quickStartRef.current = !reviewFirst && hasCreateFacts(business);
    setQuickBrief(null);
    followConversationRef.current = true;
    setStarted(true);
    setError(null);
    setTurns([{ role: "user", text: g }]);
    step([]);
  }

  function pickLanguage(id: CreateLanguageId) {
    setLanguage(id);
    setLanguagePicked(true);
  }

  function reset(nextGoal = "", nextReference?: string) {
    if (loading || inFlightRef.current) return;
    clearDraft(business.id);
    setRecentGoals((previous) => [...previous, goal.slice(0, 500)].filter(Boolean).slice(-6));
    setGenerationId(null);
    setStarted(false);
    setTurns([]);
    setAnswers([]);
    setCustom("");
    setPhase("chat");
    setError(null);
    setLastAction(null);
    setPrepared(undefined);
    setReferenceBrief(nextReference);
    setGoal(nextGoal);
    setQuickBrief(null);
  }

  function editQuickBrief() {
    if (phase === "generating" || loading) return;
    setQuickBrief(null);
    // A new batch from the edited brief, not a recovery of the one just made.
    setGenerationId(null);
    setPhase("review");
  }

  if (!started) {
    const suggestions = creativeRecommendations(business, goal, recentGoals);
    const quick = Boolean(goal.trim()) && hasCreateFacts(business);
    return (
      <section aria-label="Campaign brief" className="min-w-0 max-w-2xl">
        <div>
          <div className="flex flex-col gap-6">
            <h2 className="text-xl font-semibold tracking-normal text-slate-950">
              What would you like to achieve?
            </h2>
            {opening && (
              <div className="rounded-lg bg-slate-50 p-4">
                <p className="text-sm text-slate-800">{opening.text}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {opening.moreLikeThis && (
                    <Button size="sm" variant="outline" onClick={() => { setGoal(opening.moreLikeThis!.goal); setReferenceBrief(opening.moreLikeThis!.referenceBrief); }}>
                      More like this
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => { setGoal(opening.newAngle.goal); setReferenceBrief(undefined); }}>
                    New angle
                  </Button>
                </div>
              </div>
            )}
            {occasions.length > 0 && (
              <div role="group" aria-labelledby="assistant-occasions" className="flex flex-wrap items-center gap-2">
                <span id="assistant-occasions" className="flex items-center gap-1.5 text-sm text-slate-600">
                  <CalendarDays size={15} aria-hidden="true" /> Coming up
                </span>
                {occasions.map((o) => (
                  <Button key={o.id} size="sm" variant="outline" className="min-h-11" onClick={() => { setGoal(o.prompt); setReferenceBrief(undefined); }}>
                    {o.label}
                  </Button>
                ))}
              </div>
            )}
            <div className="min-w-0">
              {/* The question above is the visible label; this keeps the field's own name. */}
              <label htmlFor="assistant-goal" className="sr-only">
                Campaign goal
              </label>
              <Textarea
                id="assistant-goal"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                rows={6}
                maxLength={500}
                className="rounded-md bg-slate-50/50 p-4 text-base leading-7 focus:bg-white"
                placeholder="Who do you want to reach, and what would you like them to do?"
              />
              <p className="mt-2 text-right text-xs tabular-nums text-slate-400" aria-label="Campaign goal length">{goal.length}/500</p>
              <div className="mt-5 flex flex-col divide-y divide-slate-100 border-y border-slate-200">
                {suggestions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setGoal(s.prompt)}
                    className="flex min-h-12 items-center justify-between gap-3 break-words py-3 text-left text-sm text-slate-600 hover:text-blue-700"
                  >
                    {s.label}<ArrowRight size={15} className="shrink-0" aria-hidden="true" />
                  </button>
                ))}
              </div>
              <div className="mt-5">
                <AdLanguagePicker value={language} onChange={pickLanguage} disabled={loading} />
              </div>
              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                {quick ? (
                  // #1004: the tap below starts the paid run, so say what it will use, with a way to check the brief first.
                  <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm text-slate-600">
                    <span className="min-w-0 break-words">{createFactsLine(business)}</span>
                    <button type="button" onClick={() => start(true)} disabled={loading} className="min-h-11 font-medium text-blue-700 hover:underline">Edit brief</button>
                  </p>
                ) : <span aria-hidden="true" />}
                <div className="flex flex-col items-end gap-1 self-end sm:self-auto">
                  <Button onClick={() => start()} disabled={!goal.trim()}>
                    {/* #858: this tap starts the 3 ads straight away, so it says so. */}
                    {quick ? "Make 3 ads" : "Start creating"}
                  </Button>
                  {quick && <p className="text-xs text-slate-500">About 2 minutes. Nothing is published.</p>}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Creative conversation" className="min-w-0">
      <div className="flex min-w-0 flex-col gap-4">
        <div
          ref={scrollRef}
          role="region"
          aria-label="Conversation history"
          tabIndex={0}
          onScroll={(event) => {
            if (event.target !== event.currentTarget) return;
            const node = event.currentTarget;
            followConversationRef.current = node.scrollHeight - node.clientHeight - node.scrollTop <= 24;
          }}
          // #847: the cap keeps a long Q&A in view; finished results flow with the page so no card is clipped.
          className={cn("scrollbar-stable flex flex-col gap-3 pr-1", phase !== "done" && "lg:max-h-[62vh] lg:overflow-y-scroll")}
        >
          {turns.map((turn, i) => (
            <Fragment key={i}>
            <TurnView
              turn={turn}
              active={activeQuestion === (turn.role === "question" ? turn.question : null)}
              disabled={loading || phase !== "chat"}
              custom={custom}
              setCustom={setCustom}
              onAnswer={answer}
              onStatus={setResultStatus}
              onEdited={setResultCopy}
              onMakeMissing={i === lastResultIndex && phase !== "generating" && !loading ? makeMissing : undefined}
              brand={business}
            />
            {i === 0 && quickBrief && (
              <details className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600">
                <summary className="flex min-h-11 cursor-pointer items-center font-medium text-slate-800">What I&apos;ll write about · Edit</summary>
                <p className="mt-1 whitespace-pre-line">{quickBrief}</p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <Button size="sm" variant="outline" onClick={editQuickBrief} disabled={phase === "generating" || loading}>
                    <Pencil className="h-4 w-4" /> Edit brief
                  </Button>
                  {phase === "generating" && <span className="text-xs text-slate-500">You can edit it once these ads are ready.</span>}
                </div>
              </details>
            )}
            </Fragment>
          ))}

          {phase === "generating" && live ? (
            <CreateProgress ads={live} makingMore={makingMore} makingMorePictures={makingMorePictures} onUseSaved={() => useSavedRef.current?.()} renderReady={(creative) => <ResultCard creative={creative} brand={business} onEdited={(edited) => liveEditsRef.current.set(edited.id, edited)} />} />
          ) : (loading || phase === "generating") && (
            <div role="status" className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> {phase === "generating" ? "Creating images and copy…" : "Preparing your brief…"}
            </div>
          )}
          {stillMaking > 0 && (
            <p role="status" className="text-sm text-slate-500">
              {stillMaking === 1 ? "1 more ad is still being made. It's added here when it's ready." : `${stillMaking} more ads are still being made. They're added here when they're ready.`}
            </p>
          )}
        </div>

        {phase === "review" && prepared && (
          <section aria-label="Review creative brief" className="min-w-0 border-t border-slate-200 pt-4">
            <label htmlFor="prepared-brief" className="text-sm font-semibold text-slate-900">Creative brief</label>
            <Textarea id="prepared-brief" value={prepared.brief} onChange={(event) => setPrepared({ ...prepared, brief: event.target.value, recommendations: undefined })} maxLength={2000} rows={7} className="mt-3 w-full" />
            <div className="mt-3">
              <AdLanguagePicker value={language} onChange={pickLanguage} disabled={loading} />
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <Button variant="outline" onClick={() => reset(goal, prepared.brief)} disabled={loading}><Pencil className="h-4 w-4" /> Revise goal</Button>
              <Button onClick={() => generate(prepared.brief.trim(), language)} disabled={loading || !prepared.brief.trim()}><Sparkles className="h-4 w-4" /> Generate 3 ads</Button>
            </div>
          </section>
        )}

        {error && (
          <Alert variant="error">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{error}</span>
              <div className="flex flex-wrap gap-2">
                {lastAction?.type === "step" && (
                  <Button size="sm" variant="outline" onClick={changeAnswer} disabled={loading}>
                    <Pencil className="h-4 w-4" /> Change my answer
                  </Button>
                )}
                {lastAction && (
                  <Button size="sm" variant="outline" onClick={retry} disabled={loading}>
                    <RotateCcw className="h-4 w-4" /> {generationId ? "Check saved results" : "Try again"}
                  </Button>
                )}
              </div>
            </div>
          </Alert>
        )}

        {phase === "chat" && !generationId && (
          <div className="flex justify-end">
            <Button size="sm" variant="ghost" onClick={() => reset()} disabled={loading}>
              <RotateCcw className="h-4 w-4" /> Start over
            </Button>
          </div>
        )}

        {phase === "done" && (
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/studio" className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-blue-700 hover:bg-slate-100">
              Review ads
            </Link>
            <Button variant="ghost" onClick={() => reset()} disabled={stillMaking > 0} className="min-h-11">
              <RotateCcw className="h-4 w-4" aria-hidden="true" /> Make another
            </Button>
          </div>
        )}
        {phase === "done" && selectedIds.length > 0 && (
          // #847: one primary for the whole result, pinned where a phone's thumb is.
          <div className="sticky bottom-3 z-20 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-[0_10px_30px_rgba(16,24,40,0.12)] backdrop-blur">
            <span className="text-sm text-slate-700">{selectedIds.length} selected</span>
            {/* #1004: straight to Review; the composer prepares it once it has settled. #1152: one primary step,
                not a second "Review" beside "Review ads". */}
            <Link href={`/campaigns?new=1&creatives=${selectedIds.join(",")}&review=1`} className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
              Next: set up campaign <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
        )}
        {phase === "done" && (
          <section aria-labelledby="more-ad-ideas" className="flex flex-col divide-y divide-slate-100 border-t border-slate-200">
            <h3 id="more-ad-ideas" className="pb-1 pt-4 text-sm font-medium text-slate-500">Ideas for more ads</h3>
            {(prepared?.recommendations?.length ? prepared.recommendations : creativeFollowUps()).map((suggestion) => <button key={suggestion.label} type="button" onClick={() => reset(suggestion.prompt, prepared?.brief ?? goal)} disabled={stillMaking > 0} className="flex min-h-12 items-center justify-between gap-3 break-words py-3 text-left text-sm text-slate-700 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{suggestion.label}<ArrowRight size={15} className="shrink-0" aria-hidden="true" /></button>)}
          </section>
        )}
      </div>
    </section>
  );
}

function TurnView({
  turn,
  active,
  disabled,
  custom,
  setCustom,
  onAnswer,
  onStatus,
  onEdited,
  onMakeMissing,
  brand,
}: {
  turn: Turn;
  active: boolean;
  disabled: boolean;
  custom: string;
  setCustom: (v: string) => void;
  onAnswer: (q: Question, text: string, displayText?: string) => void;
  onStatus: (id: string, status: "draft" | "approved") => void;
  onEdited: (creative: Creative) => void;
  onMakeMissing?: () => void;
  brand: Business;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  if (turn.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-slate-100 px-3.5 py-2 text-sm text-slate-900">
          {turn.text}
        </div>
      </div>
    );
  }

  if (turn.role === "assistant") {
    return (
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-blue-100 text-blue-700">
          <Bot className="h-3.5 w-3.5" />
        </span>
        <p className="text-sm text-slate-600">{turn.text}</p>
      </div>
    );
  }

  if (turn.role === "result") {
    return (
      <div className="flex flex-col gap-2">
        <h2 data-result-heading className="scroll-mt-20 text-lg font-semibold text-slate-900 lg:scroll-mt-4">
          {turn.creatives.length > 1 ? "Your ads are ready. Pick the ones you like." : "Your ad is ready. Use it if you like it."}
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {turn.creatives.map((c) => (
            <ResultCard key={c.id} creative={c} brand={brand} onStatus={(status) => onStatus(c.id, status)} onEdited={onEdited} />
          ))}
        </div>
        {!!turn.missing && (
          <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-slate-600">
            <span className="min-w-0 flex-1">
              {turn.missing} of {turn.creatives.length + turn.missing} ads couldn&apos;t be made this time.
            </span>
            {onMakeMissing && (
              <Button size="sm" variant="outline" onClick={onMakeMissing}>
                <RotateCcw className="h-4 w-4" /> Make {turn.missing === 1 ? "1 more ad" : `${turn.missing} more ads`}
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  // question
  const q = turn.question;
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-blue-100 text-blue-700">
        <Bot className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 max-w-[92%] break-words rounded-lg border border-slate-200 bg-slate-50 p-3.5">
        <p className="text-sm font-medium text-slate-800">{q.question}</p>
        {q.help && <p className="mt-1 text-xs text-slate-500">{q.help}</p>}
        {active && (
          <div className="mt-3 flex flex-col gap-2">
            {!!q.options?.length && (
              <div className="flex flex-wrap gap-1.5">
                {q.options.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    disabled={disabled}
                    onClick={() => (isWriteYourOwnOption(opt) ? inputRef.current?.focus() : onAnswer(q, opt))}
                    className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50"
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              {q.aiCanDecide && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onAnswer(q, AI_ANSWER, "Let AI decide")}
                  className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                >
                  <Wand2 className="h-3.5 w-3.5" /> Let AI decide
                </button>
              )}
              {q.allowRandom && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onAnswer(q, RANDOM_ANSWER, "Surprise me")}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 hover:border-blue-400 hover:text-blue-700 disabled:opacity-50"
                >
                  <Shuffle className="h-3.5 w-3.5" /> Surprise me
                </button>
              )}
            </div>
            {(q.allowText !== false || q.options?.some(isWriteYourOwnOption)) && (
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  value={custom}
                  aria-label="Your answer"
                  maxLength={1000}
                  disabled={disabled}
                  onChange={(e) => setCustom(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && custom.trim()) {
                      e.preventDefault();
                      onAnswer(q, custom.trim());
                    }
                  }}
                  placeholder="…or type your own answer"
                  className="h-9 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none"
                />
                <Button
                  size="sm"
                  variant="outline"
                  aria-label="Send answer"
                  disabled={disabled || !custom.trim()}
                  onClick={() => custom.trim() && onAnswer(q, custom.trim())}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ResultCard({
  creative: given,
  brand,
  onStatus,
  onEdited,
}: {
  creative: Creative;
  brand: Business;
  onStatus?: (status: "draft" | "approved") => void;
  onEdited?: (creative: Creative) => void;
}) {
  const [errored, setErrored] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editNotes, setEditNotes] = useState<CopyEditNotes | null>(null);
  // Live cards aren't in turns yet, so their saved words are kept here too.
  const [savedCopy, setSavedCopy] = useState<Pick<Creative, "headline" | "primary_text" | "cta" | "generation" | "image_url"> | null>(null);
  const creative = savedCopy ? { ...given, ...savedCopy } : given;
  // The owner's unsaved words, shown in the card as they type (#387).
  const [draft, setDraft] = useState<AdText | null>(null);
  const [picturePreview, setPicturePreview] = useState<PicturePreview | null>(null);
  const saved = savedAdText(creative);
  const shown = editing && draft ? draft : saved;
  const livePicture = editing ? picturePreview : null;
  const unsaved = (editing && draft !== null && !sameAdText(draft, saved)) || livePicture !== null;
  // Live cards are not in turns yet, so they keep their own state.
  const [localApproved, setLocalApproved] = useState(creative.status === "approved");
  const approved = onStatus ? creative.status === "approved" : localApproved;
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function setApproved(value: boolean) {
    if (onStatus) onStatus(value ? "approved" : "draft");
    else setLocalApproved(value);
  }

  function toggle() {
    const next = !approved;
    setApproved(next); // optimistic
    setSaveError(null);
    startTransition(async () => {
      try {
        const res = await setCreativeStatus(creative.id, next ? "approved" : "draft");
        if (!res.ok) {
          setApproved(!next);
          setSaveError("Couldn't save — try again.");
        }
      } catch {
        setApproved(!next);
        setSaveError("Couldn't save — try again.");
      }
    });
  }

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border bg-white transition-colors",
        approved ? "border-primary ring-1 ring-primary" : "border-slate-200",
      )}
    >
      <div className="relative aspect-square bg-slate-100">
        {creative.image_url && !errored ? (
          <img
            src={creativeThumbnailUrl(creative.image_url)}
            alt={creative.headline ?? "Ad creative"}
            className="h-full w-full object-cover"
            loading="lazy"
            onError={(event) => {
              if (creative.image_url && event.currentTarget.src !== creative.image_url) event.currentTarget.src = creative.image_url;
              else setErrored(true);
            }}
          />
        ) : (
          <div className="h-full w-full animate-pulse bg-slate-200" />
        )}
        {livePicture && (
          <div className="absolute inset-0 bg-slate-100">
            <LivePicture preview={livePicture} />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        {unsaved && <UnsavedPreviewBadge />}
        <h3 className="text-sm font-semibold text-slate-900">{shown.headline}</h3>
        <p className="line-clamp-2 whitespace-pre-line text-sm text-slate-600">
          {shown.primary_text}
        </p>
        {shown.cta && <p className="text-xs text-slate-500">Button: {shown.cta}</p>}
        {editing ? (
          <div className="mt-2 border-t border-slate-100 pt-3">
            <CreativeEditor
              creative={creative}
              brand={brand}
              onDraft={setDraft}
              onPicturePreview={setPicturePreview}
              onCancel={() => setEditing(false)}
              onSaved={(next, notes) => {
                const { headline, primary_text, cta, generation, image_url } = next;
                setSavedCopy({ headline, primary_text, cta, generation, image_url });
                onEdited?.(next);
                setEditNotes(notes);
                setEditing(false);
              }}
            />
          </div>
        ) : (
        <>
        {editNotes && <CopyEditNotice notes={editNotes} />}
        <div className="mt-auto flex items-center gap-2 pt-2">
          <Button
            variant="outline"
            onClick={toggle}
            disabled={pending}
            aria-pressed={approved}
            className={cn("min-h-11 flex-1", approved && "border-primary bg-lime-wash text-slate-900 hover:bg-lime-wash")}
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : approved ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : null}
            {approved ? "Selected" : "Use this ad"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setEditNotes(null);
              setEditing(true);
            }}
            disabled={pending}
            className="min-h-11"
          >
            <Pencil className="h-4 w-4" aria-hidden="true" /> Edit
          </Button>
        </div>
        {saveError && <p className="text-xs text-red-600">{saveError}</p>}
        </>
        )}
      </div>
    </div>
  );
}
