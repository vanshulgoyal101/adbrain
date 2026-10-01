import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildPlannerMessages, formatAnswers, runPlanner } from "@/lib/campaign/planner";
import { complete } from "@/lib/llm";
import { LLMError } from "@/lib/llm/types";
import { plannerPlanToDraftInput } from "@/lib/campaign/planner-draft";

vi.mock("@/lib/llm", () => ({ complete: vi.fn(), parseJSON: JSON.parse }));
beforeEach(() => vi.clearAllMocks());

describe("planner response validation", () => {
  const input = { brand: { name: "Business" }, approved: [], leadForms: [], goal: "Local enquiries" };
  const question = { id: "location", topic: "location", type: "text", question: "Which service area?" };
  it("records known terminal failure usage once without another completion", async () => {
    const usage = { promptTokens: 8, completionTokens: 2, totalTokens: 17 };
    const failure = new LLMError("Output token budget exhausted", { provider: "google", model: "gemini-3.6-flash", usage, retryable: false });
    vi.mocked(complete).mockRejectedValue(failure);
    const onCompletion = vi.fn();
    await expect(runPlanner(input, { onCompletion })).rejects.toBe(failure);
    expect(onCompletion).toHaveBeenCalledExactlyOnceWith({ text: "", provider: "google", model: "gemini-3.6-flash", usage }, false, 1);
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it.each([
    { ready: false, questions: [] },
    { ready: false, questions: [{ ...question, type: "single" }] },
    { ready: false, questions: [{ ...question, options: ["Jaipur", "jaipur"] }] },
    { ready: true, plan: {} },
  ])("rejects an incomplete/unusable response and records its usage: %j", async (value) => {
    vi.mocked(complete).mockResolvedValue({ text: JSON.stringify(value), provider: "test", model: "test" });
    const onCompletion = vi.fn();
    expect(await runPlanner(input, { onCompletion })).toMatchObject({ ready: false, handoff: { reason: "no_progress" } });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(onCompletion).toHaveBeenCalledWith(expect.any(Object), false, 1);
    expect(onCompletion).toHaveBeenCalledWith(expect.any(Object), false, 2);
  });
  it("rejects a question that already has an answer", async () => {
    vi.mocked(complete).mockResolvedValue({ text: JSON.stringify({ ready: false, questions: [question] }), provider: "test", model: "test" });
    expect(await runPlanner({ ...input, answers: "Q: Which service area?\nA: Jaipur" })).toMatchObject({ handoff: { reason: "no_progress" } });
  });
  it("accepts an answerable question and propagates bounded cancellation", async () => {
    vi.mocked(complete).mockResolvedValue({ text: JSON.stringify({ ready: false, questions: [question] }), provider: "test", model: "test" });
    const onCompletion = vi.fn();
    expect(await runPlanner(input, { onCompletion })).toEqual({ ready: false, questions: [question] });
    expect(complete).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ json: true, cache: false, signal: expect.any(AbortSignal), maxTokens: 3000 }));
    expect(onCompletion).toHaveBeenCalledWith(expect.any(Object), true, 1);
  });
  it("deduplicates reworded answered topics and keeps one new blocking question", async () => {
    const budget = { id: "daily", topic: "budget", question: "Daily budget?", type: "text" };
    vi.mocked(complete).mockResolvedValue({ text: JSON.stringify({ ready: false, questions: [
      { ...question, question: "Where should we advertise?" }, budget, { ...budget, id: "spend", question: "How much each day?" },
    ] }), provider: "test", model: "test" });
    expect(await runPlanner({ ...input, answerHistory: [{ questionId: "area", topic: "location", question: "Which city?", answer: "Hisar" }] }))
      .toEqual({ ready: false, questions: [{ ...budget, id: "budget" }] });
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it("corrects a repeated question once and records usage for both attempts", async () => {
    const budget = { id: "budget", topic: "budget", question: "Daily budget?", type: "text" };
    vi.mocked(complete).mockResolvedValueOnce({ text: JSON.stringify({ ready: false, questions: [question] }), provider: "test", model: "test" })
      .mockResolvedValueOnce({ text: JSON.stringify({ ready: false, questions: [budget] }), provider: "test", model: "test" });
    const onCompletion = vi.fn();
    expect(await runPlanner({ ...input, brand: { name: "Business", locations: ["Hisar"] } }, { onCompletion })).toMatchObject({ questions: [budget] });
    expect(onCompletion.mock.calls.map(call => call.slice(1))).toEqual([[false, 1], [true, 2]]);
    expect(vi.mocked(complete).mock.calls[1][0].at(-1)?.content).toContain("final correction attempt");
  });
  it("hands off a deferred budget without another model call or invented spending", async () => {
    expect(await runPlanner({ ...input, answerHistory: [{ questionId: "budget", topic: "budget", question: "Daily budget?", answer: "", disposition: "deferred" }] }))
      .toMatchObject({ ready: false, handoff: { reason: "no_progress" } });
    expect(complete).not.toHaveBeenCalled();
  });
  it("allows a final draft attempt but no more questions after six decisions", async () => {
    vi.mocked(complete).mockResolvedValue({ text: JSON.stringify({ ready: false, questions: [question] }), provider: "test", model: "test" });
    expect(await runPlanner({ ...input, answerHistory: Array.from({ length: 6 }, (_, index) => ({ question: `Previous ${index}`, answer: "Provided" })) }))
      .toMatchObject({ handoff: { reason: "interview_limit" } });
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it("still accepts a valid ready draft after six decisions without restarting the interview", async () => {
    const plan = { name: "Hisar solar enquiries", daily_budget_rupees: 300, lead_form_id: null,
      creative_ids: ["22222222-2222-4222-8222-222222222222"], age_min: 25, age_max: 65,
      city_scope: "radius", radius_km: 20, locations: ["Hisar"], excluded_locations: [], interests: ["Solar energy"],
      destination: "whatsapp", special_ad_category: "none", rationale: "Owner-selected Hisar and 20 km coverage." };
    vi.mocked(complete).mockResolvedValue({ text: JSON.stringify({ ready: true, plan }), provider: "test", model: "test" });
    expect(await runPlanner({ ...input, destination: "whatsapp", goal: "Hisar within 20 km, 300 rupees per day",
      answerHistory: Array.from({ length: 6 }, (_, index) => ({ question: `Decision ${index}`, answer: "Provided" })) }))
      .toEqual({ ready: true, plan });
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it("cancels before a correction rather than starting another paid call", async () => {
    const controller = new AbortController();
    vi.mocked(complete).mockResolvedValue({ text: "{}", provider: "test", model: "test" });
    await expect(runPlanner(input, { signal: controller.signal, onCompletion: async () => controller.abort() })).rejects.toThrow();
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it("returns at most two useful questions with stable topic IDs", async () => {
    vi.mocked(complete).mockResolvedValue({ text: JSON.stringify({ ready: false, questions: [question,
      { id: "daily-spend", topic: "budget", question: "What daily budget?", type: "text" },
      { id: "product", topic: "offer", question: "What are you advertising?", type: "text" },
    ] }), provider: "test", model: "test" });
    expect((await runPlanner(input)).questions?.map(item => item.id)).toEqual(["location", "budget"]);
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it("does not start a cancelled planner", async () => {
    await expect(runPlanner(input, { signal: AbortSignal.abort() })).rejects.toThrow();
    expect(complete).not.toHaveBeenCalled();
  });
});

describe("campaign planner prompt", () => {
  it("keeps current geography and spend above advisory memory without repeating example taglines", () => {
    const messages = buildPlannerMessages({ brand: { name: "Solaride", locations: ["Hisar"] }, approved: [], leadForms: [],
      goal: "Chandigarh, not Hisar; ask before choosing a budget", preferences: "PAST DECLARED PREFERENCES: workflow: \"Usually review drafts\"",
      instructions: "Example tagline: Shine ahead. Must include a current legal notice." });
    expect(messages[0].content).toContain("latest explicit answers first, then USER GOAL");
    expect(messages[1].content).toContain("USER GOAL: Chandigarh, not Hisar");
    expect(messages[1].content).toContain("plain examples or old taglines are reference only");
    expect(messages[1].content).toContain("respect explicit must-include and legal requirements");
  });
  it("preserves WhatsApp and needs no lead form for a guided draft", () => {
    const messages = buildPlannerMessages({ destination: "whatsapp", brand: { name: "Solaride" }, approved: [], leadForms: [], goal: "WhatsApp enquiries" });
    expect(messages[0].content).toContain("selected destination: whatsapp");
    expect(messages[0].content).toContain("detailed targeting in every plan");
    const creativeId = "22222222-2222-4222-8222-222222222222";
    expect(plannerPlanToDraftInput({ businessId: "11111111-1111-4111-8111-111111111111", goal: "WhatsApp enquiries", approvedCreativeIds: [creativeId], leadFormIds: [], plan: {
      name: "WhatsApp", daily_budget_rupees: 200, lead_form_id: null, creative_ids: [creativeId], age_min: 25, age_max: 65,
      special_ad_category: "none", locations: ["Jaipur"], excluded_locations: [], interests: ["Solar energy"], destination: "whatsapp", rationale: "Test local enquiries",
    } })).toMatchObject({ ok: true, draft: { destination: "whatsapp", leadFormId: null } });
  });

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
