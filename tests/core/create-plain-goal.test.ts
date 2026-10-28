import { describe, expect, it } from "vitest";
import { buildConceptMessages, validateConcept } from "@/lib/creative/concept";
import { creativeRecommendations } from "@/lib/creative/recommendations";
import { AD_ANGLES, type BrandContext } from "@/lib/templates/ads";
import run4 from "./fixtures/create/cedar-ridge-run4.json";

// #1153 (CPO, #1131 walk): a tapped suggestion now fills the goal with the owner's plain words ("Promote our
// $49 new-patient exam and consultation."), not "…Do not add new terms." The guard stays server-side: the
// concept prompt allows only supplied facts, and the claim check still needs the offer quoted verbatim.
const brand = run4.brand as BrandContext;
const goal = creativeRecommendations(brand).find((item) => item.id.startsWith("offer"))!.prompt;

describe("core: a plain-words goal keeps Create's offer guard (#1153)", () => {
  it("the goal reads as the owner's words, and the concept prompt still forbids new terms", () => {
    expect(goal).toBe("Promote our $49 new-patient exam and consultation.");
    const [system, user] = buildConceptMessages({ brand, brief: goal, angle: AD_ANGLES[2] });
    expect(system.content).toMatch(/Use only supplied facts for commercial claims\. Do not invent prices, offers/);
    expect(JSON.parse(user.content as string).brief).toBe(goal);
  });

  it("the recorded Haiku concepts still pass with the offer quoted verbatim from the Brand", () => {
    for (const angle of run4.angles) {
      const result = validateConcept(angle.concept, { brand, brief: goal, angle: AD_ANGLES.find((item) => item.name === angle.angleName)! });
      expect(result.success, angle.angleName).toBe(true);
      if (result.success) expect(result.concept.sourceQuotes).toContain("$49 new-patient exam and consultation");
    }
  });

  it("an offer the Brand doesn't have is still refused, whatever the goal says", () => {
    const concept = { ...run4.angles[2].concept, primary_text: "Austin chiropractic: $29 new-patient exam this week.\nBook your visit today." };
    const result = validateConcept(concept, { brand, brief: "Promote our $29 new-patient exam.", angle: AD_ANGLES[2] });
    expect(result.success ? [] : result.issues).toEqual(expect.arrayContaining([expect.stringMatching(/^unsupported-commercial-claim: \$29/)]));
  });
});
