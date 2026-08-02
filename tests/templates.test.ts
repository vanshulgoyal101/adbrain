import { describe, expect, it } from "vitest";
import {
  buildCopyMessages,
  buildImagePrompt,
  getAngle,
  META_CTAS,
  SOLAR_ANGLES,
  type BrandContext,
} from "@/lib/templates/solar";

const brand: BrandContext = {
  name: "Solaride",
  brand_voice: "friendly, trustworthy",
  usps: ["25-year warranty", "subsidy handled"],
  languages: ["English", "Hindi"],
  locations: ["Pune"],
};

describe("solar templates", () => {
  it("exposes a non-empty angle library with unique ids", () => {
    expect(SOLAR_ANGLES.length).toBeGreaterThanOrEqual(5);
    const ids = SOLAR_ANGLES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("looks up an angle by id", () => {
    expect(getAngle("savings")?.name).toBeTruthy();
    expect(getAngle("nope")).toBeUndefined();
  });

  it("builds copy messages that include brand, brief, angle, and CTA list", () => {
    const angle = SOLAR_ANGLES[0];
    const messages = buildCopyMessages(brand, "Festive offer", angle);
    expect(messages[0].role).toBe("system");
    const user = messages[1].content;
    expect(user).toContain("Solaride");
    expect(user).toContain("Festive offer");
    expect(user).toContain(angle.name);
    expect(user).toContain(META_CTAS[0]);
    // uses configured languages
    expect(user).toContain("English and Hindi");
  });

  it("builds an image prompt that forbids text and embeds context", () => {
    const prompt = buildImagePrompt(brand, "rooftop solar", SOLAR_ANGLES[0]);
    expect(prompt.toLowerCase()).toContain("no text");
    expect(prompt).toContain("rooftop solar");
  });
});
