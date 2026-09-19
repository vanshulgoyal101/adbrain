"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
import type { DraftDTO } from "@/lib/campaign/connect-contracts";
import { useSessionDraft } from "@/lib/use-session-draft";
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

/** The part of the interview worth keeping when the tab changes. */
interface ChatSession {
  goal: string;
  started: boolean;
  turns: Turn[];
  collected: Answer[];
  pending?: { goal: string; answers: Answer[] } | null;
}

function reviveSession(raw: unknown): ChatSession | null {
  const s = raw as Partial<ChatSession> | null;
  if (!s || typeof s.goal !== "string" || !Array.isArray(s.turns)) return null;
  return {
    goal: s.goal,
    started: s.started === true,
    turns: s.turns,
    collected: Array.isArray(s.collected) ? s.collected : [],
    pending: s.pending && typeof s.pending.goal === "string" && Array.isArray(s.pending.answers)
      && s.pending.answers.every((answer) => answer && typeof answer.question === "string" && typeof answer.answer === "string")
      ? s.pending : null,
  };
}

type CampaignChatProps = {
  businessId: string;
  destination?: "instant_form" | "whatsapp";
  onCreated?: (campaign: Campaign) => void;
  onDraftReady?: (draft: DraftDTO) => void;
};

export function CampaignChat(props: CampaignChatProps) {
  return <CampaignChatSession key={`${props.businessId}:${props.destination ?? "instant_form"}`} {...props} />;
}

function CampaignChatSession({ businessId, destination = "instant_form", onCreated, onDraftReady }: CampaignChatProps) {
  const sessionKey = `adbrain:campaign-chat:${businessId}${destination === "whatsapp" ? ":whatsapp" : ""}`;
  // Keeps the interview alive across tab changes; a finished one is discarded.
  const [session, setSession, clearSession] = useSessionDraft<ChatSession>(
    sessionKey,
    { goal: "", started: false, turns: [], collected: [] },
    reviveSession,
  );
  const { goal, started, turns, collected } = session;
  const setGoal = (v: string) => setSession((s) => ({ ...s, goal: v }));
  const [draft, setDraft] = useState<Record<string, { picked: string[]; text: string }>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const sessionRef = useRef(session);
  const done = turns.at(-1)?.role === "summary";

  useLayoutEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => () => requestRef.current?.abort(), []);

  const activeQuestions =
    turns.length && turns[turns.length - 1].role === "questions" && !done
      ? (turns[turns.length - 1] as { questions: PlannerQuestion[] }).questions
      : null;
  const answerable = (activeQuestions ?? []).filter((q) => q.id !== "note");

  async function send(goalText: string, answers: Answer[]) {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError(null);
    setSession((current) => ({ ...current, pending: { goal: goalText, answers } }));
    try {
      const res = await fetch("/api/campaigns/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: goalText, answers, destination }),
        signal: controller.signal,
      });
      const data = (await res.json()) as {
        ready?: boolean;
        questions?: PlannerQuestion[];
        summary?: string;
        campaign?: Campaign;
        draft?: DraftDTO;
        error?: string;
      };
      if (controller.signal.aborted) return;
      if (!res.ok) {
        setError(data.error ?? "Planning failed.");
        return;
      }
      if (data.ready !== false && !(data.ready === true && (data.draft || data.campaign))) {
        setError("Planning returned an incomplete response.");
        return;
      }
      setSession((s) => ({ ...s, collected: answers, pending: null }));
      if (data.ready === false) {
        setSession((s) => ({
          ...s,
          turns: [...s.turns, { role: "questions", questions: data.questions ?? [] }],
        }));
      } else if (data.ready) {
        const completed: ChatSession = {
          ...sessionRef.current,
          collected: answers,
          pending: null,
          turns: [...sessionRef.current.turns, { role: "summary", text: data.draft ? "Draft saved. Review the account, audience, budget, and blockers before creating the paused campaign." : data.summary ?? "Campaign created." }],
        };
        setSession(completed);
        try { sessionStorage.setItem(sessionKey, JSON.stringify(completed)); }
        catch { clearSession(); }
        if (data.draft) onDraftReady?.(data.draft);
        else if (data.campaign) onCreated?.(data.campaign);
      }
    } catch {
      if (!controller.signal.aborted) {
        setError("Planning failed — check your connection.");
      }
    } finally {
      if (!controller.signal.aborted) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }

  function start() {
    const g = goal.trim();
    if (!g) return;
    setSession((s) => ({
      ...s,
      started: true,
      turns: [{ role: "user", text: g }],
    }));
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
    setSession((s) => ({ ...s, turns: [...s.turns, { role: "user", text: readable }] }));
    setDraft({});
    send(goal.trim(), [...collected, ...answers]);
  }

  function reset() {
    clearSession();
    setSession({ goal: "", started: false, turns: [], collected: [] });
    setDraft({});
    setError(null);
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
            {session.pending && !loading && !done && (
              <div>
                <Alert variant="warning">A draft may already have been saved. Check Saved drafts before retrying.</Alert>
                <Button variant="outline" className="mt-2" onClick={() => { if (session.pending) void send(session.pending.goal, session.pending.answers); }}>
                  <RotateCcw className="h-4 w-4" /> Retry
                </Button>
              </div>
            )}

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
