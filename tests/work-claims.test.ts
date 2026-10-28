import { describe, expect, it } from "vitest";
import { copyClaimWarnings, WORK_CLAIM_WARNING, workClaims } from "@/lib/creative/concept";

// #1617 (CPO, #1501): "our work" under an AI picture passes generated work off as the owner's.
const copy = (primary_text: string) => ({ headline: "Modular kitchens", primary_text, description: "" });

describe("first-person work claims (#1617)", () => {
  it("finds English and Hindi work claims, not plain offers", () => {
    expect(workClaims("Kitchens we finished in Mohali")).toEqual(["we finished"]);
    expect(workClaims("See our projects. We installed 40 rooftops.")).toEqual(["our projects", "we installed"]);
    expect(workClaims("देखिए हमारा काम, हमने बनाया")).toEqual(["हमारा काम", "हमने बनाया"]);
    expect(workClaims("Modular kitchens in Mohali, free consultation")).toEqual([]);
    expect(workClaims("Ask about our workshop hours")).toEqual([]);
  });

  it("warns the owner only when the picture is generated", () => {
    expect(copyClaimWarnings(copy("Kitchens we finished in Mohali"), [], "interiors", { ownPicture: false })).toContain(WORK_CLAIM_WARNING);
    expect(copyClaimWarnings(copy("Kitchens we finished in Mohali"), [], "interiors", { ownPicture: true })).not.toContain(WORK_CLAIM_WARNING);
    expect(copyClaimWarnings(copy("Modular kitchens in Mohali, free consultation"), [], "interiors", { ownPicture: false })).not.toContain(WORK_CLAIM_WARNING);
  });

  it("calls an education term a promise, not a health claim (#1609)", () => {
    expect(copyClaimWarnings(copy("Band 7 guaranteed"), [], "IELTS coaching")).toContain("\"guaranteed\" is a promise Meta often rejects. Consider rewording it.");
    expect(copyClaimWarnings(copy("We heal back pain"), [], "chiropractic clinic")).toContain("\"heal\" is a health claim Meta often rejects. Consider rewording it.");
  });
});
