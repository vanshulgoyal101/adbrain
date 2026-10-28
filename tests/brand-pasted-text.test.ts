import { describe, expect, it } from "vitest";
import { PASTED_TEXT_MAX, pastedBrandText, phoneInText } from "@/lib/brand/autofill";

// #1317: what autofill reads from a pasted Instagram bio or Google listing.
describe("pastedBrandText", () => {
  it("collapses spacing, keeps line breaks, and caps the length", () => {
    expect(pastedBrandText("  SunPeak   Solar \n\n  Rooftop solar for homes in Jaipur and Ajmer, free site survey  ")).toBe("SunPeak Solar\nRooftop solar for homes in Jaipur and Ajmer, free site survey");
    expect(pastedBrandText("Solar panels and free surveys ".repeat(400))!.length).toBe(PASTED_TEXT_MAX);
  });
  it("refuses text too short to describe a business (letters, any script)", () => {
    expect(pastedBrandText("Hi! DM us 🙏 98290 12345")).toBeNull();
    expect(pastedBrandText("जयपुर में घरों के लिए रूफटॉप सोलर, मुफ़्त साइट सर्वे")).not.toBeNull();
  });
});

describe("phoneInText", () => {
  it.each([
    ["Call 98290 12345 today", "+919829012345"],
    ["WhatsApp: wa.me/919829012345", "+919829012345"],
    ["Phone +91 98290-12345", "+919829012345"],
    ["Landline 098290 12345", "+919829012345"],
    ["Since 2009, 1,200 rooftops", undefined],
    ["Order 123456789012345", undefined],
  ])("%s → %s", (text, phone) => {
    expect(phoneInText(text)).toBe(phone);
  });
});
