// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/meta/ad-review.json";
import { adReviewState } from "@/lib/meta/client";
import { homeAdReview } from "@/lib/campaign/home-ad-review";
import type { Campaign } from "@/lib/types";

// #1469: Home decides from the stored effective statuses and, for a rejection, reads Meta's review once.
// Both come from Meta's recorded answer (#1305's tape).
type Exchange = { path: string; body: unknown };
const adsBody = (recorded.tape as Exchange[]).find((exchange) => exchange.path.includes("/ads?"))!.body as { data: Parameters<typeof adReviewState>[0][] };
const statuses = adsBody.data.map((ad) => ad.effective_status ?? null);

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/lib/meta/connection-access", () => ({
  requireOwnedBusiness: async () => ({ businessId: "b" }),
  withMetaConnection: async (_context: unknown, _options: unknown, run: (meta: { readAdReview: () => Promise<unknown> }) => unknown) =>
    run({ readAdReview: async () => adsBody.data.map(adReviewState) }),
}));

const campaign = {
  id: "c1", business_id: "b", status: "active", created_at: "2026-10-28T12:00:00Z", raw: {}, meta_campaign_id: recorded.campaignId,
  meta_ad_account_id: "act_9000000000000002", meta_page_id: "900000000000003", meta_connection_generation: 1,
} as unknown as Campaign;

describe("core: Home's Meta review line (#1469)", () => {
  it("the recorded disapproval makes Home show the rejected-ads sentence from Meta's own review", async () => {
    expect(statuses).toContain("DISAPPROVED");
    expect(homeAdReview([campaign], { c1: statuses }, {})).toEqual({ kind: "rejected", campaignId: "c1" });
    const { HomeRejectedAds } = await import("@/components/home-rejected-ads");
    render(await HomeRejectedAds({ campaign, spend: 0 }));
    expect(screen.getByRole("group", { name: "Ads Meta didn't approve" })).toHaveTextContent(/^Meta didn't approve your ad\. .*Nothing was spent\./);
  });

  it("the same ads still in review make Home say Meta is checking", () => {
    expect(homeAdReview([campaign], { c1: statuses.map(() => "PENDING_REVIEW") }, {})).toEqual({ kind: "checking", campaignId: "c1" });
  });
});
