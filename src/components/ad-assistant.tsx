"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Loader2,
  RotateCcw,
  Send,
  Shuffle,
  Sparkles,
  Wand2,
} from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import type { Business, Creative } from "@/lib/types";

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

export function AdAssistant({ business }: { business: Business }) {
  const [goal, setGoal] = useState("");
  const [started, setStarted] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [custom, setCustom] = useState("");
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<"chat" | "generating" | "done">("chat");
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, loading]);

  const lastTurn = turns[turns.length - 1];
  const activeQuestion =
    phase === "chat" && !loading && lastTurn?.role === "question"
      ? lastTurn.question
      : null;

  async function step(nextAnswers: Answer[]) {
    setLoading(true);
    setError(null);
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

  function answer(q: Question, text: string, displayText?: string) {
    const next = [...answers, { question: q.question, answer: text }];
    setAnswers(next);
    setCustom("");
    setTurns((t) => [...t, { role: "user", text: displayText ?? text }]);
    step(next);
  }

  function start() {
    const g = goal.trim();
    if (!g) return;
    setStarted(true);
    setError(null);
    setTurns([{ role: "user", text: g }]);
    step([]);
  }

  function reset() {
    setStarted(false);
    setTurns([]);
    setAnswers([]);
    setCustom("");
    setPhase("chat");
    setError(null);
    setGoal("");
  }

  if (!started) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-5 p-8 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
            <Wand2 className="h-7 w-7" />
          </span>
          <div>
            <h2 className="text-xl font-bold text-slate-900">Make an ad in a few taps</h2>
            <p className="mt-1 max-w-md text-slate-600">
              Just tell me what you want — I&apos;ll ask a couple of easy questions
              and hand you a finished ad.
            </p>
          </div>
          <div className="w-full max-w-lg">
            <Textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="e.g. A Diwali ad for my business"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  start();
                }
              }}
            />
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {["A Diwali ad for my business", "Weekend discount offer", "New customer offer"].map(
                (s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setGoal(s)}
                    className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 hover:border-blue-300 hover:text-blue-700"
                  >
                    {s}
                  </button>
                ),
              )}
            </div>
            <Button onClick={start} disabled={!goal.trim()} className="mt-4">
              <Sparkles className="h-4 w-4" /> Start
            </Button>
          </div>
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

        {error && <Alert variant="error">{error}</Alert>}

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
          All three are saved as drafts. Open the Creative Studio to approve, tweak, or launch them.
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
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
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
      </div>
      <div className="flex flex-col gap-1.5 p-3">
        <h3 className="text-sm font-semibold text-slate-900">{creative.headline}</h3>
        <p className="line-clamp-4 whitespace-pre-line text-xs text-slate-600">
          {creative.primary_text}
        </p>
        {creative.cta && (
          <span className="mt-1 inline-flex w-fit rounded-md bg-slate-900 px-2 py-0.5 text-[11px] font-medium text-white">
            {creative.cta}
          </span>
        )}
      </div>
    </div>
  );
}
