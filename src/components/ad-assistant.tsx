"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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
import { Badge, Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { seasonalSuggestions } from "@/lib/seasonal";
import { useMounted } from "@/lib/use-mounted";
import type { Business, Creative } from "@/lib/types";
import { cn } from "@/lib/utils";

/** A single interview question (mirrors the server's InterviewQuestion). */
interface Question {
  id: string;
  question: string;
  help?: string;
  options?: string[];
  allowText?: boolean;
  allowRandom?: boolean;
  aiCanDecide?: boolean;
}
interface Answer {
  question: string;
  answer: string;
}
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
  phase: "chat" | "done";
}

const draftKey = (businessId: string) => `adbrain:assistant:${businessId}`;

function getBriefPreview(goal: string) {
  const input = goal.trim().toLowerCase();

  const audienceLabels = [
    { label: "Local families", match: /local families|families|parents|family|community|neighborhood|nearby/ },
    { label: "New patients", match: /new patient|new patients|new customers|first-time|new client/ },
    { label: "High-intent buyers", match: /buyers|shoppers|customers|prospects|service seekers|local shoppers/ },
    { label: "Business owners", match: /business owners|owners|teams|companies|brands/ },
  ];

  const offerLabels = [
    { label: "Spring checkup", match: /spring checkup|spring|seasonal|special offer|limited time/ },
    { label: "Weekend offer", match: /weekend|weekends|weeknight|sale|promotion/ },
    { label: "Free consult", match: /free consult|free quote|free estimate|trial|demo/ },
    { label: "Limited-time conversion", match: /offer|discount|launch|conversion|appointment|book now/ },
  ];

  const audience = audienceLabels.find((entry) => entry.match.test(input))?.label ?? "Local audience";
  const offer = offerLabels.find((entry) => entry.match.test(input))?.label ?? "Offer-focused campaign";

  return { audience, offer };
}

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
      phase: d.phase === "done" ? "done" : "chat",
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
  const [phase, setPhase] = useState<"chat" | "generating" | "done">("chat");
  const [error, setError] = useState<string | null>(null);
  // Remembers the last network action so an error can be retried in place.
  const [lastAction, setLastAction] = useState<
    { type: "step"; answers: Answer[] } | { type: "generate"; brief: string; language?: string } | null
  >(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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
    }
  }

  useEffect(() => {
    if (!restored) return;
    if (!goal && !started && turns.length === 0) {
      clearDraft(business.id);
      return;
    }
    writeDraft(business.id, {
      goal,
      started,
      turns,
      answers,
      phase: phase === "done" ? "done" : "chat",
    });
  }, [restored, business.id, goal, started, turns, answers, phase]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, loading]);

  const lastTurn = turns[turns.length - 1];
  const activeQuestion =
    phase === "chat" && !loading && lastTurn?.role === "question"
      ? lastTurn.question
      : null;

  async function step(nextAnswers: Answer[]) {
    if (loading) return;
    setLoading(true);
    setError(null);
    setLastAction({ type: "step", answers: nextAnswers });
    try {
      const res = await fetch("/api/creatives/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: business.id, goal: goal.trim(), answers: nextAnswers }),
      });
      const data = (await res.json()) as {
        ready?: boolean;
        question?: Question;
        brief?: string;
        language?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "The assistant had trouble. Please try again.");
        return;
      }
      if (data.ready && data.brief) {
        await generate(data.brief, data.language);
      } else if (data.question) {
        setTurns((t) => [...t, { role: "question", question: data.question! }]);
      } else {
        setError("The assistant had trouble. Please try again.");
      }
    } catch {
      setError("Couldn't reach the assistant — check your connection.");
    } finally {
      setLoading(false);
    }
  }

  async function generate(brief: string, language?: string) {
    setPhase("generating");
    setError(null);
    setLastAction({ type: "generate", brief, language });
    setTurns((t) => [
      ...t,
      { role: "assistant", text: "Perfect — creating your ad now. This takes a few seconds…" },
    ]);
    try {
      const res = await fetch("/api/creatives/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: business.id, brief, count: 3, language }),
      });
      const data = (await res.json()) as { creatives?: Creative[]; error?: string };
      if (!res.ok || !data.creatives?.length) {
        setError(data.error ?? "Couldn't create the ad. Please try again.");
        setPhase("chat");
        return;
      }
      setTurns((t) => [...t, { role: "result", creatives: data.creatives! }]);
      setPhase("done");
    } catch {
      setError("Couldn't create the ad — check your connection.");
      setPhase("chat");
    }
  }

  function retry() {
    if (!lastAction || loading) return;
    if (lastAction.type === "step") step(lastAction.answers);
    else generate(lastAction.brief, lastAction.language);
  }

  function answer(q: Question, text: string, displayText?: string) {
    if (loading) return;
    const next = [...answers, { question: q.question, answer: text }];
    setAnswers(next);
    setCustom("");
    setTurns((t) => [...t, { role: "user", text: displayText ?? text }]);
    step(next);
  }

  function start() {
    if (loading) return;
    const g = goal.trim();
    if (!g) return;
    setStarted(true);
    setError(null);
    setTurns([{ role: "user", text: g }]);
    step([]);
  }

  function reset() {
    clearDraft(business.id);
    setStarted(false);
    setTurns([]);
    setAnswers([]);
    setCustom("");
    setPhase("chat");
    setError(null);
    setLastAction(null);
    setGoal("");
  }

  if (!started) {
    const suggestions = seasonalSuggestions();
    return (
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[0.7fr_1.3fr] lg:gap-8">
            <div>
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
                <Wand2 className="h-5 w-5" />
              </span>
              <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-blue-700">
                Grounded in {business.name}
              </p>
              <h2 className="mt-1 text-xl font-semibold tracking-[-0.02em] text-slate-950">
                Start with the outcome
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Describe what you want this ad to achieve. AdBrain already has
                your brand context and will ask only what is still missing.
              </p>
            </div>
            <div className="min-w-0">
              <label htmlFor="assistant-goal" className="text-sm font-medium text-slate-800">
                Campaign goal
              </label>
              <p className="mt-1 text-xs text-slate-500">
                Include an offer, audience, location, or occasion if it matters.
              </p>
              <Textarea
                id="assistant-goal"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                rows={4}
                maxLength={500}
                className="mt-3"
                placeholder={`e.g. ${suggestions[0]?.prompt ?? "A weekend offer for my business"}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    start();
                  }
                }}
              />
              <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/60 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700">
                  Brief preview
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {getBriefPreview(goal).audience && (
                    <span className="rounded-full border border-blue-200 bg-white px-2.5 py-1 text-xs font-medium text-blue-700">
                      {getBriefPreview(goal).audience}
                    </span>
                  )}
                  {getBriefPreview(goal).offer && (
                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700">
                      {getBriefPreview(goal).offer}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-xs text-slate-600">
                  AdBrain will lean into {getBriefPreview(goal).audience.toLowerCase()} and {getBriefPreview(goal).offer.toLowerCase()} when it builds the first ad brief.
                </p>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => setGoal(s.prompt)}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 hover:border-blue-300 hover:text-blue-700"
                  >
                    {s.label}
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
          <ol className="grid border-t border-slate-200 bg-slate-50/70 text-sm sm:grid-cols-3">
            {[
              ["1", "Describe the goal"],
              ["2", "Answer what matters"],
              ["3", "Review three ads"],
            ].map(([number, label]) => (
              <li key={number} className="flex items-center gap-2 px-5 py-3 sm:border-r sm:border-slate-200 sm:last:border-r-0">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-xs font-semibold text-blue-700 ring-1 ring-slate-200">
                  {number}
                </span>
                <span className="text-slate-600">{label}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4 sm:p-6">
        <div ref={scrollRef} className="flex max-h-[62vh] flex-col gap-3 overflow-y-auto pr-1">
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

          {loading && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
            </div>
          )}
        </div>

        {error && (
          <Alert variant="error">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{error}</span>
              {lastAction && (
                <Button size="sm" variant="outline" onClick={retry} disabled={loading}>
                  <RotateCcw className="h-4 w-4" /> Try again
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
            <Button variant="outline" onClick={reset}>
              <RotateCcw className="h-4 w-4" /> Make another
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
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
      <div className="max-w-[92%] rounded-2xl rounded-bl-sm border border-slate-200 bg-slate-50 p-3.5">
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
                  disabled={disabled}
                  onChange={(e) => setCustom(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && custom.trim()) {
                      e.preventDefault();
                      onAnswer(q, custom.trim());
                    }
                  }}
                  placeholder="…or type your own answer"
                  className="h-9 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500"
                />
                <Button
                  size="sm"
                  variant="outline"
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
