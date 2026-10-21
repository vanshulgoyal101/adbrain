import { describe, expect, it } from "vitest";
import { conceptValidationRules, validateConcept, type ConceptInput } from "@/lib/creative/concept";
import { AD_ANGLES } from "@/lib/templates/ads";
import recorded from "./fixtures/create/cedar-ridge-concept.json";

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
