import { describe, expect, it } from "vitest";
import { buildConceptMessages, conceptValidationRules, validateConcept, type ConceptInput } from "@/lib/creative/concept";
import { AD_ANGLES } from "@/lib/templates/ads";
import recorded from "./fixtures/create/cedar-ridge-concept.json";
import groq from "./fixtures/create/cedar-ridge-groq-descriptions.json";

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

// Real Groq drafts for the run 5/6 input: asked for up to 100 characters the model
// wrote 101-103; asked for up to 80 it stayed under 100.
describe("core: Create link description on recorded Groq drafts", () => {
  const groqRules = (angleId: string, value: unknown) => {
    const angle = AD_ANGLES.find((candidate) => candidate.id === angleId)!;
    const result = validateConcept(value, { brand: recorded.brand, brief: groq.brief, angle, recentCopy: [], sourceFacts: [] });
    return result.success ? [] : conceptValidationRules(result.issues);
  };

  it("asks for 80 characters and keeps the 100-character limit", () => {
    expect(buildConceptMessages({ brand: recorded.brand, brief: groq.brief, angle: AD_ANGLES[0] })[0].content)
      .toContain("Meta link description up to 80 characters");
    expect(groq.promptUpTo100.map((draft) => draft.concept.description.length)).toEqual([103, 101]);
    for (const draft of groq.promptUpTo100) {
      expect(groqRules(draft.angle, draft.concept)).toEqual(["schema:description:too_big"]);
    }
  });

  it("saves drafts written to the 80-character target, including overruns up to 100", () => {
    expect(Math.max(...groq.promptUpTo80.map((draft) => draft.concept.description.length))).toBe(90);
    for (const draft of groq.promptUpTo80) expect(groqRules(draft.angle, draft.concept)).toEqual([]);
  });
});
