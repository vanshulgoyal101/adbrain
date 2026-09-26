import { beforeEach, describe, expect, it, vi } from "vitest";
import { complete } from "@/lib/llm";
import { LLMError } from "@/lib/llm/types";
import { creativeFollowUps, creativeRecommendations } from "@/lib/creative/recommendations";
import {
  buildInterviewMessages,
  formatInterviewAnswers,
  runInterview,
  InterviewValidationError,
  type InterviewInput,
} from "@/lib/creative/interview";

vi.mock("@/lib/llm", () => ({ complete: vi.fn(), parseJSON: JSON.parse }));
beforeEach(() => vi.resetAllMocks());

const reply = (value: unknown) => ({ text: JSON.stringify(value), provider: "test", model: "test" });

const brand: InterviewInput["brand"] = {
  name: "Solaride",
  vertical: "solar energy",
  brand_voice: "friendly, trustworthy",
  usps: ["25-year warranty"],
  languages: ["English", "Hindi"],
};

describe("formatInterviewAnswers", () => {
  it("formats Q/A pairs and drops blank answers", () => {
    const out = formatInterviewAnswers([
      { question: "Occasion?", answer: "Diwali" },
      { question: "Offer?", answer: "  " },
    ]);
    expect(out).toContain("Q: Occasion?");
    expect(out).toContain("A: Diwali");
    expect(out).not.toContain("Offer?");
  });
});

describe("bounded interview harness", () => {
  const question = { id: "visual-1", field: "visual", question: "Which scene should we show?", options: ["Team at work", "Finished installation"] };

  it("records known terminal failure usage once without a repair attempt", async () => {
    const usage = { promptTokens: 8, completionTokens: 2, totalTokens: 17 };
    const failure = new LLMError("Output token budget exhausted", { provider: "google", model: "gemini-3.6-flash", usage, retryable: false });
    vi.mocked(complete).mockRejectedValue(failure);
    const onAttempt = vi.fn();
    await expect(runInterview({ brand, goal: "ad" }, { onAttempt })).rejects.toBe(failure);
    expect(onAttempt).toHaveBeenCalledExactlyOnceWith({ text: "", provider: "google", model: "gemini-3.6-flash", usage }, 1, false);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("accepts an actionable first request without compulsory questions", async () => {
    vi.mocked(complete).mockResolvedValue(reply({ ready: true, brief: "Show a solar installation with a factual enquiry CTA." }));
    await expect(runInterview({ brand, goal: "Show a solar installation and invite enquiries" })).resolves.toMatchObject({ ready: true });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(buildInterviewMessages({ brand, goal: "ad" })[0].content).toContain("ZERO to THREE");
  });

  it("repairs a rephrased answered field instead of showing repeated suggestions", async () => {
    vi.mocked(complete).mockResolvedValueOnce(reply({ ready: false, question })).mockResolvedValueOnce(reply({ ready: true, brief: "Show the team installing solar panels." }));
    await expect(runInterview({ brand, goal: "ad", answers: [{ question: "Pick an image direction", answer: "Team at work", field: "visual" }] })).resolves.toMatchObject({ ready: true });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(vi.mocked(complete).mock.calls[1][0].at(-1)?.content).toContain("repeats an answered decision");
  });

  it("rejects recycled options even with a new question field", async () => {
    vi.mocked(complete).mockResolvedValue(reply({ ready: false, question }));
    await expect(runInterview({ brand, goal: "ad", answers: [{ question: "What is the focus?", answer: "Team at work", field: "objective", options: question.options }] })).rejects.toBeInstanceOf(InterviewValidationError);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("enforces the question budget and fails closed on invalid model output", async () => {
    vi.mocked(complete).mockResolvedValue(reply({ ready: false, question }));
    await expect(runInterview({ brand, goal: "ad", answers: Array.from({ length: 3 }, () => ({ question: "Earlier", answer: "Confirmed" })) })).rejects.toBeInstanceOf(InterviewValidationError);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it.each([null, { ready: "true", brief: "ad" }, { ready: true, brief: "ad", language: "invented" }, { ready: false, question: { ...question, options: ["Team", " team!"] } }])("validates untrusted output %j", async (output) => {
    vi.mocked(complete).mockResolvedValue(reply(output));
    await expect(runInterview({ brand, goal: "ad" })).rejects.toBeInstanceOf(InterviewValidationError);
  });

  it("repairs malformed JSON and records both returned completions", async () => {
    const onAttempt = vi.fn();
    vi.mocked(complete).mockResolvedValueOnce({ text: "{broken", provider: "test", model: "test" }).mockResolvedValueOnce(reply({ ready: true, brief: "Show the installation." }));
    await expect(runInterview({ brand, goal: "ad" }, { onAttempt })).resolves.toMatchObject({ ready: true });
    expect(onAttempt.mock.calls.map((call) => call.slice(1))).toEqual([[1, false], [2, true]]);
  });

  it("rejects an invented offer and accepts a supplied offer", async () => {
    vi.mocked(complete).mockResolvedValue(reply({ ready: true, brief: "Promote a $49 consultation." }));
    await expect(runInterview({ brand, goal: "ad" })).rejects.toBeInstanceOf(InterviewValidationError);
    await expect(runInterview({ brand: { ...brand, offers: ["$49 consultation"] }, goal: "ad" })).resolves.toMatchObject({ ready: true });
  });

  it("allows commercial clarification without inventing options or enabling random facts", async () => {
    vi.mocked(complete).mockResolvedValue(reply({ ready: false, question: { id: "offer", field: "offer", question: "What offer is available?", options: [], allowText: true, allowRandom: true, aiCanDecide: true } }));
    await expect(runInterview({ brand, goal: "Promote an offer" })).resolves.toMatchObject({ question: { options: [], allowRandom: false, aiCanDecide: false } });
  });

  it("does not repair transport failures or call providers after cancellation", async () => {
    vi.mocked(complete).mockRejectedValue(new Error("Provider unavailable"));
    await expect(runInterview({ brand, goal: "ad" })).rejects.toThrow("Provider unavailable");
    expect(complete).toHaveBeenCalledTimes(1);
    await expect(runInterview({ brand, goal: "ad" }, { signal: AbortSignal.abort() })).rejects.toThrow();
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("retains reference constraints without classifying text-free visuals as free offers", async () => {
    const referenceBrief = "Promote a $49 consultation. Use a text-free illustrative setting.";
    vi.mocked(complete).mockResolvedValue(reply({ ready: true, brief: referenceBrief }));
    await expect(runInterview({ brand, goal: "Try another scene", referenceBrief })).resolves.toMatchObject({ ready: true });
    expect(buildInterviewMessages({ brand, goal: "Try another scene", referenceBrief })[1].content).toContain(referenceBrief);
  });

  it("validates specific next-query recommendations alongside the brief", async () => {
    const recommendations = [{ label: "Rooftop detail", prompt: "Use a close-up of the panel installation; retain the confirmed facts." }, { label: "Installer perspective", prompt: "Show an illustrative installer at work with the same message." }];
    vi.mocked(complete).mockResolvedValue(reply({ ready: true, brief: "Invite solar enquiries.", recommendations }));
    await expect(runInterview({ brand, goal: "solar ad" })).resolves.toMatchObject({ recommendations });
    vi.mocked(complete).mockResolvedValue(reply({ ready: true, brief: "Invite solar enquiries.", recommendations: [recommendations[0], recommendations[0]] }));
    await expect(runInterview({ brand, goal: "solar ad" })).rejects.toBeInstanceOf(InterviewValidationError);
    vi.mocked(complete).mockResolvedValue(reply({ ready: true, brief: "Invite solar enquiries.", recommendations: [recommendations[0], { label: "Discount", prompt: "Promote a 50% discount" }] }));
    await expect(runInterview({ brand, goal: "solar ad" })).rejects.toBeInstanceOf(InterviewValidationError);
  });
});

describe("contextual creative recommendations", () => {
  it("uses actual offers and varies recommendations across brands", () => {
    const solar = creativeRecommendations({ ...brand, offers: ["Site assessment"], locations: ["Jaipur"] });
    const clinic = creativeRecommendations({ name: "Cedar", offers: ["$49 consultation"], usps: ["Evening appointments"] });
    expect(solar).toHaveLength(3);
    expect(clinic).toHaveLength(3);
    expect(JSON.stringify(solar)).toContain("Site assessment");
    expect(JSON.stringify(solar)).not.toContain("$49");
    expect(JSON.stringify(clinic)).toContain("$49 consultation");
    expect(creativeRecommendations({ name: "New business" }).some((item) => item.id.startsWith("offer"))).toBe(false);
  });

  it("does not repeat a fact already in the query and diversifies recent directions", () => {
    const input = { name: "Cedar", offers: ["Consultation"], usps: ["Evening appointments"], locations: ["Austin"] };
    expect(creativeRecommendations(input, "Promote Consultation").some((item) => item.label === "Feature: Consultation")).toBe(false);
    const initial = creativeRecommendations(input);
    expect(creativeRecommendations(input, "", initial.map((item) => item.prompt))).not.toEqual(initial);
    expect(new Set(initial.map((item) => item.prompt)).size).toBe(3);
    expect(creativeFollowUps().every((item) => item.prompt.length <= 500)).toBe(true);
  });
});

describe("buildInterviewMessages", () => {
  it("puts the industry, brand, goal and JSON contract in the prompt", () => {
    const msgs = buildInterviewMessages({ brand, goal: "A Diwali ad for my business" });
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toContain("solar energy");
    const user = msgs[1].content;
    expect(user).toContain("Solaride");
    expect(user).toContain("A Diwali ad for my business");
    // one-question-at-a-time + ready contracts
    expect(user).toContain('"ready": false');
    expect(user).toContain('"ready": true');
    expect(user).toContain('"question"');
    expect(user).toContain('"brief"');
  });

  it("lists valid language and angle ids for grounded choices", () => {
    const msgs = buildInterviewMessages({ brand, goal: "sale" });
    const user = msgs[1].content;
    expect(user).toMatch(/VALID LANGUAGE IDS/);
    expect(user).toMatch(/hinglish/);
    expect(user).toMatch(/VALID ANGLE IDS/);
    expect(user).toMatch(/urgency/);
  });

  it("includes prior answers when present", () => {
    const msgs = buildInterviewMessages({
      brand,
      goal: "sale",
      answers: [{ question: "Occasion?", answer: "Diwali" }],
    });
    expect(msgs[1].content).toContain("ANSWERS SO FAR");
    expect(msgs[1].content).toContain("A: Diwali");
  });

  it("falls back to a neutral industry when vertical is absent", () => {
    const msgs = buildInterviewMessages({ brand: { name: "Acme" }, goal: "x" });
    expect(msgs[0].content).toContain("local business");
  });

  it("treats the AI decision shortcut as a completed answer", () => {
    const messages = buildInterviewMessages({
      brand: { name: "Cedar Ridge", vertical: "chiropractic" },
      goal: "Drive urgency with a limited-time offer",
      answers: [
        {
          question: "Which offer should the ad feature?",
          answer: "Let the AI decide based on the brand.",
        },
      ],
    });
    expect(messages[1].content).toContain(
      "Let the AI decide based on the brand.",
    );
    expect(messages[0].content).toContain(
      'When the answer is "Surprise me" or "Let the AI decide", choose',
    );
  });
});
