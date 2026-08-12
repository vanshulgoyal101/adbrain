import { describe, expect, it } from "vitest";
import {
  AD_LANGUAGES,
  getAdLanguage,
  languageLabel,
  languagePromptName,
} from "@/lib/languages";
import { buildCopyMessages, SOLAR_ANGLES } from "@/lib/templates/solar";

describe("ad languages", () => {
  it("offers the Indian-market set including Hinglish", () => {
    const ids = AD_LANGUAGES.map((l) => l.id);
    expect(ids).toEqual(
      expect.arrayContaining(["brand", "en", "hinglish", "hi", "pa", "pa_roman"]),
    );
  });

  it("resolves ids and returns undefined for unknown/null", () => {
    expect(getAdLanguage("hi")?.label).toContain("Hindi");
    expect(getAdLanguage("nope")).toBeUndefined();
    expect(getAdLanguage(null)).toBeUndefined();
  });

  it("maps ids to an LLM prompt name (empty for brand default)", () => {
    expect(languagePromptName("brand")).toBe("");
    expect(languagePromptName(null)).toBe("");
    expect(languagePromptName("hinglish")).toMatch(/Roman/i);
    expect(languagePromptName("hi")).toMatch(/Devanagari/i);
  });

  it("labels only non-default, non-English languages for badges", () => {
    expect(languageLabel("brand")).toBe("");
    expect(languageLabel("en")).toBe("");
    expect(languageLabel("hi")).toContain("Hindi");
    expect(languageLabel("pa")).toContain("Punjabi");
  });
});

describe("buildCopyMessages language override", () => {
  const brand = { name: "Solaride", languages: ["English"] };
  const angle = SOLAR_ANGLES[0];

  it("uses the explicit language when provided", () => {
    const msgs = buildCopyMessages(
      brand,
      "festive offer",
      angle,
      undefined,
      languagePromptName("hinglish"),
    );
    expect(msgs[1].content).toMatch(/Write ONE ad in Hinglish/i);
  });

  it("falls back to the brand languages when none is given", () => {
    const msgs = buildCopyMessages(brand, "brief", angle);
    expect(msgs[1].content).toMatch(/Write ONE ad in English/);
  });
});
