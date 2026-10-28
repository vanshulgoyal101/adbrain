import { describe, expect, it } from "vitest";
import { extractSiteName, nameInText, PASTED_TEXT_MAX, pastedBrandText, phoneInText } from "@/lib/brand/autofill";

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

// #1379 (QA 2's #1365 walks): autofill filled everything but the required name, so every prospect stopped at Save.
describe("nameInText", () => {
  it.each([
    ["Sweet Crumbs Bakery 🍰 Mohali Phase 7 | Eggless cakes, custom orders", "Sweet Crumbs Bakery"],
    ["SunPeak Solar\nRooftop solar for homes in Jaipur", "SunPeak Solar"],
    ["Glow Salon · Unisex salon in Sector 17", "Glow Salon"],
    ["SunPeak Solar: rooftop solar for homes in Jaipur", "SunPeak Solar"],
    ["Sharma Dental Clinic - Painless root canals in Panchkula", "Sharma Dental Clinic"],
    ["We make the best eggless cakes in Mohali for every birthday and anniversary", undefined],
    ["🍰🍰 | cakes", undefined],
  ])("%s → %s", (text, name) => {
    expect(nameInText(text)).toBe(name);
  });
});

describe("extractSiteName", () => {
  const page = (head: string) => `<html><head>${head}</head><body>Rooftop solar</body></html>`;
  it.each([
    ['<meta property="og:site_name" content="Solaride"><title>Home | Solar panels</title>', "Solaride"],
    ["<title>Home | Solaride</title>", "Solaride"],
    ["<title>Solaride – Rooftop solar in Chandigarh</title>", "Solaride"],
    ['<meta name="application-name" content="Glow Salon"><title>Welcome</title>', "Glow Salon"],
    ["<title>Welcome</title>", undefined],
    ["", undefined],
  ])("%s → %s", (head, name) => {
    expect(extractSiteName(page(head))).toBe(name);
  });
});
