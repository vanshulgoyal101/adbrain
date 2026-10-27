import { describe, expect, it } from "vitest";
import { validateConcept } from "@/lib/creative/concept";
import { AD_ANGLES, type BrandContext } from "@/lib/templates/ads";
import run4 from "./fixtures/create/cedar-ridge-run4.json";
import haiku from "./fixtures/create/cedar-ridge-haiku.json";
import regenerate from "./fixtures/create/solaride-regenerate.json";
import hindi from "./fixtures/create/solaride-hindi.json";

// #418 rule 2 (Analyst, #941): long-running local ads put their one offer on the picture. The picture shows
// the headline and supportingText, so a recorded reply that states the offer only in primary_text gets the
// owner's offer fact as its picture line. Recorded Haiku replies, no new model call and no repair.
const parse = (content: string) => JSON.parse(content.replace(/^```json\s*|\s*```\s*$/g, ""));
const cedar = { brand: run4.brand as BrandContext, brief: run4.brief };
const angle = (name: string) => AD_ANGLES.find((item) => item.name === name) ?? AD_ANGLES[0];
const saved = (value: unknown, input: Parameters<typeof validateConcept>[1]) => {
  const result = validateConcept(value, input);
  expect(result.success ? [] : result.issues).toEqual([]);
  return result.success ? result.concept : null!;
};

describe("core: the copy's offer goes on the picture (#418 rule 2)", () => {
  it("puts the $49 exam on the picture when the copy states it and the picture line doesn't", () => {
    const pain = run4.angles.find((item) => item.angleName === "Solve a pain point")!;
    expect(pain.concept.supportingText).toBe("Evening and Saturday hours across three Austin-area locations");
    const concept = saved(pain.concept, { ...cedar, angle: angle(pain.angleName) });
    expect(concept.supportingText).toBe("$49 new-patient exam and consultation");
  });

  it("leaves the picture alone when the headline already carries the offer", () => {
    const offer = run4.angles.find((item) => item.angleName === "Special offer / incentive")!;
    expect(offer.concept.headline).toMatch(/\$49/);
    expect(saved(offer.concept, { ...cedar, angle: angle(offer.angleName) }).supportingText).toBe(offer.concept.supportingText);
  });

  it("every recorded low-effort Cedar take that states an offer shows it on the picture", () => {
    for (const reply of haiku.byEffort.low.replies) {
      const recorded = parse(reply.content);
      const result = validateConcept(recorded, { ...cedar, angle: angle(reply.angleName) });
      if (!result.success || !/\$49|free/i.test(result.concept.primary_text)) continue;
      expect(`${result.concept.headline}\n${result.concept.supportingText}`, reply.angleName).toMatch(/\$49|free/i);
    }
  });

  it("uses only the owner's own offer words: Solaride's Diwali offer, not a cost the copy mentions", () => {
    const input = {
      brand: regenerate.brand as BrandContext, brief: regenerate.brief, angle: angle(regenerate.angle),
      instructions: regenerate.instructions, sourceFacts: regenerate.sourceFacts, recentCopy: regenerate.recentCopy,
    };
    let checked = 0;
    for (const reply of regenerate.replies) {
      const result = validateConcept(parse(reply.content), input);
      if (!result.success) continue;
      checked++;
      const picture = `${result.concept.headline}\n${result.concept.supportingText}`;
      expect(picture).toMatch(/10%|free site survey/i);
      expect(regenerate.brand.offers.concat(parse(reply.content).supportingText)).toContain(result.concept.supportingText);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("keeps a Hindi reply's own picture line", () => {
    let checked = 0;
    for (const reply of hindi.replies.filter((item) => item.language === "hi")) {
      const recorded = parse(reply.content);
      if (typeof recorded.supportingText !== "string") continue;
      const goal = hindi.goals.hi[reply.goal as keyof typeof hindi.goals.hi];
      const result = validateConcept(recorded, { brand: hindi.brand as BrandContext, brief: goal, angle: AD_ANGLES[0], language: "Hindi", recentCopy: hindi.recentCopy });
      if (!result.success) continue;
      checked++;
      expect(result.concept.supportingText).toBe(recorded.supportingText);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("does nothing without a matching offer fact", () => {
    const pain = run4.angles.find((item) => item.angleName === "Solve a pain point")!;
    const noOffers = { ...cedar, brand: { ...cedar.brand, offers: [] }, sourceFacts: ["$49 new-patient exam and consultation"] };
    expect(saved(pain.concept, { ...noOffers, angle: angle(pain.angleName) }).supportingText).toBe(pain.concept.supportingText);
  });
});
