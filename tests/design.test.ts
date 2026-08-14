import { describe, expect, it } from "vitest";
import {
  AD_FORMATS,
  buildAdDesign,
  deriveContactLine,
  deriveSubhead,
  DEFAULT_BRAND_COLOR,
  formatDimensions,
  normalizeHex,
  pickBenefits,
  readableTextOn,
  shortenHeadline,
} from "@/lib/creative/design";
import type { BrandContext, GeneratedCopy } from "@/lib/templates/ads";

const brand: BrandContext = {
  name: "Solaride",
  vertical: "solar energy",
  primary_color: "#0b7a3b",
  usps: ["25-year warranty", "Govt. subsidy handled", "Free site survey"],
  offers: ["Zero-cost EMI", "25-year warranty"],
  locations: ["Mohali", "Hisar"],
  website: "https://www.solaride.in",
  logo_url: "https://cdn.example/logo.png",
};

const copy: GeneratedCopy = {
  headline: "Power your home with the sun ☀️",
  primary_text: "Clean energy & lifetime savings.\nBook a free survey today.",
  cta: "Get Quote",
};

describe("normalizeHex", () => {
  it("normalises 3- and 6-digit hex, with or without #", () => {
    expect(normalizeHex("#0B7A3B")).toBe("#0b7a3b");
    expect(normalizeHex("0b7a3b")).toBe("#0b7a3b");
    expect(normalizeHex("#abc")).toBe("#aabbcc");
  });

  it("falls back for missing or invalid input", () => {
    expect(normalizeHex(null)).toBe(DEFAULT_BRAND_COLOR);
    expect(normalizeHex("not-a-color")).toBe(DEFAULT_BRAND_COLOR);
    expect(normalizeHex("#12", "#000000")).toBe("#000000");
  });
});

describe("readableTextOn", () => {
  it("returns dark text on light colours and white on dark", () => {
    expect(readableTextOn("#ffffff")).toBe("#0f172a");
    expect(readableTextOn("#0b7a3b")).toBe("#ffffff");
    expect(readableTextOn("#000000")).toBe("#ffffff");
  });
});

describe("pickBenefits", () => {
  it("takes USPs first then offers, de-duplicated and capped", () => {
    const benefits = pickBenefits(brand, 4);
    expect(benefits).toContain("25-year warranty");
    expect(benefits).toContain("Govt. subsidy handled");
    // "25-year warranty" appears in both usps and offers — only once.
    expect(benefits.filter((b) => b === "25-year warranty")).toHaveLength(1);
    expect(benefits.length).toBeLessThanOrEqual(4);
  });

  it("returns an empty list when there is nothing to show", () => {
    expect(pickBenefits({ name: "Acme" })).toEqual([]);
  });

  it("clamps long benefits to whole words", () => {
    const [only] = pickBenefits(
      { name: "Acme", usps: ["Absolutely enormous unbelievable lifetime guarantee forever"] },
      1,
      24,
    );
    expect(only.length).toBeLessThanOrEqual(24);
    expect(only.endsWith(" ")).toBe(false);
  });
});

describe("deriveContactLine", () => {
  it("combines website host and first locality", () => {
    expect(deriveContactLine(brand)).toBe("solaride.in · Mohali");
  });

  it("uses whichever is available", () => {
    expect(deriveContactLine({ name: "Acme", locations: ["Pune"] })).toBe("Pune");
    expect(
      deriveContactLine({ name: "Acme", website: "acme.com" }),
    ).toBe("acme.com");
    expect(deriveContactLine({ name: "Acme" })).toBeNull();
  });
});

describe("deriveSubhead", () => {
  it("takes the first sentence, stripped of emoji", () => {
    expect(deriveSubhead(copy.primary_text)).toBe("Clean energy & lifetime savings.");
    expect(deriveSubhead("Save big 🎉 now")).toBe("Save big now");
    expect(deriveSubhead(null)).toBeNull();
    expect(deriveSubhead("   ")).toBeNull();
  });
});

describe("shortenHeadline", () => {
  it("strips emoji and clamps to whole words", () => {
    expect(shortenHeadline("Power your home with the sun ☀️")).toBe(
      "Power your home with the sun",
    );
    expect(shortenHeadline("A very very very very very long headline here", 20).length)
      .toBeLessThanOrEqual(20);
  });
});

describe("formatDimensions", () => {
  it("returns the right size per format and defaults to portrait", () => {
    expect(formatDimensions("square")).toEqual(AD_FORMATS.square);
    expect(formatDimensions("story")).toEqual({ width: 1080, height: 1920 });
    // @ts-expect-error — invalid format falls back
    expect(formatDimensions("bogus")).toEqual(AD_FORMATS.portrait);
  });
});

describe("buildAdDesign", () => {
  it("assembles a complete, self-consistent design spec", () => {
    const spec = buildAdDesign({ brand, copy, backgroundUrl: "https://img/bg.jpg" });
    expect(spec.format).toBe("portrait");
    expect(spec.width).toBe(1080);
    expect(spec.height).toBe(1350);
    expect(spec.backgroundUrl).toBe("https://img/bg.jpg");
    expect(spec.brandName).toBe("Solaride");
    expect(spec.logoUrl).toBe("https://cdn.example/logo.png");
    expect(spec.headline).toBe("Power your home with the sun");
    expect(spec.subhead).toBe("Clean energy & lifetime savings.");
    expect(spec.benefits.length).toBeGreaterThan(0);
    expect(spec.contactLine).toBe("solaride.in · Mohali");
    expect(spec.ctaLabel).toBe("Get Quote");
    expect(spec.primaryColor).toBe("#0b7a3b");
    expect(spec.ctaTextColor).toBe("#ffffff");
  });

  it("falls back sensibly for a bare brand", () => {
    const spec = buildAdDesign({
      brand: { name: "Acme" },
      copy: { headline: "", primary_text: "", cta: "" },
    });
    expect(spec.headline).toBe("Acme");
    expect(spec.ctaLabel).toBe("Learn More");
    expect(spec.primaryColor).toBe(DEFAULT_BRAND_COLOR);
    expect(spec.backgroundUrl).toBeNull();
    expect(spec.benefits).toEqual([]);
    expect(spec.contactLine).toBeNull();
  });

  it("honours a requested format", () => {
    const spec = buildAdDesign({ brand, copy, format: "story" });
    expect(spec.format).toBe("story");
    expect(spec.width).toBe(1080);
    expect(spec.height).toBe(1920);
  });
});
