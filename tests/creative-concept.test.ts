import { describe, expect, it } from "vitest";
import {
  buildConceptMessages,
  conceptImagePrompt,
  validateConcept,
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
