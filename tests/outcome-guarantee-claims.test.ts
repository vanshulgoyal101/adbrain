import { describe, expect, it } from "vitest";
import { adPolicyHits } from "@/lib/campaign/ad-policy";
import { copyClaimWarnings, validateConcept } from "@/lib/creative/concept";
import { bannedClaimsForVertical, EDUCATION_BANNED_CLAIMS, MEDICAL_BANNED_CLAIMS, OUTCOME_GUARANTEE_CLAIMS } from "@/lib/creative/slopScan";
import { AD_ANGLES } from "@/lib/templates/ads";

// #2423 (Analyst #2411): Meta prohibits returns "guaranteed or risk-free"; solar and interiors ads must not promise them.
const reviewTerms = (text: string, vertical: string) => adPolicyHits([{ id: "a", headline: text }], vertical).map((hit) => hit.term);

describe("outcome guarantees for solar and interiors (#2423)", () => {
  it.each([
    ["Guaranteed savings on your power bill", "solar energy", "guaranteed saving"],
    ["Guaranteed return on your rooftop", "Rooftop solar", "guaranteed return"],
    ["Assured returns in 4 years", "rooftop solar installer", "assured return"],
    ["Solar with guaranteed ROI", "Solar", "guaranteed roi"],
    ["A risk-free switch to solar", "solar", "risk-free"],
    ["Risk free modular kitchen upgrade", "Modular kitchens and interiors", "risk free"],
    ["Lowest price guaranteed on wardrobes", "Interior designer", "lowest price guaranteed"],
    ["Savings guaranteed from month one", "ENERGY_AND_UTILITIES", "savings guaranteed"],
    ["बिजली बिल पर बचत की गारंटी", "solar energy", "बचत की गारंटी"],
    ["ਬਿਜਲੀ ਬਿੱਲ ਤੇ ਬੱਚਤ ਦੀ ਗਾਰੰਟੀ", "solar energy", "ਬੱਚਤ ਦੀ ਗਾਰੰਟੀ"],
    ["Solar lagwao, bachat ki guarantee", "solar energy", "bachat ki guarantee"],
  ])("Review blocks %s (%s)", (text, vertical, term) => {
    expect(bannedClaimsForVertical(vertical)).toContain(term);
    expect(reviewTerms(text, vertical)).toContain(term);
  });

  it("leaves product warranties and honest savings copy alone", () => {
    for (const text of [
      "25-year panel warranty, 5-year installation guarantee",
      "Panels with a 25-year performance guarantee",
      "Cut your electricity bill with rooftop solar",
      "Save on your bill every month",
      "10-year warranty on every kitchen",
    ]) expect(reviewTerms(text, "solar energy"), text).toEqual([]);
  });

  it("applies to solar, energy and interiors only; other industries are unchanged", () => {
    for (const vertical of ["solar energy", "Rooftop solar", "Modular kitchens", "modular kitchens and home interiors", "Interior designer", "ENERGY_AND_UTILITIES"])
      expect(bannedClaimsForVertical(vertical), vertical).toEqual(expect.arrayContaining(OUTCOME_GUARANTEE_CLAIMS));
    for (const vertical of ["Eggless cakes", "family restaurant", "hair and beauty salon", "local business", ""])
      expect(bannedClaimsForVertical(vertical), vertical).toEqual([]);
    expect(bannedClaimsForVertical("solar energy")).not.toEqual(expect.arrayContaining(EDUCATION_BANNED_CLAIMS));
    expect(bannedClaimsForVertical("dental clinic")).toEqual([...MEDICAL_BANNED_CLAIMS]);
  });

  it("Create refuses the phrase even when a Brand fact says it", () => {
    const fact = "Guaranteed savings on your bill from month one";
    const input = { brand: { name: "Solaride", vertical: "solar energy", usps: [fact] }, brief: "Rooftop solar", angle: AD_ANGLES[0], format: "story" as const };
    const concept = {
      headline: "Guaranteed savings with solar", primary_text: "Rooftop solar from Solaride.", description: "Book a site visit.", cta: "Get Quote",
      rationale: "Savings angle.", visual: { medium: "Photo", direction: "A rooftop solar array on a lived-in home, viewed from above, roof in the upper half.", textPlacement: "bottom" },
      supportingText: null, sourceQuotes: [fact],
    };
    const result = validateConcept(concept, input);
    expect(result.success).toBe(false);
    expect(!result.success && result.issues).toContain("banned-claim: guaranteed saving");
    // An owner's own edit gets the same words as a warning.
    expect(copyClaimWarnings({ headline: "Guaranteed savings with solar", primary_text: "", description: "" }, [fact], "solar energy"))
      .toContain('"guaranteed saving" is a promise Meta often rejects. Consider rewording it.');
  });
});
