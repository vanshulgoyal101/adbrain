import { describe, expect, it } from "vitest";
import {
  buildInterviewMessages,
  formatInterviewAnswers,
  type InterviewInput,
} from "@/lib/creative/interview";

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
});
