"use client";

import { useState } from "react";
import { Loader2, RotateCcw, Send, Sparkles } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import type { Campaign } from "@/lib/types";
import { cn } from "@/lib/utils";

type QuestionType = "single" | "multi" | "text";
interface PlannerQuestion {
  id: string;
  question: string;
  help?: string;
  type: QuestionType;
  options?: string[];
  allowText?: boolean;
}
interface Answer {
  question: string;
  answer: string;
}
type Turn =
  | { role: "user"; text: string }
  | { role: "questions"; questions: PlannerQuestion[] }
  | { role: "summary"; text: string };

/** A Copilot-style guided interview that plans + creates a paused campaign. */
export function CampaignChat({
  onCreated,
}: {
  onCreated: (campaign: Campaign) => void;
}) {
  const [goal, setGoal] = useState("");
  const [started, setStarted] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [collected, setCollected] = useState<Answer[]>([]);
  const [draft, setDraft] = useState<Record<string, { picked: string[]; text: string }>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const activeQuestions =
    turns.length && turns[turns.length - 1].role === "questions" && !done
      ? (turns[turns.length - 1] as { questions: PlannerQuestion[] }).questions
      : null;
  const answerable = (activeQuestions ?? []).filter((q) => q.id !== "note");

  async function send(goalText: string, newAnswers: Answer[]) {
    setLoading(true);
    setError(null);
    const merged = [...collected, ...newAnswers];
    try {
      const res = await fetch("/api/campaigns/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: goalText, answers: merged }),
      });
      const data = (await res.json()) as {
        ready?: boolean;
        questions?: PlannerQuestion[];
        summary?: string;
        campaign?: Campaign;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Planning failed.");
        return;
      }
      setCollected(merged);
      if (data.ready === false) {
        setTurns((t) => [...t, { role: "questions", questions: data.questions ?? [] }]);
      } else if (data.ready) {
        setTurns((t) => [...t, { role: "summary", text: data.summary ?? "Campaign created." }]);
        if (data.campaign) onCreated(data.campaign);
        setDone(true);
      }
    } catch {
      setError("Planning failed — check your connection.");
    } finally {
      setLoading(false);
    }
  }

  function start() {
    const g = goal.trim();
    if (!g) return;
    setStarted(true);
    setTurns([{ role: "user", text: g }]);
    send(g, []);
  }

  function togglePick(q: PlannerQuestion, option: string) {
    setDraft((d) => {
      const cur = d[q.id] ?? { picked: [], text: "" };
      let picked: string[];
      if (q.type === "multi") {
        picked = cur.picked.includes(option)
          ? cur.picked.filter((o) => o !== option)
          : [...cur.picked, option];
      } else {
        picked = cur.picked.includes(option) ? [] : [option];
      }
      return { ...d, [q.id]: { ...cur, picked } };
    });
  }

  function setText(q: PlannerQuestion, text: string) {
    setDraft((d) => ({ ...d, [q.id]: { ...(d[q.id] ?? { picked: [] }), text } }));
  }

  function submitAnswers() {
    const answers: Answer[] = [];
    for (const q of answerable) {
      const cur = draft[q.id];
      const parts = [...(cur?.picked ?? []), (cur?.text ?? "").trim()].filter(Boolean);
      if (parts.length) answers.push({ question: q.question, answer: parts.join(", ") });
    }
    const readable =
      answers.map((a) => a.answer).join(" • ") || "(let AdBrain decide)";
    setTurns((t) => [...t, { role: "user", text: readable }]);
    setDraft({});
    send(goal.trim(), answers);
  }

  function reset() {
    setStarted(false);
    setTurns([]);
    setCollected([]);
    setDraft({});
    setDone(false);
    setError(null);
    setGoal("");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plan with AdBrain</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!started ? (
          <>
            <p className="text-sm text-slate-500">
              Tell me your goal in plain words. I&apos;ll ask a few quick questions —
              just tap the answers — then build a paused campaign for you.
            </p>
            <Textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={2}
              maxLength={1000}
              placeholder="e.g. Get more leads near Mohali, around ₹300/day, push the free consultation."
            />
            <div>
              <Button onClick={start} disabled={!goal.trim()}>
                <Sparkles className="h-4 w-4" /> Start
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-3">
            {turns.map((turn, i) => {
              if (turn.role === "user") {
                return (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-blue-600 px-3.5 py-2 text-sm text-white">
                      {turn.text}
                    </div>
                  </div>
                );
              }
              if (turn.role === "summary") {
                return (
                  <Alert key={i} variant="success">
                    {turn.text}
                  </Alert>
                );
              }
              const isActive = i === turns.length - 1 && !done;
              return (
                <div key={i} className="flex flex-col gap-3">
                  {turn.questions.map((q) => (
                    <div
                      key={q.id + q.question}
                      className="max-w-[92%] rounded-2xl rounded-bl-sm border border-slate-200 bg-slate-50 p-3.5"
                    >
                      <p className="text-sm font-medium text-slate-800">
                        {q.question}
                      </p>
                      {q.help && (
                        <p className="mt-1 text-xs text-slate-500">{q.help}</p>
                      )}
                      {isActive && q.id !== "note" && (
                        <>
                          {!!q.options?.length && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {q.options.map((opt) => {
                                const picked = draft[q.id]?.picked.includes(opt);
                                return (
                                  <button
                                    key={opt}
                                    type="button"
                                    onClick={() => togglePick(q, opt)}
                                    className={cn(
                                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                                      picked
                                        ? "border-blue-500 bg-blue-50 text-blue-700"
                                        : "border-slate-300 text-slate-600 hover:border-slate-400",
                                    )}
                                  >
                                    {opt}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          {(q.allowText || q.type === "text") && (
                            <Input
                              value={draft[q.id]?.text ?? ""}
                              onChange={(e) => setText(q, e.target.value)}
                              placeholder="Type your own…"
                              className="mt-2"
                            />
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}

            {loading && (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
              </div>
            )}
            {error && <Alert variant="error">{error}</Alert>}

            {activeQuestions && answerable.length > 0 && !loading && (
              <div className="flex items-center gap-2">
                <Button onClick={submitAnswers}>
                  <Send className="h-4 w-4" /> Send answers
                </Button>
                <span className="text-xs text-slate-400">
                  Leave blank to let AdBrain decide.
                </span>
              </div>
            )}

            {done && (
              <div>
                <Button variant="outline" onClick={reset}>
                  <RotateCcw className="h-4 w-4" /> Plan another
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
