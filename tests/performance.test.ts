import { describe, expect, it } from "vitest";
import {
  buildPerformanceContext,
  type CampaignPerf,
} from "@/lib/campaign/performance";

const base: CampaignPerf = {
  name: "C",
  angles: [],
  area: null,
  dailyBudget: null,
  leads: 0,
  spend: 0,
  cpl: null,
  status: "paused",
};

describe("buildPerformanceContext", () => {
  it("returns empty when no campaign has spent or produced leads", () => {
    expect(buildPerformanceContext([{ ...base }, { ...base }])).toBe("");
  });

  it("summarises a campaign with results", () => {
    const out = buildPerformanceContext([
      {
        ...base,
        name: "Festive Hisar",
        angles: ["savings"],
        area: "Hisar",
        dailyBudget: 300,
        leads: 14,
        spend: 266,
        cpl: 19,
      },
    ]);
    expect(out).toContain('"Festive Hisar"');
    expect(out).toContain("angle savings");
    expect(out).toContain("Hisar");
    expect(out).toContain("₹300/day");
    expect(out).toContain("14 leads at ₹19 per lead");
  });

  it("ranks more leads first, then cheaper cost-per-lead", () => {
    const out = buildPerformanceContext([
      { ...base, name: "Few", leads: 2, spend: 100, cpl: 50 },
      { ...base, name: "Many", leads: 10, spend: 300, cpl: 30 },
      { ...base, name: "CheapTie", leads: 10, spend: 200, cpl: 20 },
    ]);
    const order = ["Many", "CheapTie", "Few"].map((n) => out.indexOf(n));
    // CheapTie (same leads, lower CPL) should come before Many.
    expect(out.indexOf("CheapTie")).toBeLessThan(out.indexOf("Many"));
    expect(order.every((i) => i >= 0)).toBe(true);
  });

  it("excludes campaigns with no delivery from the summary", () => {
    const out = buildPerformanceContext([
      { ...base, name: "Ran", leads: 5, spend: 100, cpl: 20 },
      { ...base, name: "NeverRan", leads: 0, spend: 0 },
    ]);
    expect(out).toContain("Ran");
    expect(out).not.toContain("NeverRan");
  });

  it("notes spend with no leads", () => {
    const out = buildPerformanceContext([
      { ...base, name: "Spender", leads: 0, spend: 500 },
    ]);
    expect(out).toContain("₹500 spent, no leads yet");
  });
});
