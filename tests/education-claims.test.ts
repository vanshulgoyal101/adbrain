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

  // CPO (#1609, Oct 29): owners type the nukta precomposed, decomposed or not at all, and in Hinglish.
  it.each([
    ["पक्का वी\u091C\u093Cा", "पक्का वीज़ा"], // ज + nukta
    ["पक्का वी\u095Bा मिलेगा", "पक्का वीज़ा"], // precomposed ज़
    ["पक्का वीजा मिलेगा", "पक्का वीज़ा"], // no nukta
    ["ਪੱਕਾ ਵੀਜਾ", "ਪੱਕਾ ਵੀਜ਼ਾ"],
    ["ਪੱਕਾ ਵੀ\u0A5Bਾ", "ਪੱਕਾ ਵੀਜ਼ਾ"],
    ["Pakka visa milega", "pakka visa"],
    ["Visa pakka, apply today", "visa pakka"],
    ["वीजा पक्का समझो", "वीज़ा पक्का"],
    ["ਵੀ\u0A1C\u0A3Cਾ ਪੱਕਾ", "ਵੀਜ਼ਾ ਪੱਕਾ"],
    ["100% वी\u095Bा", "100% वीज़ा"],
  ])("flags %s whichever way the nukta is typed", (text, term) => {
    expect(flagged(text, "study abroad consultants")).toContain(term);
    expect(adPolicyHits([{ id: "a", headline: text }], "study abroad consultants").map((hit) => hit.term)).toContain(term);
  });

  it("flags fixed visa timelines and document fraud (CPO, Analyst #1514)", () => {
    expect(flagged("Visa in 30 days", "study abroad")).toContain("visa in ");
    expect(flagged("Visa interview practice every Saturday", "study abroad")).toEqual([]);
    expect(flagged("Experience certificate arranged", "immigration consultant")).toContain("experience certificate");
    expect(flagged("No IELTS needed for some universities", "study abroad")).toEqual([]);
    // Review blocks the same whole phrase, not "visa interview".
    expect(adPolicyHits([{ id: "a", headline: "Visa in 30 days" }], "study abroad").map((hit) => hit.term)).toContain("visa in ");
    expect(adPolicyHits([{ id: "a", headline: "Visa interview practice" }], "study abroad")).toEqual([]);
    // #2452: "just" or "only" in front of the number is the same fixed timeline.
    expect(adPolicyHits([{ id: "a", headline: "Visa in just 30 days" }], "study abroad").map((hit) => hit.term)).toContain("visa in just ");
    expect(adPolicyHits([{ id: "a", headline: "Canada visa in only 2 weeks" }], "study abroad").map((hit) => hit.term)).toContain("visa in only ");
  });

  it("flags first-attempt promises (CPO, #1910 Ad Library sample)", () => {
    expect(flagged("Crack IELTS in 1st attempt", "IELTS coaching")).toContain("1st attempt");
    expect(flagged("Crack PTE in your First Attempt!", "PTE academy")).toContain("first attempt");
    expect(flagged("First attempt guaranteed", "IELTS coaching")).toEqual(expect.arrayContaining(["first attempt", "guaranteed"]));
    expect(adPolicyHits([{ id: "a", headline: "Crack it in 1st attempt" }], "IELTS coaching").map((hit) => hit.term)).toContain("1st attempt");
  });

  it("passes honest education copy", () => {
    expect(flagged("Free demo class in Mohali", "IELTS coaching")).toEqual([]);
    expect(flagged("Small batches, mock tests every week", "IELTS coaching")).toEqual([]);
    expect(flagged("IELTS batches in Mohali", "IELTS coaching")).toEqual([]);
  });

  it("applies to education verticals only; solar is unchanged and health keeps its own list", () => {
    for (const vertical of ["IELTS coaching", "PTE academy", "study abroad", "overseas education", "immigration consultant", "spoken English classes"])
      expect(bannedClaimsForVertical(vertical), vertical).toEqual(expect.arrayContaining(EDUCATION_BANNED_CLAIMS));
    expect(bannedClaimsForVertical("solar energy")).not.toContain("success rate");
    expect(bannedClaimsForVertical("dental clinic")).not.toContain("success rate");
  });
});
