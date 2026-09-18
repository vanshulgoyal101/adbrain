import { describe, expect, it } from "vitest";
import { buildPerformanceReport, type ReportRow } from "@/lib/campaign/report";

const row = (over: Partial<ReportRow>): ReportRow => ({
  name: "C",
  angles: [],
  area: null,
  dailyBudget: null,
  status: "paused",
  impressions: 0,
  clicks: 0,
  leads: 0,
  spend: 0,
  cpl: null,
  ...over,
});

describe("buildPerformanceReport", () => {
  const generatedAt = new Date("2026-08-12T00:00:00Z");
  it("separates WhatsApp spend and conversations from blended lead cost", () => {
    const md = buildPerformanceReport({ businessName: "Solaride", generatedAt, rows: [
      row({ name: "Forms", leads: 10, spend: 200, cpl: 20 }),
      row({ name: "Chats", conversations: 5, costPerConversation: 100, spend: 500 }),
    ] });
    expect(md).toContain("Blended cost per lead: ₹20");
    expect(md).toContain("Total spend: ₹700");
    expect(md).toContain("WhatsApp conversations started: 5");
    expect(md).toContain("Cost per WhatsApp conversation: ₹100");
  });

  it("includes a title, date, and summary totals", () => {
    const md = buildPerformanceReport({
      businessName: "Solaride",
      generatedAt,
      rows: [
        row({ name: "A", leads: 10, spend: 200, cpl: 20, impressions: 5000, clicks: 120 }),
        row({ name: "B", leads: 4, spend: 160, cpl: 40, impressions: 3000, clicks: 60 }),
      ],
    });
    expect(md).toContain("# AdBrain Performance Report — Solaride");
    expect(md).toContain("_Generated 2026-08-12_");
    expect(md).toContain("Total leads: 14");
    expect(md).toContain("Total spend: ₹360");
    // Blended CPL = 360/14 ≈ 26
    expect(md).toContain("Blended cost per lead: ₹26");
  });

  it("renders a table row per campaign and names the best", () => {
    const md = buildPerformanceReport({
      businessName: "Solaride",
      generatedAt,
      rows: [
        row({ name: "Winner", angles: ["savings"], leads: 10, spend: 200, cpl: 20 }),
        row({ name: "Loser", leads: 1, spend: 100, cpl: 100 }),
      ],
    });
    expect(md).toContain("| Winner |");
    expect(md).toContain("| Loser |");
    expect(md).toContain('**Best so far:** "Winner"');
    // Winner should be listed before Loser (ranked).
    expect(md.indexOf("| Winner |")).toBeLessThan(md.indexOf("| Loser |"));
  });

  it("handles no campaigns gracefully", () => {
    const md = buildPerformanceReport({
      businessName: "Solaride",
      generatedAt,
      rows: [],
    });
    expect(md).toContain("Campaigns: 0 (0 with delivery)");
    expect(md).toContain("Blended cost per lead: —");
  });

  it("keeps campaign names and multiline fields inside a single table row", () => {
    const md = buildPerformanceReport({
      businessName: "Solaride\n## Fake heading",
      generatedAt,
      rows: [row({ name: "SOLARIDE | CHD-PKL | Lead forms", angles: ["Cost | savings"], area: "Chandigarh\r\nPanchkula" })],
    });
    expect(md).toContain("| SOLARIDE \\| CHD-PKL \\| Lead forms | Cost \\| savings | Chandigarh Panchkula |");
    expect(md.split("\n").filter(line => line.startsWith("|"))).toHaveLength(3);
    expect(md).not.toContain("\n## Fake heading");
  });

  it("escapes HTML and formatting in report text", () => {
    const md = buildPerformanceReport({ businessName: "<b>Brand</b>", generatedAt, rows: [row({ name: "**Winner**", angles: ["[Offer](https://example.test)"], leads: 1, cpl: 20, spend: 20 })] });
    expect(md).toContain("&lt;b&gt;Brand&lt;/b&gt;");
    expect(md).toContain('**Best so far:** "\\*\\*Winner\\*\\*"');
    expect(md).toContain("\\[Offer\\](https://example.test)");
  });

  it("counts impressions and clicks as delivery without inventing a lead winner", () => {
    const md = buildPerformanceReport({ businessName: "Solaride", generatedAt, rows: [row({ impressions: 100 }), row({ clicks: 1 }), row({ spend: 50 })] });
    expect(md).toContain("Campaigns: 3 (3 with delivery)");
    expect(md).toContain("Total spend: ₹50");
    expect(md).not.toContain("Best so far");
  });
});
