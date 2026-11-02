import { describe, expect, it } from "vitest";
import {
  buildPerformanceContext,
  type CampaignPerf,
} from "@/lib/campaign/performance";

const base: CampaignPerf = {
  destination: "instant_form",
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
  it("does not teach the planner that missing or unknown metrics are zero leads", () => {
    const out = buildPerformanceContext([
      { ...base, destination: "whatsapp", spend: 100 },
      { ...base, destination: "unknown", spend: 200, leads: 500 },
    ]);
    expect(out).toContain("WhatsApp conversation metrics unavailable");
    expect(out).toContain("comparable outcome metrics unavailable");
    expect(out).not.toContain("500 leads");
    expect(out).not.toContain("no leads yet");
  });

  it("keeps WhatsApp conversations distinct from leads in planner evidence", () => {
    const out = buildPerformanceContext([{ ...base, destination: "whatsapp", conversations: 5, costPerConversation: 20, spend: 100 }]);
    expect(out).toContain("5 WhatsApp conversations started at INR 20 per conversation");
    expect(out).toContain("not verified leads or sales");
    expect(out).not.toContain("no leads yet");
  });

  it("#2601: says a website campaign's result in visits, never as leads, and ranks it after leads and chats", () => {
    const out = buildPerformanceContext([
      { ...base, name: "Site", destination: "website", landingPageViews: 55, spend: 412.5 },
      { ...base, name: "Quiet site", destination: "website", landingPageViews: 0, spend: 90 },
      { ...base, name: "Chat", destination: "whatsapp", conversations: 5, costPerConversation: 20, spend: 100 },
      { ...base, name: "Form", destination: "instant_form", leads: 2, cpl: 50, spend: 100 },
    ]);
    expect(out).toContain("55 website visits (landing-page views) at INR 8 per visit; INR 413 spent. Visits are not enquiries.");
    expect(out).toContain("INR 90 spent, no website visits yet.");
    expect(out).not.toMatch(/no leads yet/);
    expect(out.split("\n").map((line) => line.slice(3, line.indexOf('"', 3)))).toEqual(["Form", "Chat", "Site", "Quiet site"]);
  });

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
