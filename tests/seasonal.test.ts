import { describe, expect, it } from "vitest";
import { seasonalSuggestions } from "@/lib/seasonal";

describe("seasonalSuggestions", () => {
  it("surfaces Independence Day around 15 Aug", () => {
    const s = seasonalSuggestions(new Date("2026-08-15T10:00:00"));
    expect(s[0].label).toBe("Independence Day sale");
    expect(s[0].prompt).toMatch(/Independence Day/);
  });

  it("surfaces the festive/Diwali season in late October", () => {
    const s = seasonalSuggestions(new Date("2026-10-20T10:00:00"));
    expect(s.some((x) => /Diwali|Festive/i.test(x.label))).toBe(true);
  });

  it("handles the year-end-wrapping wedding-season window", () => {
    const dec = seasonalSuggestions(new Date("2026-12-20T10:00:00"));
    const jan = seasonalSuggestions(new Date("2026-01-30T10:00:00"));
    expect(dec.some((x) => /Wedding/i.test(x.label))).toBe(true);
    expect(jan.some((x) => /Wedding/i.test(x.label))).toBe(true);
  });

  it("falls back to evergreen ideas when nothing is in season", () => {
    // Early-mid September has no occasion window.
    const s = seasonalSuggestions(new Date("2026-09-10T10:00:00"));
    expect(s).toHaveLength(3);
    expect(s.every((x) => x.label && x.prompt)).toBe(true);
    expect(s.some((x) => x.label === "Weekend discount")).toBe(true);
  });

  it("returns unique labels and respects the max", () => {
    const s = seasonalSuggestions(new Date("2026-08-15T10:00:00"), 2);
    expect(s).toHaveLength(2);
    expect(new Set(s.map((x) => x.label)).size).toBe(2);
  });

  it("resolves the calendar day in IST, not the host timezone", () => {
    // 20:00 UTC on 14 Aug = 01:30 IST on 15 Aug -> still inside the
    // Independence Day window (8-15 Aug). This guards against the SSR/client
    // hydration mismatch a UTC server would otherwise cause.
    const stillInWindow = seasonalSuggestions(new Date("2026-08-14T20:00:00Z"));
    expect(stillInWindow.some((x) => /Independence Day/.test(x.label))).toBe(true);

    // 19:00 UTC on 15 Aug = 00:30 IST on 16 Aug -> past the window.
    const pastWindow = seasonalSuggestions(new Date("2026-08-15T19:00:00Z"));
    expect(pastWindow.some((x) => /Independence Day/.test(x.label))).toBe(false);
  });
});
