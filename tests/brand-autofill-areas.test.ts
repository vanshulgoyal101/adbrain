import { describe, expect, it } from "vitest";
import { verifiedAreas } from "@/lib/brand/autofill";

describe("autofill service areas (#1037)", () => {
  const page = "Offices in Mohali and Hisar. We serve Panchkula, Zirakpur & Kharar. सेवा: लुधियाना. Serving all of North India.";

  it("keeps up to 5 places the page names, once each, in the model's order", () => {
    expect(verifiedAreas(["Mohali", "mohali", " Hisar ", "Panchkula", "Zirakpur", "Kharar", "लुधियाना"], page)).toEqual(["Mohali", "Hisar", "Panchkula", "Zirakpur", "Kharar"]);
  });

  it("drops places the page doesn't name, a whole country, compass regions and junk", () => {
    expect(verifiedAreas(["Delhi", "India", "North India", "Pan-India", "", 42, "x".repeat(61), "Mohal"], page)).toEqual([]);
    expect(verifiedAreas("Mohali", page)).toEqual([]);
    expect(verifiedAreas(["लुधियाना"], page)).toEqual(["लुधियाना"]);
  });
});
