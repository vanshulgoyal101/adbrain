import { describe, expect, it } from "vitest";
import {
  AD_ANGLES,
  buildCopyMessages,
  buildImagePrompt,
  getAngle,
  META_CTAS,
  type BrandContext,
} from "@/lib/templates/ads";

const brand: BrandContext = {
  name: "Solaride",
  vertical: "solar energy",
  brand_voice: "friendly, trustworthy",
  usps: ["25-year warranty", "subsidy handled"],
  languages: ["English", "Hindi"],
  locations: ["Pune"],
};

describe("ad templates", () => {
  it("exposes a non-empty angle library with unique ids", () => {
    expect(AD_ANGLES.length).toBeGreaterThanOrEqual(5);
    const ids = AD_ANGLES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("looks up an angle by id", () => {
    expect(getAngle("value")?.name).toBeTruthy();
    expect(getAngle("nope")).toBeUndefined();
  });

  it("builds copy messages that include brand, brief, angle, and CTA list", () => {
    const angle = AD_ANGLES[0];
    const messages = buildCopyMessages(brand, "Festive offer", angle);
    expect(messages[0].role).toBe("system");
    // industry drives the system prompt
    expect(messages[0].content).toContain("solar energy");
    const user = messages[1].content;
    expect(user).toContain("Solaride");
    expect(user).toContain("Festive offer");
    expect(user).toContain(angle.name);
    expect(user).toContain(META_CTAS[0]);
    // uses configured languages
    expect(user).toContain("English and Hindi");
  });

  it("falls back to a neutral industry when vertical is absent", () => {
    const generic: BrandContext = { name: "Acme" };
    const messages = buildCopyMessages(generic, "brief", AD_ANGLES[0]);
    expect(messages[0].content).toContain("local business");
  });

  it("builds an image prompt that forbids text and embeds industry + brief", () => {
    const prompt = buildImagePrompt(brand, "rooftop solar", AD_ANGLES[0]);
    expect(prompt.toLowerCase()).toContain("no text");
    expect(prompt).toContain("rooftop solar");
    expect(prompt).toContain("solar energy");
  });
});
