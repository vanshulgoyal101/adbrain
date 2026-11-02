import { describe, expect, it } from "vitest";
import { copyClaimWarnings, editableCopySchema } from "@/lib/creative/concept";
import recorded from "./fixtures/create/cedar-ridge-concept.json";

// #280: the owner edits a real saved concept by hand. The fact check only warns;
// the saved copy is whatever he typed.
const { brand, concept } = recorded;
const facts = [
  brand.name,
  brand.description,
  brand.target_audience,
  ...brand.usps,
  ...brand.offers,
  ...brand.locations,
  ...concept.sourceQuotes,
];
const copy = {
  headline: concept.headline,
  primary_text: concept.primary_text,
  description: concept.description,
  cta: concept.cta,
};
const warn = (over: Partial<typeof copy>) => copyClaimWarnings({ ...copy, ...over }, facts, brand.vertical);

describe("core: editing a recorded production concept (warn mode)", () => {
  it("accepts the recorded copy unchanged, with no warnings", () => {
    expect(editableCopySchema.safeParse(copy).success).toBe(true);
    expect(warn({})).toEqual([]);
  });

  it("warns when the owner types a price the Brand doesn't have, without matching $49 inside $490", () => {
    expect(warn({ headline: "$39 exam. Posture scan included." })).toEqual([
      "\"$39\" isn't in your Brand. Check it's true, or add it to your Brand's offers.",
    ]);
    expect(warn({ description: "Now $490 for the full plan" })).toEqual([
      "\"$490\" isn't in your Brand. Check it's true, or add it to your Brand's offers.",
    ]);
    // #2166: Devanagari digits are the same price, and the warning shows what the owner typed.
    expect(warn({ headline: "सिर्फ़ $३९ में जाँच" })).toEqual([
      "\"$३९\" isn't in your Brand. Check it's true, or add it to your Brand's offers.",
    ]);
  });

  it("keeps a Brand-backed free offer quiet and flags health claims for a clinic", () => {
    expect(warn({ headline: "Free 15-minute spine check" })).toEqual([]);
    expect(warn({ description: "We heal back pain for good" })).toEqual([
      "\"heal\" is a health claim Meta often rejects. Consider rewording it.",
    ]);
  });

  it("keeps Create's limits for hand edits", () => {
    expect(editableCopySchema.safeParse({ ...copy, headline: `${concept.headline} Book today` }).success).toBe(false);
  });
});
