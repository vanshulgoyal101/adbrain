import { describe, expect, it } from "vitest";
import { brandDestination, brandUsable } from "@/lib/brand/usable";

describe("brandUsable (#1136)", () => {
  const full = { name: "Solaride", vertical: "Solar", phone: "+91 98765 43210", locations: ["Chandigarh"], offers: ["Free site survey"] };
  it("needs a name, category, area, phone and offer", () => {
    expect(brandUsable(full)).toBe(true);
    for (const missing of [{ name: " " }, { vertical: null }, { phone: "" }, { locations: [" "] }, { offers: [] }]) {
      expect(brandUsable({ ...full, ...missing })).toBe(false);
    }
  });

  it("#2646: a website business needs a working link instead of a phone", () => {
    const site = { ...full, phone: null, default_destination: "website" as const, website: "shop.example.in/offers" };
    expect(brandUsable(site)).toBe(true);
    for (const website of [null, " ", "not a link", "mailto:a@b.in"]) expect(brandUsable({ ...site, website })).toBe(false);
    for (const missing of [{ name: "" }, { locations: [] }, { offers: [" "] }]) expect(brandUsable({ ...site, ...missing })).toBe(false);
  });

  it("#2646: a WhatsApp business still needs its phone even with a website", () => {
    expect(brandUsable({ ...full, phone: null, website: "https://shop.example.in", default_destination: "whatsapp" })).toBe(false);
    expect(brandUsable({ ...full, phone: null, website: "https://shop.example.in" })).toBe(false);
  });
});

describe("brandDestination (#2646)", () => {
  it("reads a missing or unknown value as WhatsApp", () => {
    expect(brandDestination({})).toBe("whatsapp");
    expect(brandDestination({ default_destination: null })).toBe("whatsapp");
    expect(brandDestination({ default_destination: "call" as never })).toBe("whatsapp");
    expect(brandDestination({ default_destination: "website" })).toBe("website");
  });
});
