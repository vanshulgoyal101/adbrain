import { describe, expect, it } from "vitest";
import { conceptValidationRules, validateConcept, type ConceptInput } from "@/lib/creative/concept";
import { AD_ANGLES } from "@/lib/templates/ads";
import recorded from "./fixtures/create/cedar-ridge-concept.json";
import groq from "./fixtures/create/cedar-ridge-groq-drafts.json";
import groqFields from "./fixtures/create/cedar-ridge-groq-fields.json";

// A real saved qwen concept for the seeded Cedar Ridge demo clinic, validated with
// the Brand facts and source facts it was generated from.
const input: ConceptInput = {
  brand: recorded.brand,
  brief: "Invite adults near Austin to enquire about a new-patient visit.",
  angle: AD_ANGLES[0],
  sourceFacts: recorded.sourceFacts,
};
const rules = (value: unknown) => {
  const result = validateConcept(value, input);
  return result.success ? [] : conceptValidationRules(result.issues);
};

describe("core: Create concept validation on a recorded production concept", () => {
  it("saves the recorded concept, including a rationale that runs past the prompt's 600", () => {
    expect(rules(recorded.concept)).toEqual([]);
    const { rationale } = recorded.concept;
    const overrun = { ...recorded.concept, rationale: `${rationale} ${rationale.slice(0, 200)}` };
    expect(overrun.rationale.length).toBeGreaterThan(600);
    expect(rules(overrun)).toEqual([]);
  });

  it("clips an over-long link description instead of discarding the concept", () => {
    const long = `${recorded.concept.description} with flexible evening and weekend appointments for busy adults`;
    expect(long.length).toBeGreaterThan(100);
    const result = validateConcept({ ...recorded.concept, description: long }, input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.concept.description.length).toBeLessThanOrEqual(100);
      expect(long.startsWith(result.concept.description)).toBe(true);
    }
  });

  it("still rejects uncited or invented claims and over-length ad copy", () => {
    // #281: a price stated without its quote is cited with the one Brand fact that has it; a made-up price still fails.
    const uncited = { ...recorded.concept, sourceQuotes: recorded.concept.sourceQuotes.filter((quote) => !quote.includes("$49")) };
    const cited = validateConcept(uncited, input);
    expect(cited.success && cited.concept.sourceQuotes).toContain("$49 new-patient exam and consultation");
    expect(rules(JSON.parse(JSON.stringify(uncited).replaceAll("$49", "$59")))).toContain("unsupported-commercial-claim");
    expect(rules({ ...recorded.concept, sourceQuotes: ["Voted best clinic in Austin"] })).toContain("sourceQuotes");
    expect(rules({ ...recorded.concept, headline: `${recorded.concept.headline} Book today` })).toEqual(["schema:headline:too_big"]);
  });

  it("normalizes cosmetic field slips once and keeps fields it cannot repair failing", () => {
    const result = validateConcept({
      ...recorded.concept,
      cta: "BOOK_NOW",
      supportingText: "x".repeat(65),
      visual: { ...recorded.concept.visual, direction: "d".repeat(2500), textPlacement: " Top " },
      sourceQuotes: [...recorded.concept.sourceQuotes, "  "],
    }, input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.concept.cta).toBe("Book Now");
      expect(result.concept.supportingText).toBeNull();
      expect(result.concept.visual).toMatchObject({ textPlacement: "top" });
      expect(result.concept.visual.direction).toHaveLength(2400);
      expect(result.concept.sourceQuotes).toEqual(recorded.concept.sourceQuotes);
    }
    expect(rules({ ...recorded.concept, cta: "Shop Now" })).toEqual(["schema:cta:invalid_value"]);
    expect(rules({ ...recorded.concept, visual: { ...recorded.concept.visual, textPlacement: "right" } }))
      .toEqual(["schema:visual.textPlacement:invalid_value"]);
  });
});

// Real Groq drafts for the run 5/6 input that were rejected for "heal" inside "health"
// or for a cited price followed by punctuation ("For $49, get...").
describe("core: Create claim checks on recorded Groq drafts", () => {
  const draftRules = (angleId: string, concept: unknown) => {
    const angle = AD_ANGLES.find((candidate) => candidate.id === angleId)!;
    const result = validateConcept(concept, { brand: recorded.brand, brief: groq.brief, angle, recentCopy: [], sourceFacts: [] });
    // These drafts pin claim rules; offer placement (#194) is asserted on its own below.
    return result.success ? [] : conceptValidationRules(result.issues).filter((rule) => rule !== "offer-below-fold");
  };

  it("flags only the recorded drafts whose $49 offer starts after Meta's 125-character fold (#194)", () => {
    const flagged = [...groq.drafts, ...groqFields.drafts].filter((draft) => {
      const angle = AD_ANGLES.find((candidate) => candidate.id === draft.angle)!;
      const result = validateConcept(draft.concept, { brand: recorded.brand, brief: groq.brief, angle, recentCopy: [], sourceFacts: [] });
      return !result.success && conceptValidationRules(result.issues).includes("offer-below-fold");
    });
    expect(flagged.map((draft) => draft.concept.primary_text.indexOf("$49"))).toEqual([128, 142, 147]);
  });

  it("saves drafts that mention health or punctuate a cited price, keeping real claim failures", () => {
    // One draft's only "claim" was the layout note "The top 40% of the image is uncluttered" (#202).
    expect(groq.drafts.filter((draft) => draft.rules.length === 0)).toHaveLength(7);
    for (const draft of groq.drafts) {
      expect(draft.rulesOnMain.length).toBeGreaterThan(0);
      expect(draftRules(draft.angle, draft.concept)).toEqual(draft.rules);
    }
  });

  it("still rejects healing claims and amounts the facts do not state", () => {
    const [health] = groq.drafts.filter((draft) => draft.rules.length === 0 && draft.concept.primary_text.includes("spinal health"));
    const healing = health.concept.primary_text.replace("spinal health", "spinal healing");
    expect(draftRules(health.angle, { ...health.concept, primary_text: healing })).toEqual(["banned-claim"]);
    const [price] = groq.drafts.filter((draft) => draft.rules.length === 0 && draft.concept.primary_text.includes("For $49,"));
    for (const amount of ["$4", "$490", "$49.99"]) {
      const primary_text = price.concept.primary_text.replace("For $49,", `For ${amount},`);
      expect(draftRules(price.angle, { ...price.concept, primary_text }), amount).toEqual(["unsupported-commercial-claim"]);
    }
  });

  // Rejected on main only for textPlacement "left" or a quote's capital letter.
  it("saves drafts with a left text area or a quote differing only in case", () => {
    expect(groqFields.drafts.filter((draft) => draft.rules.length === 0)).toHaveLength(3);
    for (const draft of groqFields.drafts) {
      expect(draft.rulesOnMain).not.toEqual(draft.rules);
      expect(draftRules(draft.angle, draft.concept)).toEqual(draft.rules);
    }
    const [left] = groqFields.drafts.filter((draft) => draft.concept.visual.textPlacement === "left" && !draft.rules.length && draft.concept.primary_text.indexOf("$49") < 125);
    const angle = AD_ANGLES.find((candidate) => candidate.id === left.angle)!;
    const saved = validateConcept(left.concept, { brand: recorded.brand, brief: groq.brief, angle, recentCopy: [], sourceFacts: [] });
    expect(saved.success && saved.concept.visual.textPlacement).toBe("center");
  });

  it("stores the Brand's exact quote and still rejects a quote with different words", () => {
    const [cased] = groqFields.drafts.filter((draft) => draft.concept.sourceQuotes.includes("Transparent cash pricing"));
    const angle = AD_ANGLES.find((candidate) => candidate.id === cased.angle)!;
    const check = (sourceQuotes: string[]) =>
      validateConcept({ ...cased.concept, sourceQuotes }, { brand: recorded.brand, brief: groq.brief, angle, recentCopy: [], sourceFacts: [] });
    const saved = check(cased.concept.sourceQuotes);
    expect(saved.success && saved.concept.sourceQuotes).toContain("transparent cash pricing");
    const others = cased.concept.sourceQuotes.filter((quote) => quote !== "Transparent cash pricing");
    for (const quote of ["Transparent card pricing", "Transparent cash pricing guaranteed"]) {
      const result = check([...others, quote]);
      expect(result.success ? [] : conceptValidationRules(result.issues), quote).toEqual(["sourceQuotes"]);
    }
  });
});
