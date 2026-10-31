import { describe, expect, it } from "vitest";
import { buildConceptMessages, validateConcept } from "@/lib/creative/concept";
import { creativeRecommendations } from "@/lib/creative/recommendations";
import { AD_ANGLES, type BrandContext } from "@/lib/templates/ads";
import run4 from "./fixtures/create/cedar-ridge-run4.json";
import regenerate from "./fixtures/create/solaride-regenerate.json";
import { occasionIdeas } from "@/lib/seasonal";

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

// #1210: November occasion chips (Chhath, Guru Nanak Jayanti, wedding and winter) fill the goal in plain words too.
// A festival is not an offer: the recorded Solaride concepts pass as before, and a festival discount the Brand
// never saved is refused.
describe("core: an occasion goal adds no offer (#1210)", () => {
  const solaride = regenerate.brand as BrandContext;
  const replies = regenerate.replies.map((reply) => JSON.parse(reply.content.replace(/^```json\s*|\s*```\s*$/g, "")));
  const input = (brief: string) => ({ brand: solaride, brief, angle: AD_ANGLES.find((angle) => angle.name === regenerate.angle) ?? AD_ANGLES[0], instructions: regenerate.instructions, sourceFacts: regenerate.sourceFacts });

  it("validates the recorded concepts the same under a Guru Nanak Jayanti goal, and refuses an invented festival discount", () => {
    const [idea] = occasionIdeas("Solaride", new Date("2026-11-20T06:00:00Z"));
    expect(idea.prompt).toBe("An ad for Guru Nanak Jayanti from Solaride.");
    for (const reply of replies) {
      expect(validateConcept(reply, input(idea.prompt)).success, reply.headline).toBe(validateConcept(reply, input(regenerate.brief)).success);
    }
    const invented = { ...replies[0], primary_text: "Guru Nanak Jayanti offer: 20% off rooftop solar in Mohali.\nBook your free site survey." };
    const result = validateConcept(invented, input(idea.prompt));
    expect(result.success ? [] : result.issues).toEqual(expect.arrayContaining([expect.stringMatching(/^unsupported-commercial-claim: 20%/)]));
  });
});
