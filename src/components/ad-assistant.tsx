"use client";
import { savedCreativeDescription } from "@/lib/creative/concept";

import { useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
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
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { useMounted } from "@/lib/use-mounted";
import type { InterviewAnswer, InterviewQuestion } from "@/lib/creative/interview";
import { creativeFollowUps, creativeRecommendations } from "@/lib/creative/recommendations";
import type { Business, Creative } from "@/lib/types";
import { cn } from "@/lib/utils";

type Question = InterviewQuestion;
type Answer = InterviewAnswer;
type PreparedBrief = { brief: string; language?: string; recommendations?: { label: string; prompt: string }[] };
type Turn =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string }
  | { role: "question"; question: Question }
  | { role: "result"; creatives: Creative[] };

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
  referenceBrief?: string;
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
      referenceBrief: typeof d.referenceBrief === "string" ? d.referenceBrief.slice(0, 2000) : undefined,
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

export function AdAssistant({ business }: { business: Business }) {
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
  const [error, setError] = useState<string | null>(null);
  // Remembers the last network action so an error can be retried in place.
  const [lastAction, setLastAction] = useState<
    { type: "step"; answers: Answer[] } | { type: "generate"; brief: string; language?: string } | null
  >(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const followConversationRef = useRef(true);
  const inFlightRef = useRef(false);
  const [generationId, setGenerationId] = useState<string | null>(null);

  // Restore after mount (never during SSR) so server and client markup agree.
  const mounted = useMounted();
  const [restored, setRestored] = useState(false);
  if (mounted && !restored) {
    setRestored(true);
    const saved = readDraft(business.id);
    if (saved) {
      setGoal(saved.goal);
      setStarted(saved.started);
      setTurns(saved.turns);
      setAnswers(saved.answers);
      setPhase(saved.phase);
      setPrepared(saved.prepared);
      setRecentGoals(saved.recentGoals ?? []);
      setReferenceBrief(saved.referenceBrief);
      setGenerationId(saved.generationId ?? null);
      if (saved.generationId && saved.phase !== "done" && saved.prepared) {
        setPhase("chat");
        setLastAction({ type: "generate", ...saved.prepared });
        setError("An earlier generation may still be processing. Check for saved results before starting another.");
      } else if (saved.started && saved.phase === "chat" && saved.turns.at(-1)?.role === "user") {
        setLastAction({ type: "step", answers: saved.answers });
        setError("The last assistant response was interrupted. Retry to continue your brief.");
      }
    }
  }

  useEffect(() => {
    if (!restored) return;
    if (!goal && !started && turns.length === 0 && !recentGoals.length) {
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
      referenceBrief,
    });
  }, [restored, business.id, goal, started, turns, answers, phase, prepared, recentGoals, referenceBrief, generationId]);

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node || !followConversationRef.current) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "instant" });
  }, [turns, loading]);

  const lastTurn = turns[turns.length - 1];
  const activeQuestion =
    phase === "chat" && !loading && lastTurn?.role === "question"
      ? lastTurn.question
      : null;

  async function step(nextAnswers: Answer[]) {
    if (loading || inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    setError(null);
    setLastAction({ type: "step", answers: nextAnswers });
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
        setPhase("review");
        setLastAction(null);
      } else if (data.question) {
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
  }

  async function generate(brief: string, language?: string) {
    if (inFlightRef.current) return;
    const ownsLock = !inFlightRef.current;
    if (ownsLock) inFlightRef.current = true;
    setPhase("generating");
    setError(null);
    setLastAction({ type: "generate", brief, language });
    if (generationId) {
      try {
        const recovered = await recoverPersistedGeneration(generationId);
        if (!recovered) {
          setError("No saved ads found yet. Check again shortly or open Creative Studio. No new generation was started.");
          setPhase("chat");
        }
      } finally {
        if (ownsLock) inFlightRef.current = false;
      }
      return;
    }
    const newGenerationId = crypto.randomUUID();
    setGenerationId(newGenerationId);
    writeDraft(business.id, { goal, started, turns, answers, phase: "chat", prepared: { ...prepared, brief, language }, recentGoals, generationId: newGenerationId, referenceBrief });
    setTurns((t) => [
      ...t,
      { role: "assistant", text: "Creating your campaign images and copy. This can take a few minutes. Keep this page open; nothing will be published." },
    ]);
    try {
      const res = await fetch("/api/creatives/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: business.id, brief, count: 3, language, generationId: newGenerationId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        creatives?: Creative[];
        error?: string;
      };
      if (!res.ok) {
        if (res.status >= 500 || res.status === 408) {
          const recovered = await recoverPersistedGeneration(newGenerationId);
          if (recovered) return;
          setError("The generation result is not confirmed. Check again shortly or open Creative Studio. No new generation was started.");
          setPhase("chat");
          return;
        }
        setGenerationId(null);
        setError(
          data.error ??
            `Couldn't create the ad (server returned ${res.status}). Please try again.`,
        );
        setPhase("chat");
        return;
      }
      if (!data.creatives?.length) {
        const recovered = await recoverPersistedGeneration(newGenerationId);
        if (recovered) return;
        setError("The generation completed without returning saved creatives. Open Creative Studio to check the result.");
        setPhase("chat");
        return;
      }
      setTurns((t) => [...t, { role: "result", creatives: data.creatives! }]);
      setPhase("done");
    } catch {
      const recovered = await recoverPersistedGeneration(newGenerationId);
      if (!recovered) {
        setError("Generation is still processing or the server stopped responding. Open Creative Studio shortly; do not retry yet, because completed image work may already be saved.");
        setPhase("chat");
      }
    } finally {
      if (ownsLock) inFlightRef.current = false;
    }
  }

  async function recoverPersistedGeneration(generationId: string): Promise<boolean> {
    for (let attempt = 0; attempt < 15; attempt += 1) {
      try {
        const res = await fetch(
          `/api/creatives/generate?businessId=${encodeURIComponent(business.id)}&generationId=${encodeURIComponent(generationId)}&expectedCount=3`,
          { cache: "no-store" },
        );
        if (res.ok) {
          const data = (await res.json()) as {
            status?: "processing" | "partial" | "complete";
            creatives?: Creative[];
          };
          if (data.creatives?.length) {
            setTurns((t) => [...t, { role: "result", creatives: data.creatives! }]);
            setPhase("done");
            if (data.status === "partial") {
              setError("Some ads finished while the request was reconnecting. Review the saved work in Creative Studio; no duplicate generation was started.");
            }
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

  function retry() {
    if (!lastAction || loading) return;
    if (lastAction.type === "step") step(lastAction.answers);
    else generate(lastAction.brief, lastAction.language);
  }

  function answer(q: Question, text: string, displayText?: string) {
    if (loading) return;
    const next = [...answers, { question: q.question, answer: text, questionId: q.id, field: q.field, options: q.options }];
    setAnswers(next);
    setCustom("");
    setTurns((t) => [...t, { role: "user", text: displayText ?? text }]);
    step(next);
  }

  function start() {
    if (loading) return;
    const g = goal.trim();
    if (!g) return;
    followConversationRef.current = true;
    setStarted(true);
    setError(null);
    setTurns([{ role: "user", text: g }]);
    step([]);
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
  }

  if (!started) {
    const suggestions = creativeRecommendations(business, goal, recentGoals);
    return (
      <section aria-label="Campaign brief" className="min-w-0">
        <div>
          <div className="flex flex-col gap-6">
            <div>
              <p className="flex items-center gap-2 text-xs font-medium text-slate-500">
                <Wand2 className="h-4 w-4 text-blue-600" aria-hidden="true" />
                Grounded in {business.name}
              </p>
              <h2 className="mt-3 text-xl font-semibold tracking-normal text-slate-950">
                What would you like to achieve?
              </h2>
            </div>
            <div className="min-w-0">
              <label htmlFor="assistant-goal" className="text-sm font-medium text-slate-800">
                Campaign goal
              </label>
              <Textarea
                id="assistant-goal"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                rows={6}
                maxLength={500}
                className="mt-3 rounded-md bg-slate-50/50 p-4 text-base leading-7 focus:bg-white"
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
                    {s.label}<ArrowRight size={15} aria-hidden="true" />
                  </button>
                ))}
              </div>
              <div className="mt-5 flex justify-end">
                <Button onClick={start} disabled={!goal.trim()}>
                  Start creating <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
          <ol aria-label="Creation stages" className="mt-8 grid grid-cols-3 border-t border-slate-200 text-xs">
            {[
              ["1", "Brief"],
              ["2", "Create"],
              ["3", "Review"],
            ].map(([number, label]) => (
              <li key={number} aria-current={number === "1" ? "step" : undefined} className="flex items-center gap-2 py-4">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-xs font-semibold text-blue-700 ring-1 ring-slate-200">
                  {number}
                </span>
                <span className="text-slate-600">{label}</span>
              </li>
            ))}
          </ol>
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
          className="scrollbar-stable flex max-h-[62vh] flex-col gap-3 overflow-y-scroll pr-1"
        >
          {turns.map((turn, i) => (
            <TurnView
              key={i}
              turn={turn}
              active={activeQuestion === (turn.role === "question" ? turn.question : null)}
              disabled={loading || phase !== "chat"}
              custom={custom}
              setCustom={setCustom}
              onAnswer={answer}
            />
          ))}

          {(loading || phase === "generating") && (
            <div role="status" className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> {phase === "generating" ? "Creating images and copy…" : "Preparing your brief…"}
            </div>
          )}
        </div>

        {phase === "review" && prepared && (
          <section aria-label="Review creative brief" className="min-w-0 border-t border-slate-200 pt-4">
            <label htmlFor="prepared-brief" className="text-sm font-semibold text-slate-900">Creative brief</label>
            <Textarea id="prepared-brief" value={prepared.brief} onChange={(event) => setPrepared({ ...prepared, brief: event.target.value, recommendations: undefined })} maxLength={2000} rows={7} className="mt-3 w-full" />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <Button variant="outline" onClick={() => reset(goal, prepared.brief)} disabled={loading}><Pencil className="h-4 w-4" /> Revise goal</Button>
              <Button onClick={() => generate(prepared.brief.trim(), prepared.language)} disabled={loading || !prepared.brief.trim()}><Sparkles className="h-4 w-4" /> Generate 3 ads</Button>
            </div>
          </section>
        )}

        {error && (
          <Alert variant="error">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{error}</span>
              {lastAction && (
                <Button size="sm" variant="outline" onClick={retry} disabled={loading}>
                  <RotateCcw className="h-4 w-4" /> {generationId ? "Check saved results" : "Try again"}
                </Button>
              )}
            </div>
          </Alert>
        )}

        {phase === "done" && (
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
            <Link href="/studio">
              <Button>
                Open in Creative Studio <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Button variant="outline" onClick={() => reset()}>
              <RotateCcw className="h-4 w-4" /> Make another
            </Button>
          </div>
        )}
        {phase === "done" && (
          <div aria-label="Next creative directions" className="flex flex-col divide-y divide-slate-100 border-t border-slate-200">
            {(prepared?.recommendations?.length ? prepared.recommendations : creativeFollowUps()).map((suggestion) => <button key={suggestion.label} type="button" onClick={() => reset(suggestion.prompt, prepared?.brief ?? goal)} className="flex min-h-12 items-center justify-between gap-3 break-words py-3 text-left text-sm text-slate-700 hover:text-blue-700">{suggestion.label}<ArrowRight size={15} aria-hidden="true" /></button>)}
          </div>
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
}: {
  turn: Turn;
  active: boolean;
  disabled: boolean;
  custom: string;
  setCustom: (v: string) => void;
  onAnswer: (q: Question, text: string, displayText?: string) => void;
}) {
  if (turn.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-blue-600 px-3.5 py-2 text-sm text-white">
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
        <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
          <Sparkles className="h-4 w-4 text-blue-600" /> Your ad is ready — pick your favourite:
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {turn.creatives.map((c) => (
            <ResultCard key={c.id} creative={c} />
          ))}
        </div>
        <p className="text-xs text-slate-500">
          Tap <span className="font-medium">Use this ad</span> on the ones you like — that
          approves them for launch. Use <span className="font-medium">Edit</span> to tweak or
          regenerate in the Creative Studio.
        </p>
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
                    onClick={() => onAnswer(q, opt)}
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
            {q.allowText !== false && (
              <div className="flex items-center gap-2">
                <input
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
                  className="h-9 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500"
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

function ResultCard({ creative }: { creative: Creative }) {
  const [errored, setErrored] = useState(false);
  const [approved, setApproved] = useState(creative.status === "approved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !approved;
    setApproved(next); // optimistic
    setSaveError(null);
    startTransition(async () => {
      const res = await setCreativeStatus(creative.id, next ? "approved" : "draft");
      if (!res.ok) {
        setApproved(!next);
        setSaveError("Couldn't save — try again.");
      }
    });
  }

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border bg-white transition-colors",
        approved ? "border-blue-500 ring-1 ring-blue-500" : "border-slate-200",
      )}
    >
      <div className="relative aspect-square bg-slate-100">
        {creative.image_url && !errored ? (
          <img
            src={creative.image_url}
            alt={creative.headline ?? "Ad creative"}
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => setErrored(true)}
          />
        ) : (
          <div className="h-full w-full animate-pulse bg-slate-200" />
        )}
        {creative.angle && (
          <Badge className="absolute left-2 top-2 bg-black/60 text-white backdrop-blur">
            {creative.angle}
          </Badge>
        )}
        {approved && (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-blue-600 px-2 py-0.5 text-[11px] font-medium text-white">
            <CheckCircle2 className="h-3.5 w-3.5" /> Selected
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <h3 className="text-sm font-semibold text-slate-900">{creative.headline}</h3>
        <p className="line-clamp-4 whitespace-pre-line text-xs text-slate-600">
          {creative.primary_text}
        </p>
        {savedCreativeDescription(creative.generation) && (
          <p className="break-words text-xs text-slate-600">
            <span className="font-medium">Description: </span>{savedCreativeDescription(creative.generation)}
          </p>
        )}
        {creative.cta && (
          <span className="mt-1 inline-flex w-fit rounded-md bg-slate-900 px-2 py-0.5 text-[11px] font-medium text-white">
            {creative.cta}
          </span>
        )}
        <div className="mt-auto flex items-center gap-2 pt-2">
          <Button
            size="sm"
            variant={approved ? "outline" : "primary"}
            onClick={toggle}
            disabled={pending}
            className="flex-1"
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : approved ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : null}
            {approved ? "Selected" : "Use this ad"}
          </Button>
          <Link
            href="/studio"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:border-blue-400 hover:text-blue-700"
          >
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Link>
        </div>
        {saveError && <p className="text-xs text-red-600">{saveError}</p>}
      </div>
    </div>
  );
}
