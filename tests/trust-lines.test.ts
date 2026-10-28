import { describe, expect, it } from "vitest";
import { activateTrustLine, connectTrustLine, firstEnquiryLine } from "@/lib/trust-lines";

describe("trust lines (#1292, CPO's exact words)", () => {
  it("at Connect, by who holds the ad money", () => {
    expect(connectTrustLine("own")).toBe("Your Page, your ad account, your card. AdBrain never holds your ad money.");
    expect(connectTrustLine("operator")).toBe("Your Page, your ad account, your card. AdBrain never holds your ad money.");
    expect(connectTrustLine("managed")).toBe("Your ad budget stays yours: you see every rupee spent.");
  });
  it("at Activate and for the first enquiry", () => {
    expect(activateTrustLine(300, 600)).toBe("₹300 a day, stops at ₹600. Pause any time.");
    expect(firstEnquiryLine("Rohit", "9:40 am")).toBe("Rohit tapped your ad at 9:40 am. Reply now; people often go with the first business that answers.");
    expect(firstEnquiryLine(null, "9:40 am")).toMatch(/^Someone tapped your ad/);
  });
});
