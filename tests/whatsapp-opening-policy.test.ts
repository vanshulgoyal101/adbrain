import { describe, expect, it } from "vitest";
import { whatsappOpeningProblem } from "@/lib/campaign/whatsapp-template-check";

// #2422 (Analyst #2411): Meta reviews the welcome, pre-typed message and quick questions with the ad.
const ielts = { vertical: "IELTS coaching", offers: ["Free demo class"], usps: ["Small batches"], description: "IELTS coaching in Mohali" };
const solar = { vertical: "solar energy", offers: ["Free site survey"], usps: ["25-year panel warranty"], description: "Rooftop solar in Tricity" };

describe("WhatsApp opening policy check (#2422)", () => {
  it("blocks an IELTS welcome that promises a visa, naming the field", () => {
    expect(whatsappOpeningProblem({ greeting: "Hi! 100% visa with our team. Send this message and we'll reply.", autofill: "Hi, I'd like a demo class" }, ielts))
      .toEqual({ field: "greeting", error: '"100% visa" in the welcome is a promise Meta rejects. Reword it.' });
  });

  it("checks the pre-typed message and each quick question too", () => {
    expect(whatsappOpeningProblem({ greeting: "Hi! Thanks for messaging Solaride.", autofill: "I want guaranteed savings on my bill" }, solar))
      .toMatchObject({ field: "prefill", error: expect.stringMatching(/^"guaranteed saving" in the pre-typed message/) });
    expect(whatsappOpeningProblem({ greeting: "Hi! Tap a question.", autofill: "", iceBreakers: ["Site survey?", "Is it risk-free?"] }, solar))
      .toMatchObject({ field: "questions", error: expect.stringMatching(/^"risk-free" in the quick question/) });
  });

  it("holds the opening to the ad text's policy rules (#738)", () => {
    expect(whatsappOpeningProblem({ greeting: "Is your electricity bill too high? Solar can help.", autofill: "Tell me more" }, solar))
      .toMatchObject({ field: "greeting", error: expect.stringContaining("Meta often rejects this") });
  });

  it("passes AdBrain's suggested welcome and ordinary messages", () => {
    expect(whatsappOpeningProblem({ greeting: "Hi! Thanks for messaging Solaride. Send this message and we'll reply here.", autofill: "Hi, I'd like a free site survey in Mohali" }, solar)).toBeNull();
    expect(whatsappOpeningProblem({ greeting: "नमस्ते! IELTS क्लास के लिए धन्यवाद।", autofill: "", iceBreakers: ["Demo class kab hai?"] }, ielts)).toBeNull();
    // A warranty is a product guarantee, not a promised outcome.
    expect(whatsappOpeningProblem({ greeting: "Every panel has a 25-year warranty and guarantee.", autofill: "Tell me more" }, solar)).toBeNull();
  });
});
