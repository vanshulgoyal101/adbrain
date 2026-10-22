// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import reviewAccountExamples from "./fixtures/meta/safety/review-account-examples.json";
import reviewNewAd from "./fixtures/meta/safety/review-new-ad.json";
import { Campaigns } from "@/components/campaigns";
import { adReviewState } from "@/lib/meta/client";
import type { Business, Campaign } from "@/lib/types";

// #157: Meta's real review answers (recorded) as the owner sees them on Campaigns after "Refresh results".
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/meta-connect/meta-connect-dialog", () => ({ MetaConnectDialog: () => null }));
vi.mock("@/components/campaign-chat", () => ({ CampaignChat: () => null }));
vi.mock("@/lib/meta-connect-ui/client", () => ({
  createMetaConnectClient: () => ({ drafts: async () => [] }),
  MetaConnectClientError: class extends Error {},
}));

type Ad = Parameters<typeof adReviewState>[0];
const business = { id: "11111111-1111-4111-8111-111111111111", owner_id: "owner-1", name: "Solaride", locations: ["Delhi"] } as Business;
const launched = {
  id: "c1", business_id: business.id, name: "First lead campaign", status: "paused", daily_budget: 200, objective: "leads",
  meta_campaign_id: "120253654207670526", meta_ad_ids: [], creative_ids: [],
} as unknown as Campaign;

function showAfterRefresh(ads: Ad[]) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/refresh")
    ? Response.json({ result: { id: "r1", campaign_id: "c1", impressions: 0, clicks: 0, leads: 0, spend: 0, cpl: null }, review: ads.map(adReviewState) })
    : Response.json({ campaigns: [launched], results: {}, nextCursor: null })));
  render(<Campaigns business={business} approved={[]} initialCampaigns={[launched]} initialResults={{}}
    leadForms={[]} leadFormError={null} metaReady={false} adAccountId="act_2398686420592052" />);
  fireEvent.click(screen.getByRole("button", { name: /Refresh results/ }));
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem(`campaign-sync:${business.owner_id}:${business.id}:`, String(Date.now()));
});

describe("core: Campaigns shows Meta's ad review status (#157)", () => {
  it("a new ad shows as in Meta review", async () => {
    showAfterRefresh((reviewNewAd[0].body as { data: Ad[] }).data);
    expect(await screen.findByText("In Meta review")).toBeTruthy();
  });

  it("a rejected ad shows as rejected with Meta's own reason", async () => {
    const ads = (reviewAccountExamples[0].body as { data: Ad[] }).data;
    const rejected = ads.find(ad => ad.effective_status === "DISAPPROVED")!;
    const reason = adReviewState(rejected).reasons[0];
    showAfterRefresh([rejected, ads.find(ad => ad.effective_status === "PAUSED")!]);
    expect(await screen.findByText("Rejected by Meta (1 of 2 ads)")).toBeTruthy();
    expect(screen.getByText(reason)).toBeTruthy();
  });

  it("all ads approved shows approved", async () => {
    const ads = (reviewAccountExamples[0].body as { data: Ad[] }).data.filter(ad => ["PAUSED", "CAMPAIGN_PAUSED"].includes(ad.effective_status!));
    showAfterRefresh(ads);
    expect(await screen.findByText("Approved by Meta (2 of 2 ads)")).toBeTruthy();
  });
});
