import { describe, expect, it } from "vitest";
import {
  MEDICAL_BANNED_CLAIMS,
  bannedClaimsForVertical,
  scanAdCopy,
} from "@/lib/creative/slopScan";
import { deriveContactLine } from "@/lib/creative/design";
import type { BrandContext } from "@/lib/templates/ads";

const brand = (over: Partial<BrandContext> = {}): BrandContext => ({
  name: "Cedar Ridge Chiropractic",
  vertical: "chiropractic clinic",
  ...over,
});

describe("bannedClaimsForVertical", () => {
  it("applies the healthcare list to clinical verticals", () => {
    for (const v of [
      "chiropractic clinic",
      "dental clinic",
      "physiotherapy",
      "wellness studio",
      "dermatology hospital",
    ]) {
      expect(bannedClaimsForVertical(v).length, v).toBeGreaterThan(0);
    }
  });

  it("leaves non-health businesses untouched", () => {
    for (const v of ["solar energy", "gym", "restaurant", "law firm", ""]) {
      expect(bannedClaimsForVertical(v), v).toEqual([]);
    }
    expect(bannedClaimsForVertical(null)).toEqual([]);
    expect(bannedClaimsForVertical(undefined)).toEqual([]);
  });

  it("covers the claims that get health ads rejected", () => {
    for (const term of ["cure", "guaranteed", "pain-free", "miracle", "permanent fix"]) {
      expect(MEDICAL_BANNED_CLAIMS).toContain(term);
    }
  });
});

describe("scanAdCopy with healthcare claims", () => {
  const claims = bannedClaimsForVertical("chiropractic clinic");

  it("flags a promised cure", () => {
    const findings = scanAdCopy("We cure back pain for good", { bannedClaims: claims });
    expect(findings.some((f) => f.rule === "banned-claim")).toBe(true);
  });

  it("flags guarantees and miracle language regardless of case", () => {
    expect(
      scanAdCopy("GUARANTEED results", { bannedClaims: claims }).some(
        (f) => f.rule === "banned-claim",
      ),
    ).toBe(true);
    expect(
      scanAdCopy("A Miracle treatment", { bannedClaims: claims }).some(
        (f) => f.rule === "banned-claim",
      ),
    ).toBe(true);
  });

  it("flags both spellings of pain-free", () => {
    for (const text of ["Live pain-free", "Live pain free"]) {
      expect(
        scanAdCopy(text, { bannedClaims: claims }).some((f) => f.rule === "banned-claim"),
        text,
      ).toBe(true);
    }
  });

  it("passes compliant service-led copy", () => {
    const findings = scanAdCopy(
      "Chiropractic care in Austin. Same-day appointments for new patients.",
      { bannedClaims: claims, maxWords: 60 },
    );
    expect(findings).toEqual([]);
  });

  it("does not penalise a solar ad for the same words", () => {
    const findings = scanAdCopy("Guaranteed savings on your power bill", {
      bannedClaims: bannedClaimsForVertical("solar energy"),
    });
    expect(findings.some((f) => f.rule === "banned-claim")).toBe(false);
  });
});

describe("deriveContactLine", () => {
  it("leads with the phone number — the most actionable thing on a local ad", () => {
    expect(
      deriveContactLine(brand({ phone: "+1 512 555 0134", locations: ["Austin, Texas"] })),
    ).toBe("+1 512 555 0134 · Austin, Texas");
  });

  it("puts the phone ahead of the website", () => {
    expect(
      deriveContactLine(
        brand({ phone: "+1 512 555 0134", website: "https://example.com" }),
      ),
    ).toBe("+1 512 555 0134 · example.com");
  });

  it("still works for a brand with only a website and a city", () => {
    expect(
      deriveContactLine(
        brand({ website: "https://solaride.in", locations: ["Jaipur"] }),
      ),
    ).toBe("solaride.in · Jaipur");
  });

  it("falls back to the city alone", () => {
    expect(deriveContactLine(brand({ locations: ["Austin, Texas"] }))).toBe(
      "Austin, Texas",
    );
  });

  it("returns nothing when there is no contact detail at all", () => {
    expect(deriveContactLine(brand())).toBeNull();
  });

  it("never crowds the poster with more than two parts", () => {
    const line = deriveContactLine(
      brand({
        phone: "+1 512 555 0134",
        website: "https://example.com",
        locations: ["Austin, Texas"],
      }),
    );
    expect(line?.split(" · ")).toHaveLength(2);
  });

  it("ignores a blank phone", () => {
    expect(deriveContactLine(brand({ phone: "   ", locations: ["Austin"] }))).toBe(
      "Austin",
    );
  });
});
