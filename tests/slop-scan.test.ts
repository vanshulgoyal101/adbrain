import { describe, it, expect } from "vitest";
import { scanAdCopy, isClean } from "@/lib/creative/slopScan";

describe("scanAdCopy", () => {
  it("passes clean, human-sounding solar copy", () => {
    expect(
      scanAdCopy(
        "Cut your electricity bill by 90% with rooftop solar. Free site survey in Mohali.",
        { maxWords: 60 },
      ),
    ).toEqual([]);
    expect(isClean("Book a free solar consultation today.")).toBe(true);
  });

  it("flags AI clichés", () => {
    const f = scanAdCopy("Unlock the power of solar and elevate your home");
    expect(f.some((x) => x.rule === "cliche" && x.detail === "unlock")).toBe(true);
    expect(f.some((x) => x.detail === "elevate")).toBe(true);
  });

  it("flags exclamation spam and all-caps shouting", () => {
    expect(
      scanAdCopy("SAVE BIG NOW! ACT FAST! LIMITED!").some((x) => x.rule === "exclamation-spam"),
    ).toBe(true);
    expect(scanAdCopy("HUGE MEGA SAVINGS today").some((x) => x.rule === "all-caps")).toBe(true);
  });

  it("enforces word cap", () => {
    const long = Array(70).fill("solar").join(" ");
    expect(scanAdCopy(long, { maxWords: 60 }).some((x) => x.rule === "too-long")).toBe(true);
  });

  it("enforces per-customer banned claims", () => {
    const f = scanAdCopy("Get a 20% discount this festive season", { bannedClaims: ["discount"] });
    expect(f.some((x) => x.rule === "banned-claim" && x.detail === "discount")).toBe(true);
  });

  it("allows a single em-dash but flags overuse", () => {
    expect(isClean("Solar — done right")).toBe(true);
    expect(scanAdCopy("Solar — clean — cheap — now").some((x) => x.rule === "em-dash-overuse")).toBe(
      true,
    );
  });
});
