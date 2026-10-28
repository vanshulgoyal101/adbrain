import { describe, expect, it } from "vitest";
import { brandUsable } from "@/lib/brand/usable";

describe("brandUsable (#1136)", () => {
  const full = { name: "Solaride", vertical: "Solar", phone: "+91 98765 43210", locations: ["Chandigarh"], offers: ["Free site survey"] };
  it("needs a name, category, area, phone and offer", () => {
    expect(brandUsable(full)).toBe(true);
    for (const missing of [{ name: " " }, { vertical: null }, { phone: "" }, { locations: [" "] }, { offers: [] }]) {
      expect(brandUsable({ ...full, ...missing })).toBe(false);
    }
  });
});
