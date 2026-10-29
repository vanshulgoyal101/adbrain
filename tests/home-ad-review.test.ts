import { describe, expect, it } from "vitest";
import { homeAdReview } from "@/lib/campaign/home-ad-review";

const campaign = (id: string, over: Record<string, unknown> = {}) => ({
  id, status: "active", meta_campaign_id: `9${id.length}${id.charCodeAt(0)}`, created_at: "2026-10-28T10:00:00Z", raw: {}, ...over,
}) as never;

describe("homeAdReview (#1469)", () => {
  it("says Meta is checking while every ad of the newest live campaign is in review", () => {
    expect(homeAdReview([campaign("a")], { a: ["PENDING_REVIEW", "IN_PROCESS"] }, {})).toEqual({ kind: "checking", campaignId: "a" });
  });

  it("says Meta is checking right after launch, before any ad status is synced and nothing has delivered", () => {
    expect(homeAdReview([campaign("a")], {}, {})).toEqual({ kind: "checking", campaignId: "a" });
    expect(homeAdReview([campaign("a")], {}, { a: { impressions: 0 } as never })).toEqual({ kind: "checking", campaignId: "a" });
  });

  it("stops once an ad is approved or the campaign has delivered", () => {
    expect(homeAdReview([campaign("a")], { a: ["PENDING_REVIEW", "ACTIVE"] }, {})).toBeNull();
    expect(homeAdReview([campaign("a")], {}, { a: { impressions: 12 } as never })).toBeNull();
  });

  it("flags rejected ads when Meta disapproved any ad, even with others running", () => {
    expect(homeAdReview([campaign("a")], { a: ["DISAPPROVED", "ACTIVE"] }, {})).toEqual({ kind: "rejected", campaignId: "a" });
    expect(homeAdReview([campaign("a", { status: "paused" })], { a: ["DISAPPROVED"] }, {})).toEqual({ kind: "rejected", campaignId: "a" });
  });

  it("ignores replaced ads, and only says checking for a campaign that is on", () => {
    expect(homeAdReview([campaign("a")], { a: ["IN_PROCESS", "DELETED", "ARCHIVED"] }, {})).toEqual({ kind: "checking", campaignId: "a" });
    expect(homeAdReview([campaign("a", { status: "paused" })], { a: ["IN_PROCESS"] }, {})).toBeNull();
  });

  it("reads only the newest launched campaign that is still in Meta", () => {
    const older = campaign("old", { created_at: "2026-10-01T00:00:00Z" });
    const draft = campaign("draft", { status: "draft", meta_campaign_id: null, created_at: "2026-10-29T00:00:00Z" });
    const gone = campaign("gone", { created_at: "2026-10-28T12:00:00Z", raw: { metaStatus: "DELETED" } });
    const ended = campaign("ended", { status: "completed", created_at: "2026-10-28T11:00:00Z" });
    expect(homeAdReview([draft, gone, ended, older], { old: ["DISAPPROVED"], gone: ["IN_PROCESS"] }, {})).toEqual({ kind: "rejected", campaignId: "old" });
    expect(homeAdReview([draft], {}, {})).toBeNull();
  });
});
