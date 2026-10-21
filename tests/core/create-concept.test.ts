import { describe, expect, it } from "vitest";
import { conceptValidationRules, validateConcept, type ConceptInput } from "@/lib/creative/concept";
import { AD_ANGLES } from "@/lib/templates/ads";
import recorded from "./fixtures/create/cedar-ridge-concept.json";
import groq from "./fixtures/create/cedar-ridge-groq-drafts.json";

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
    expect(rules({
      ...recorded.concept,
      sourceQuotes: recorded.concept.sourceQuotes.filter((quote) => !quote.includes("$49")),
    })).toContain("unsupported-commercial-claim");
    expect(rules({ ...recorded.concept, sourceQuotes: ["Voted best clinic in Austin"] })).toContain("sourceQuotes");
    expect(rules({ ...recorded.concept, headline: `${recorded.concept.headline} Book today` })).toEqual(["schema:headline:too_big"]);
    expect(rules({ ...recorded.concept, supportingText: "x".repeat(65) })).toEqual(["schema:supportingText:too_big"]);
  });
});

// Real Groq drafts for the run 5/6 input that were rejected for "heal" inside "health"
// or for a cited price followed by punctuation ("For $49, get...").
describe("core: Create claim checks on recorded Groq drafts", () => {
  const draftRules = (angleId: string, concept: unknown) => {
    const angle = AD_ANGLES.find((candidate) => candidate.id === angleId)!;
    const result = validateConcept(concept, { brand: recorded.brand, brief: groq.brief, angle, recentCopy: [], sourceFacts: [] });
    return result.success ? [] : conceptValidationRules(result.issues);
  };

  it("saves drafts that mention health or punctuate a cited price, keeping real claim failures", () => {
    expect(groq.drafts.filter((draft) => draft.rules.length === 0)).toHaveLength(6);
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
});
