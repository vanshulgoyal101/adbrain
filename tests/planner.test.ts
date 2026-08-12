import { describe, expect, it } from "vitest";
import { buildPlannerMessages, formatAnswers } from "@/lib/campaign/planner";

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
