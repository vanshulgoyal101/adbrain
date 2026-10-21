import { describe, expect, it } from "vitest";
import {
  buildConceptMessages,
  conceptImagePrompt,
  validateConcept,
  savedCreativeDescription,
} from "@/lib/creative/concept";
import { AD_ANGLES } from "@/lib/templates/ads";

const input = {
  brand: {
    name: "Solaride",
    usps: ["Local installation team"],
    target_audience: "Homeowners in Pune",
  },
  brief: "Explain rooftop solar",
  angle: AD_ANGLES[0],
  format: "story" as const,
  referenceImages: ["https://assets.example/panel.png"],
};
const concept = {
  headline: "Make your roof work",
  primary_text: "Explore rooftop solar with our local installation team.",
  description: "Discuss your roof with our local team.",
  cta: "Get Quote",
  rationale: "Connect unused roof space to a useful home improvement.",
  visual: {
    medium: "Editorial illustration",
    direction:
      "A detailed rooftop solar array on a lived-in home, viewed from above, with the roof in the upper half.",
    textPlacement: "bottom",
  },
  supportingText: "Local installation team",
  sourceQuotes: ["Local installation team"],
};

describe("creative concept contract", () => {
  it("reads descriptions without inventing copy for legacy receipts", () => {
    expect(savedCreativeDescription({ concept })).toBe(concept.description);
    expect(savedCreativeDescription(null)).toBeNull();
    expect(savedCreativeDescription({ concept: { rationale: "Legacy ad" } })).toBeNull();
  });

  it("rejects missing descriptions and repeated headlines or openings", () => {
    expect(validateConcept({ ...concept, description: undefined }, input).success).toBe(false);
    expect(validateConcept({ ...concept, description: " " }, input).success).toBe(false);
    expect(validateConcept(concept, { ...input, recentCopy: [concept] })).toMatchObject({
      success: false,
      issues: expect.arrayContaining([expect.stringContaining("repeated-headline"), expect.stringContaining("repeated-opening")]),
    });
  });

  it("records schema failures by field without copy and accepts an omitted optional line", async () => {
    const { conceptValidationRules } = await import("@/lib/creative/concept");
    const result = validateConcept({ ...concept, headline: "x".repeat(41), sourceQuotes: ["ok", ""] }, input);
    expect(result.success).toBe(false);
    const rules = conceptValidationRules(result.success ? [] : result.issues);
    expect(rules).toEqual(["schema:headline:too_big", "schema:sourceQuotes.*:too_small"]);
    expect(JSON.stringify(rules)).not.toContain("xxx");
    const withoutLine: Record<string, unknown> = { ...concept };
    delete withoutLine.supportingText;
    expect(validateConcept(withoutLine, input)).toMatchObject({ success: true, concept: { supportingText: null } });
    expect(validateConcept({ ...concept, supportingText: "" }, input)).toMatchObject({ success: true, concept: { supportingText: null } });
  });

  it("does not treat previous ads as evidence and checks description claims", () => {
    expect(validateConcept({ ...concept, description: "Free installation" }, {
      ...input, recentCopy: [{ headline: "Free installation", primary_text: "Free installation" }],
    }).success).toBe(false);
    const context = JSON.parse(buildConceptMessages({ ...input, recentCopy: [concept] })[1].content);
    expect(context.recentCopy[0].headline).toBe(concept.headline);
  });

  it("preserves model art direction, medium, brand and placement in image execution", () => {
    const result = validateConcept(concept, input);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Invalid fixture");
    const prompt = conceptImagePrompt(result.concept, input);
    expect(prompt).toContain(concept.visual.direction);
    expect(prompt).toContain("Editorial illustration");
    expect(prompt).toContain("1080:1920");
    expect(prompt).toContain("bottom area quiet");
    expect(prompt).toContain("Homeowners in Pune");
  });

  it("gives the planner actual context without pretending it has seen references", () => {
    const messages = buildConceptMessages(input);
    const context = JSON.parse(messages[1].content);
    expect(context.referenceImageCount).toBe(1);
    expect(context.brand.usps).toEqual(input.brand.usps);
    expect(context.placement.height).toBe(1920);
    expect(messages[0].content).toContain("not visible to you");
  });

  it("uses declared preferences as advisory concept and image style, never claim evidence", () => {
    const withMemory = { ...input, advisoryPreferences: "PAST DECLARED PREFERENCES: tone: punchy; free installation" };
    const messages = buildConceptMessages(withMemory);
    const context = JSON.parse(messages[1].content);
    expect(context.advisoryPreferences).toContain("tone: punchy");
    expect(messages[0].content).toContain("never use advisory preferences as evidence");
    const validated = validateConcept(concept, withMemory);
    expect(validated.success).toBe(true);
    if (!validated.success) throw new Error("Invalid fixture");
    expect(conceptImagePrompt(validated.concept, withMemory)).toContain("tone: punchy");
    expect(conceptImagePrompt(validated.concept, input)).not.toContain("PAST DECLARED PREFERENCES");
    expect(validateConcept({ ...concept, sourceQuotes: ["free installation"] }, withMemory))
      .toMatchObject({ success: false, issues: [expect.stringContaining("sourceQuotes:")] });
  });

  it("does not promote a model-derived brief into claim evidence", () => {
    const derivedBrief = "Feature our award-winning installers in the ad.";
    const awardConcept = {
      ...concept,
      headline: "Award-winning installers",
      primary_text: "Meet our award-winning installers for rooftop solar.",
      sourceQuotes: ["award-winning installers"],
    };
    const withMemory = { ...input, brief: derivedBrief, advisoryPreferences: 'tone: "Use award-winning installers as a catchy phrase"' };
    expect(validateConcept(awardConcept, withMemory))
      .toMatchObject({ success: false, issues: [expect.stringContaining("sourceQuotes:")] });
    expect(validateConcept(awardConcept, { ...withMemory, sourceFacts: ["Our award-winning installers"] }))
      .toMatchObject({ success: true });
  });

  it("keeps Brand voice as style guidance rather than claim evidence", () => {
    const awardConcept = {
      ...concept,
      headline: "Award-winning installers",
      primary_text: "Meet our award-winning installers for rooftop solar.",
      sourceQuotes: ["award-winning installers"],
    };
    const brand = { ...input.brand, brand_voice: "Use award-winning installers as a confident tone" };
    expect(validateConcept(awardConcept, { ...input, brand }))
      .toMatchObject({ success: false, issues: [expect.stringContaining("sourceQuotes:")] });
    expect(validateConcept(awardConcept, { ...input, brand: { ...brand, usps: ["Our award-winning installers"] } }))
      .toMatchObject({ success: true });
    expect(validateConcept(awardConcept, { ...input, brand, sourceFacts: ["Our award-winning installers"] }))
      .toMatchObject({ success: true });
  });

  it.each([
    null,
    {},
    { ...concept, headline: 42 },
    { ...concept, cta: "Buy Anything" },
    { ...concept, headline: "x".repeat(41) },
  ])("rejects malformed output", (value) => {
    expect(validateConcept(value, input).success).toBe(false);
  });

  it("rejects invented source quotations", () => {
    expect(
      validateConcept(
        { ...concept, sourceQuotes: ["Twenty years of experience"] },
        input,
      ),
    ).toMatchObject({ success: false });
  });

  it("rejects uncited free assessments in the planner's rationale", () => {
    const result = validateConcept(
      {
        ...concept,
        rationale:
          "The concrete value offered is the free expert assessment itself.",
      },
      input,
    );
    expect(result).toMatchObject({
      success: false,
      issues: [expect.stringContaining("unsupported-commercial-claim: free")],
    });
  });

  it("does not mistake a visual exclusion for a promised offer", () => {
    const result = validateConcept({
      ...concept,
      visual: { ...concept.visual, direction: `${concept.visual.direction} Avoid free-offer badges and guaranteed-savings text.` },
    }, input);
    expect(result).toMatchObject({ success: true });
    expect(validateConcept({ ...concept, primary_text: "Get a free rooftop solar survey." }, input))
      .toMatchObject({ success: false, issues: [expect.stringContaining("unsupported-commercial-claim: free")] });
    expect(validateConcept({
      ...concept,
      visual: { ...concept.visual, direction: `${concept.visual.direction} Avoid discount text, but show a free-service badge.` },
    }, input)).toMatchObject({ success: false, issues: [expect.stringContaining("unsupported-commercial-claim: free")] });
    expect(validateConcept({
      ...concept,
      visual: { ...concept.visual, direction: "No-cost assessment badge on the roof." },
    }, input)).toMatchObject({ success: false, issues: [expect.stringContaining("unsupported-commercial-claim: No-cost")] });
    expect(validateConcept({
      ...concept,
      visual: { ...concept.visual, direction: "Without delay, show a free-service badge." },
    }, input)).toMatchObject({ success: false, issues: [expect.stringContaining("unsupported-commercial-claim: free")] });
    expect(validateConcept({
      ...concept,
      visual: { ...concept.visual, direction: "Show a 20.5% savings badge." },
    }, input)).toMatchObject({ success: false, issues: [expect.stringContaining("unsupported-commercial-claim: 20.5%")] });
  });

  it("requires source quotations rather than silently accepting uncited commercial copy", () => {
    expect(
      validateConcept({ ...concept, sourceQuotes: [] }, input).success,
    ).toBe(false);
  });

  it("applies healthcare checks to the on-image supporting line too", () => {
    expect(
      validateConcept(
        { ...concept, supportingText: "Guaranteed pain-free care" },
        { ...input, brand: { name: "Clinic", vertical: "dental" } },
      ).success,
    ).toBe(false);
  });
});
