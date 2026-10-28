import { describe, expect, it } from "vitest";
import { OCCASIONS, occasionIdeas, occasionsFor } from "@/lib/seasonal";

const at = (iso: string) => occasionIdeas("Sharma Dental", new Date(iso));
const labels = (iso: string) => at(iso).map((s) => s.label);

describe("occasionIdeas (#700)", () => {
  it.each([
    ["2027-01-01T06:00:00Z", ["New Year", "Wedding season"]],
    ["2027-01-14T06:00:00Z", ["Makar Sankranti / Pongal / Lohri", "Wedding season"]],
    ["2027-01-24T06:00:00Z", ["Republic Day", "Wedding season"]],
    ["2027-02-10T06:00:00Z", ["Valentine's Day"]],
    ["2027-03-22T06:00:00Z", ["Holi"]],
    ["2027-05-01T06:00:00Z", ["Summer season"]],
    ["2027-06-10T06:00:00Z", ["Back to school"]],
    ["2027-07-15T06:00:00Z", ["Monsoon season"]],
    ["2026-08-15T06:00:00Z", ["Independence Day"]],
    ["2026-10-26T06:00:00Z", ["Diwali festive season", "Chhath Puja"]],
    // #1210: November's festivals come before the long seasons.
    ["2026-11-10T06:00:00Z", ["Diwali festive season", "Chhath Puja"]],
    ["2026-11-17T06:00:00Z", ["Chhath Puja", "Guru Nanak Jayanti"]],
    ["2026-11-20T06:00:00Z", ["Guru Nanak Jayanti", "Wedding season"]],
    ["2026-12-01T06:00:00Z", ["Wedding season", "Winter season"]],
    ["2026-12-20T06:00:00Z", ["Christmas", "Wedding season"]],
  ])("on %s shows %j", (iso, expected) => {
    expect(labels(iso)).toEqual(expected);
  });

  it("shows nothing between occasions", () => {
    expect(at("2026-09-10T06:00:00Z")).toEqual([]);
    expect(at("2026-08-20T06:00:00Z")).toEqual([]);
  });

  it("covers every day of the year with at most the max, and every occasion appears", () => {
    const seen = new Set<string>();
    for (let d = 0; d < 366; d++) {
      const ideas = occasionIdeas("X", new Date(Date.UTC(2028, 0, 1, 6) + d * 86_400_000));
      expect(ideas.length).toBeLessThanOrEqual(2);
      ideas.forEach((idea) => seen.add(idea.id));
    }
    expect(seen).toEqual(new Set(OCCASIONS.map((o) => `occasion-${o.id}`)));
  });

  it("uses the IST calendar day, not the host timezone", () => {
    // 20:00 UTC on 14 Aug is 01:30 IST on 15 Aug: still Independence Day.
    expect(labels("2026-08-14T20:00:00Z")).toContain("Independence Day");
    // 19:00 UTC on 15 Aug is 00:30 IST on 16 Aug: past it.
    expect(labels("2026-08-15T19:00:00Z")).not.toContain("Independence Day");
  });

  it("fills the goal in the owner's plain words and never asserts a sale, discount or deadline (#1153, #1210)", () => {
    for (let d = 0; d < 366; d++) {
      for (const idea of occasionIdeas("Sharma Dental", new Date(Date.UTC(2028, 0, 1, 6) + d * 86_400_000))) {
        expect(idea.prompt).toBe(`An ad for ${OCCASIONS.find((o) => idea.id === `occasion-${o.id}`)!.name} from Sharma Dental.`);
        expect(idea.prompt).not.toMatch(/\b(sale|discount|deadline|off|limited|clearance|free|saved offers|add no)\b/i);
        expect(`${idea.label} ${idea.prompt}`.length).toBeLessThanOrEqual(500);
      }
    }
  });

  it("respects max and falls back to a generic brand name", () => {
    expect(occasionIdeas("Shop", new Date("2026-12-20T06:00:00Z"), 1)).toHaveLength(1);
    expect(occasionIdeas("  ", new Date("2026-10-26T06:00:00Z"))[0].prompt).toContain("from my business");
  });
});

describe("occasionsFor (#679)", () => {
  const diwali = new Date("2026-10-26T06:00:00Z");
  it("offers Indian occasions to an Indian business or one without a phone, and none abroad", () => {
    expect(occasionsFor({ name: "Solaride", phone: "+91 73802 80874" }, diwali).map((idea) => idea.label)).toEqual(["Diwali festive season", "Chhath Puja"]);
    expect(occasionsFor({ name: "Solaride", phone: null }, diwali)).toHaveLength(2);
    expect(occasionsFor({ name: "Cedar Ridge", phone: "+1 512 555 0142" }, diwali)).toEqual([]);
  });
});
