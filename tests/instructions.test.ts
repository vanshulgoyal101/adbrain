import { describe, expect, it } from "vitest";
import {
  buildCopyMessages,
  buildImagePrompt,
  SOLAR_ANGLES,
  type BrandContext,
} from "@/lib/templates/solar";

const brand: BrandContext = { name: "Solaride" };

describe("instruction injection", () => {
  it("includes customer instructions in copy messages", () => {
    const msgs = buildCopyMessages(
      brand,
      "brief",
      SOLAR_ANGLES[0],
      "Always mention 25-year warranty",
    );
    expect(msgs[1].content).toContain("CUSTOMER INSTRUCTIONS");
    expect(msgs[1].content).toContain("25-year warranty");
  });

  it("omits the instructions block when none provided", () => {
    const msgs = buildCopyMessages(brand, "brief", SOLAR_ANGLES[0]);
    expect(msgs[1].content).not.toContain("CUSTOMER INSTRUCTIONS");
  });

  it("includes instructions in the image prompt", () => {
    const prompt = buildImagePrompt(
      brand,
      "brief",
      SOLAR_ANGLES[0],
      "use warm tones",
    );
    expect(prompt).toContain("use warm tones");
    expect(prompt.toLowerCase()).toContain("no text");
  });
});
