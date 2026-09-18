import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildPlannerMessages, formatAnswers, runPlanner } from "@/lib/campaign/planner";
import { complete } from "@/lib/llm";

vi.mock("@/lib/llm", () => ({ complete: vi.fn(), parseJSON: JSON.parse }));
beforeEach(() => vi.clearAllMocks());

describe("planner response validation", () => {
  const input = { brand: { name: "Business" }, approved: [], leadForms: [], goal: "Local enquiries" };
  const question = { id: "area", type: "text", question: "Which service area?" };
  it.each([
    { ready: false, questions: [] },
    { ready: false, questions: [{ ...question, type: "single" }] },
    { ready: false, questions: [{ ...question, options: ["Jaipur", "jaipur"] }] },
    { ready: false, questions: [question, question] },
    { ready: true, plan: {} },
  ])("rejects an incomplete/unusable response and records its usage: %j", async (value) => {
    vi.mocked(complete).mockResolvedValue({ text: JSON.stringify(value), provider: "test", model: "test" });
    const onCompletion = vi.fn();
    await expect(runPlanner(input, { onCompletion })).rejects.toThrow("invalid or repeated");
    expect(onCompletion).toHaveBeenCalledWith(expect.any(Object), false);
  });
  it("rejects a question that already has an answer", async () => {
    vi.mocked(complete).mockResolvedValue({ text: JSON.stringify({ ready: false, questions: [question] }), provider: "test", model: "test" });
    await expect(runPlanner({ ...input, answers: "Q: Which service area?\nA: Jaipur" })).rejects.toThrow("invalid or repeated");
  });
  it("accepts an answerable question and propagates bounded cancellation", async () => {
    vi.mocked(complete).mockResolvedValue({ text: JSON.stringify({ ready: false, questions: [question] }), provider: "test", model: "test" });
    const onCompletion = vi.fn();
    expect(await runPlanner(input, { onCompletion })).toEqual({ ready: false, questions: [question] });
    expect(complete).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ json: true, cache: false, signal: expect.any(AbortSignal) }));
    expect(onCompletion).toHaveBeenCalledWith(expect.any(Object), true);
  });
  it("does not start a cancelled planner", async () => {
    await expect(runPlanner(input, { signal: AbortSignal.abort() })).rejects.toThrow();
    expect(complete).not.toHaveBeenCalled();
  });
});

describe("campaign planner prompt", () => {
  it("includes creative ids, lead form ids, goal, and the no-invent rule", () => {
    const msgs = buildPlannerMessages({
      brand: { name: "Solaride", locations: ["Hisar"] },
      approved: [{ id: "cre_1", angle: "savings", headline: "Save big" }],
      leadForms: [{ id: "form_1", name: "Hisar Form" }],
      goal: "Get leads in Hisar",
    });
    const user = msgs[1].content;
    expect(user).toContain("cre_1");
    expect(user).toContain("form_1");
    expect(user).toContain("Get leads in Hisar");
    expect(msgs[0].content).toMatch(/never invent/i);
  });

  it("includes the user's answers when provided", () => {
    const msgs = buildPlannerMessages({
      brand: { name: "Solaride" },
      approved: [{ id: "c", angle: null, headline: null }],
      leadForms: [{ id: "f", name: "F" }],
      goal: "g",
      answers: "budget is 500",
    });
    expect(msgs[1].content).toContain("budget is 500");
  });

  it("asks for structured questions with options and an exclude field", () => {
    const msgs = buildPlannerMessages({
      brand: { name: "Solaride" },
      approved: [{ id: "c", angle: null, headline: null }],
      leadForms: [{ id: "f", name: "F" }],
      goal: "g",
    });
    const sys = msgs[0].content;
    const user = msgs[1].content;
    expect(sys).toMatch(/exclude/i);
    expect(sys).toMatch(/options/i);
    expect(user).toContain("excluded_locations");
    expect(user).toContain('"type": "single"|"multi"|"text"');
  });
});

describe("formatAnswers", () => {
  it("formats answered questions into a Q/A transcript", () => {
    const out = formatAnswers([
      { question: "Budget?", answer: "₹300/day" },
      { question: "Exclude?", answer: "Zirakpur, Kharar" },
    ]);
    expect(out).toBe("Q: Budget?\nA: ₹300/day\n\nQ: Exclude?\nA: Zirakpur, Kharar");
  });

  it("skips questions with empty answers", () => {
    const out = formatAnswers([
      { question: "A?", answer: "" },
      { question: "B?", answer: "yes" },
    ]);
    expect(out).toBe("Q: B?\nA: yes");
  });
});
