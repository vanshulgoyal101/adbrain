import { describe, expect, it } from "vitest";
import { validateConcept } from "@/lib/creative/concept";
import { AD_ANGLES, type BrandContext } from "@/lib/templates/ads";
import recorded from "./fixtures/create/solaride-regenerate.json";

// #713: in the Oct 26 paid timing runs, Haiku twice cited the owner's typed fact as "the cost of the solar
// installation will go more than 10,000 rupees per kilowatt". The fact (production Solaride brief) reads
// "…or cost of the solar installation…", so the added "the" failed the verbatim check and the ad was lost.
const QUOTE = "the cost of the solar installation will go more than 10,000 rupees per kilowatt";
const concept = {
  headline: "Beat the December 31 price rise",
  primary_text: "Factory solar costs will rise by over 10,000 rupees per kilowatt after December 31.\nBook a site survey by November 10.",
  description: "Engineering-backed factory solar before the deadline.",
  cta: "Learn More",
  rationale: "Urgency from the owner's own deadline, without technical jargon.",
  visual: { medium: "Architectural photography", direction: "A large factory roof covered in a neat array of solar panels at golden hour, with installers at work.", textPlacement: "top" },
  supportingText: null,
  sourceQuotes: [QUOTE],
};
const input = { brand: recorded.brand as BrandContext, brief: recorded.brief, angle: AD_ANGLES[0], sourceFacts: recorded.sourceFacts };

describe("core: Create cites an owner's fact quoted with an added article (#713)", () => {
  it("stores the fact's own words instead of losing the ad", () => {
    expect(recorded.sourceFacts.join(" ")).toContain("or cost of the solar installation will go more than 10,000 rupees per kilowatt");
    const result = validateConcept(concept, input);
    expect(result.success ? [] : result.issues).toEqual([]);
    expect(result.success && result.concept.sourceQuotes).toEqual([QUOTE.replace(/^the /, "")]);
  });

  it("still refuses a quote whose words differ from the fact", () => {
    const result = validateConcept({ ...concept, sourceQuotes: ["the cost of solar panels will go more than 10,000 rupees per kilowatt"] }, input);
    expect(result.success ? [] : result.issues.filter((issue) => issue.startsWith("sourceQuotes"))).toHaveLength(1);
  });
});
