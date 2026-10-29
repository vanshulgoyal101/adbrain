import { describe, expect, it } from "vitest";
import { brandMeter, specificOffer } from "@/lib/brand/meter";

const thin = { offers: ["Best service"], usps: [], description: null, target_audience: null };

describe("specificOffer (#2032)", () => {
  it.each([
    "मुफ़्त साइट सर्वे",
    "मुफ्त साइट सर्वे",
    "₹४९९ में पहली क्लास",
    "₹499 first class",
    "Free demo class",
    "Rs 2,999 deep clean",
    "muft site visit",
    "ਪਹਿਲੀ ਕਲਾਸ ੪੯੯ ਵਿੱਚ",
    "3 kW system",
    "फ्री डेमो",
    "Trial week",
    "Site survey at your home",
  ])("counts %s", (offer) => expect(specificOffer(offer)).toBe(true));

  it.each(["Best service", "Quality work, honest price", "", "  ", "Freedom from bills", "Demolition experts", "Mrs Sharma's kitchen"])(
    "does not count %j",
    (offer) => expect(specificOffer(offer)).toBe(false),
  );
});

describe("brandMeter (#2032)", () => {
  it("is out of 4 until the photo library ships, and asks for the offer first", () => {
    expect(brandMeter(thin)).toEqual({ known: 0, total: 4, next: "offer" });
  });

  it("asks for proof once the offer is specific", () => {
    expect(brandMeter({ ...thin, offers: ["Free site survey"] })).toEqual({ known: 1, total: 4, next: "proof" });
  });

  it("finds proof in the description, as preflight does", () => {
    expect(brandMeter({ ...thin, offers: ["Free site survey"], description: "Installing rooftops since 2015" }))
      .toEqual({ known: 2, total: 4, next: "why" });
  });

  it("checks only the first offer, the one Create leads with", () => {
    expect(brandMeter({ ...thin, offers: ["Best service", "Free demo"] }).next).toBe("offer");
  });

  it("asks for the audience last and hides at 4 of 4", () => {
    const full = { offers: ["Free site survey"], usps: ["200 rooftops since 2015"], description: null, target_audience: null };
    expect(brandMeter(full)).toEqual({ known: 3, total: 4, next: "audience" });
    expect(brandMeter({ ...full, target_audience: "Homeowners in Mohali" })).toEqual({ known: 4, total: 4, next: null });
  });

  it("ignores blank lines", () => {
    expect(brandMeter({ offers: ["Free demo"], usps: ["  "], description: " ", target_audience: " " }))
      .toEqual({ known: 1, total: 4, next: "proof" });
  });
});
