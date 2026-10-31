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

  it("doesn't read the business's own name in AdBrain's welcome as a claim", () => {
    const greeting = (name: string) => `Hi! Thanks for messaging ${name}. Send this message and we'll reply here.`;
    expect(whatsappOpeningProblem({ greeting: greeting("Cure Dental Clinic"), autofill: "Hi, I'd like a checkup" }, { name: "Cure Dental Clinic", vertical: "dental clinic" })).toBeNull();
    expect(whatsappOpeningProblem({ greeting: greeting("No. 1 IELTS Institute"), autofill: "Hi, I'd like a demo class" }, { ...ielts, name: "No. 1 IELTS Institute" })).toBeNull();
    // The name is skipped, not the rest of the message.
    expect(whatsappOpeningProblem({ greeting: `${greeting("Cure Dental Clinic")} We cure gum disease.`, autofill: "Hi" }, { name: "Cure Dental Clinic", vertical: "dental clinic" }))
      .toMatchObject({ field: "greeting", error: expect.stringMatching(/^"cure" in the welcome is a health promise/) });
    // AdBrain's "know more about {name} in {city}" pre-typed message, in each language's word order.
    expect(whatsappOpeningProblem({ greeting: greeting("Cure Dental Clinic"), autofill: "Hi! I'd like to know more about Cure Dental Clinic in Mohali." }, { name: "Cure Dental Clinic", vertical: "dental clinic" })).toBeNull();
    expect(whatsappOpeningProblem({ greeting: greeting("Cure Dental Clinic"), autofill: "नमस्ते, मुझे Mohali में Cure Dental Clinic के बारे में जानकारी चाहिए।" }, { name: "Cure Dental Clinic", vertical: "dental clinic" })).toBeNull();
  });

  // Attack review on #2450: a name that is itself a claim word must not erase the owner's own claims.
  it.each([
    ["Cure", "Cure back pain with Cure", "chiropractic clinic"],
    ["No", "No refusal with No", "IELTS coaching"],
    ["Cure", "Hi! I'd like to know more about Cure in cure for back pain.", "chiropractic clinic"],
  ])("still checks the owner's words when the business is named %s", (name, text, vertical) => {
    expect(whatsappOpeningProblem({ greeting: text, autofill: "Hi" }, { name, vertical })).not.toBeNull();
  });

  it("passes AdBrain's suggested welcome and ordinary messages", () => {
    expect(whatsappOpeningProblem({ greeting: "Hi! Thanks for messaging Solaride. Send this message and we'll reply here.", autofill: "Hi, I'd like a free site survey in Mohali" }, solar)).toBeNull();
    expect(whatsappOpeningProblem({ greeting: "नमस्ते! IELTS क्लास के लिए धन्यवाद।", autofill: "", iceBreakers: ["Demo class kab hai?"] }, ielts)).toBeNull();
    // A warranty is a product guarantee, not a promised outcome.
    expect(whatsappOpeningProblem({ greeting: "Every panel has a 25-year warranty and guarantee.", autofill: "Tell me more" }, solar)).toBeNull();
  });
});
