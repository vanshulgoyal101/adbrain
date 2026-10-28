import { describe, expect, it } from "vitest";
import { adPolicyHits } from "@/lib/campaign/ad-policy";
import { bannedClaimsForVertical, EDUCATION_BANNED_CLAIMS, scanAdCopy } from "@/lib/creative/slopScan";

// #1609 (CPO, #1500): IELTS, study-abroad and visa ads never promise a band, a visa or a success rate.
const flagged = (text: string, vertical: string) =>
  scanAdCopy(text, { bannedClaims: bannedClaimsForVertical(vertical) }).filter((f) => f.rule === "banned-claim").map((f) => f.detail);

describe("education banned claims (#1609)", () => {
  it("flags band, visa and success-rate promises for an IELTS business", () => {
    expect(flagged("Band 7 guaranteed in 30 days", "IELTS coaching")).toContain("guaranteed");
    expect(flagged("100% visa success with our team", "IELTS coaching")).toContain("100% visa");
    expect(flagged("पक्का वीज़ा, गारंटी के साथ", "study abroad consultants")).toEqual(expect.arrayContaining(["गारंटी", "पक्का वीज़ा"]));
    expect(flagged("ਪੱਕਾ ਵੀਜ਼ਾ", "Canada visa consultant")).toContain("ਪੱਕਾ ਵੀਜ਼ਾ");
  });

  it("flags fixed visa timelines and document fraud (CPO, Analyst #1514)", () => {
    expect(flagged("Visa in 30 days", "study abroad")).toContain("visa in ");
    expect(flagged("Visa interview practice every Saturday", "study abroad")).toEqual([]);
    expect(flagged("Experience certificate arranged", "immigration consultant")).toContain("experience certificate");
    expect(flagged("No IELTS needed for some universities", "study abroad")).toEqual([]);
    // Review blocks the same whole phrase, not "visa interview".
    expect(adPolicyHits([{ id: "a", headline: "Visa in 30 days" }], "study abroad").map((hit) => hit.term)).toContain("visa in ");
    expect(adPolicyHits([{ id: "a", headline: "Visa interview practice" }], "study abroad")).toEqual([]);
  });

  it("passes honest education copy", () => {
    expect(flagged("Free demo class in Mohali", "IELTS coaching")).toEqual([]);
    expect(flagged("Small batches, mock tests every week", "IELTS coaching")).toEqual([]);
    expect(flagged("IELTS batches in Mohali", "IELTS coaching")).toEqual([]);
  });

  it("applies to education verticals only; solar is unchanged and health keeps its own list", () => {
    for (const vertical of ["IELTS coaching", "PTE academy", "study abroad", "overseas education", "immigration consultant", "spoken English classes"])
      expect(bannedClaimsForVertical(vertical), vertical).toEqual(expect.arrayContaining(EDUCATION_BANNED_CLAIMS));
    expect(bannedClaimsForVertical("solar energy")).toEqual([]);
    expect(bannedClaimsForVertical("dental clinic")).not.toContain("success rate");
  });
});
