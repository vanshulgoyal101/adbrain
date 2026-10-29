import { describe, expect, it } from "vitest";
import { statesOffer, validateConcept } from "@/lib/creative/concept";
import { AD_ANGLES, type BrandContext } from "@/lib/templates/ads";
import regenerate from "./fixtures/create/solaride-regenerate.json";

// #1676 (CPO, Analyst #1514): a solar ad may mention the PM Surya Ghar subsidy only when the Brand says so (a registered
// vendor); otherwise it's a misleading claim. Same rule as "free" and "guaranteed": it needs a supporting Brand fact.
const recorded = JSON.parse(regenerate.replies[1].content.replace(/^```json\s*|\s*```\s*$/g, ""));
const brand = regenerate.brand as BrandContext;
const angle = AD_ANGLES.find((item) => item.name === regenerate.angle)!;
const withoutSubsidy: BrandContext = {
  ...brand,
  offers: (brand.offers ?? []).filter((offer) => !/subsid/i.test(offer)),
  usps: (brand.usps ?? []).filter((usp) => !/subsid/i.test(usp)),
};
const issues = (value: unknown, b: BrandContext) => {
  const result = validateConcept(value, { brand: b, brief: regenerate.brief, angle });
  return result.success ? [] : result.issues;
};
const subsidyIssue = expect.stringMatching(/^unsupported-commercial-claim: (?:PM Surya Ghar|subsid|सब्सिडी)/i);
const withLine = (line: string, quotes: string[] = recorded.sourceQuotes) =>
  ({ ...recorded, primary_text: `${recorded.primary_text}\n${line}`, sourceQuotes: quotes });

describe("core: a subsidy claim needs a Brand fact (#1676)", () => {
  it("the recorded Solaride reply still passes as recorded", () => {
    expect(issues(recorded, brand)).toEqual([]);
  });

  it("no subsidy fact: 'Get your PM Surya Ghar subsidy' is refused, so generation repairs it", () => {
    expect(issues(withLine("Get your PM Surya Ghar subsidy."), withoutSubsidy)).toEqual(expect.arrayContaining([subsidyIssue]));
    expect(issues(withLine("We sort out solar subsidies for you."), withoutSubsidy)).toEqual(expect.arrayContaining([subsidyIssue]));
  });

  it("Hindi सब्सिडी is held to the same rule", () => {
    expect(issues(withLine("सब्सिडी हम दिलाएँगे।"), withoutSubsidy)).toEqual(expect.arrayContaining([subsidyIssue]));
  });

  it("a Brand that offers PM Surya Ghar subsidy help keeps the line", () => {
    const line = withLine("We help with your PM Surya Ghar subsidy.", [...recorded.sourceQuotes, "PM Surya Ghar subsidy help"]);
    expect(issues(line, brand)).toEqual([]);
  });

  it("a Brand fact that says they're not a subsidy vendor doesn't support it", () => {
    const negated: BrandContext = { ...withoutSubsidy, usps: [...(withoutSubsidy.usps ?? []), "We are not a PM Surya Ghar subsidy vendor"] };
    expect(issues(withLine("Get your PM Surya Ghar subsidy.", [...recorded.sourceQuotes, "We are not a PM Surya Ghar subsidy vendor"]), negated))
      .toEqual(expect.arrayContaining([subsidyIssue]));
  });

  it("the CPO's 'Not a subsidy vendor' negates it too", () => {
    const negated: BrandContext = { ...withoutSubsidy, description: `${withoutSubsidy.description} Not a subsidy vendor.` };
    expect(issues(withLine("We sort out solar subsidies for you."), negated)).toEqual(expect.arrayContaining([subsidyIssue]));
  });

  it("supported by a Brand fact even when the ad's quotes cite something else (the recorded eval's gold-4 line)", () => {
    const line = withLine("We also check your PM Surya Ghar subsidy eligibility.");
    expect(issues(line, brand)).toEqual([]);
  });

  it("owner-typed copy that mentions a subsidy gets the existing offer warning", () => {
    expect(statesOffer("PM Surya Ghar subsidy available")).toBe(true);
    expect(statesOffer("सब्सिडी उपलब्ध")).toBe(true);
  });
});
