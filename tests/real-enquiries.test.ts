import { describe, expect, it } from "vitest";
import { attachRealEnquiries, costPerRealEnquiry } from "@/lib/campaign/real-enquiries";
import type { CampaignResult } from "@/lib/types";

const result = (spend: number) => ({ id: "r", campaign_id: "c", spend, impressions: 3, clicks: 0, leads: 0, cpl: null, fetched_at: "2026-10-24T00:00:00Z" }) as unknown as CampaignResult;

describe("real WhatsApp enquiries on campaign results (#335)", () => {
  it("adds each campaign's logged enquiries to its latest result, and zero to the rest", () => {
    const results = { a: result(140), b: result(30) };
    const rows = [{ campaign_id: "a" }, { campaign_id: "a" }, { campaign_id: "x" }, { campaign_id: null }];
    expect(attachRealEnquiries(results, rows)).toEqual({ a: { ...results.a, real_enquiries: 2 }, b: { ...results.b, real_enquiries: 0 } });
    expect(results.a).not.toHaveProperty("real_enquiries");
  });

  it("divides spend by real enquiries, and has no cost before the first one", () => {
    expect(costPerRealEnquiry(140, 2)).toBe(70);
    expect(costPerRealEnquiry(1.37, 1)).toBe(1.37);
    expect(costPerRealEnquiry(140, 0)).toBeNull();
    expect(costPerRealEnquiry(0, 3)).toBe(0);
  });
});
