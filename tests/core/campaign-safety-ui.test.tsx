// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
// The #157 campaign as AdBrain stored its launch: its recorded ad set and ad (safety fixtures), bound to the account.
const launched = {
  id: "c1", business_id: business.id, name: "First lead campaign", status: "paused", daily_budget: 200, objective: "leads",
  meta_campaign_id: "120253654207670526", meta_adset_id: "120253654208240526", meta_ad_ids: ["120253654209040526"], creative_ids: [],
  meta_ad_account_id: "act_9000000000000001", meta_page_id: "900000000000002", meta_connection_generation: 1,
  raw: { source: "campaign_operation", metaResult: { campaignId: "120253654207670526", adSetIds: ["120253654208240526"], adIds: ["120253654209040526"] } },
} as unknown as Campaign;

function showAfterRefresh(ads: Ad[]) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/refresh")
    ? Response.json({ result: { id: "r1", campaign_id: "c1", impressions: 0, clicks: 0, leads: 0, spend: 0, cpl: null }, review: ads.map(adReviewState) })
    : Response.json({ campaigns: [launched], results: {}, nextCursor: null })));
  render(<Campaigns business={business} approved={[]} initialCampaigns={[launched]} initialResults={{}}
    leadForms={[]} leadFormError={null} metaReady={false} adAccountId="act_9000000000000001" />);
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
    expect(await screen.findByText("In Meta's review")).toBeTruthy();
  });

  it("a rejected ad shows as rejected with Meta's own reason", async () => {
    const ads = (reviewAccountExamples[0].body as { data: Ad[] }).data;
    const rejected = ads.find(ad => ad.effective_status === "DISAPPROVED")!;
    const reason = adReviewState(rejected).reasons[0];
    showAfterRefresh([rejected, ads.find(ad => ad.effective_status === "PAUSED")!]);
    expect(await screen.findByText("Rejected by Meta (1 of 2 ads)")).toBeTruthy();
    // #1274: the owner's sentence leads; Meta's own reason stays on the card under Details.
    expect(screen.getByText(/^Meta didn't approve 1 ad\. /)).toBeTruthy();
    expect(screen.getByText(`Meta's message: “${reason}”`)).toBeTruthy();
  });

  it("all ads approved shows approved", async () => {
    const ads = (reviewAccountExamples[0].body as { data: Ad[] }).data.filter(ad => ["PAUSED", "CAMPAIGN_PAUSED"].includes(ad.effective_status!));
    showAfterRefresh(ads);
    expect(await screen.findByText("Approved by Meta (2 of 2 ads)")).toBeTruthy();
  });
});

describe("Campaigns: a campaign with no spend says so once (#173)", () => {
  it.each([
    ["paused", { status: "paused" }, "Paused — nothing has spent. Resume when you're ready."],
    ["active", { status: "active" }, "Waiting for Meta to start delivery."],
    // #662: a synced campaign can't be resumed here, so the card doesn't invite it.
    ["synced paused", { status: "paused", raw: null }, "Paused — nothing has spent."],
  ])("a %s zero-spend card shows exactly one no-spend message after Refresh results", async (_case, change, message) => {
    const campaign = { ...launched, ...change } as Campaign;
    const result = { id: "r1", campaign_id: "c1", impressions: 0, clicks: 0, leads: 0, spend: 0, cpl: null };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/refresh")
      ? Response.json({
        result,
        summary: "No delivery yet — this campaign hasn't spent or shown to anyone. It may be paused or still in review.",
        review: [],
      })
      : Response.json({ campaigns: [campaign], results: { c1: result }, nextCursor: null })));
    render(<Campaigns business={business} approved={[]} initialCampaigns={[campaign]} initialResults={{}}
      leadForms={[]} leadFormError={null} metaReady={false} adAccountId="act_9000000000000001" />);
    // #1003: a running card first refreshes itself quietly; the owner's tap comes once that read is back.
    await waitFor(() => expect(screen.getByRole("button", { name: /Refresh results/ })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /Refresh results/ }));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryAllByText(/spen[dt]|deliver|Next step/i)).toHaveLength(1);
  });
});

// #721 (QA): #499's first tree was deleted in Meta, but its card stayed "paused" and every Refresh failed.
// The refresh route now answers 410 with the ended row (manage-routes.test.ts drives it on the recorded reads).
describe("core: a campaign deleted in Meta shows as deleted after Refresh (#721)", () => {
  it("the card says Deleted in Meta, not paused, and explains why there are no new results", async () => {
    const message = "This campaign was deleted in Meta, so it has no new results. AdBrain moved it to ended campaigns.";
    const ended = { ...launched, status: "completed", raw: { ...(launched.raw as object), metaStatus: "DELETED" } };
    let stored = launched;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (!String(input).endsWith("/refresh")) return Response.json({ campaigns: [stored], results: {}, nextCursor: null });
      stored = ended as Campaign;
      return Response.json({ error: message, gone: "DELETED", campaign: ended }, { status: 410 });
    }));
    render(<Campaigns business={business} approved={[]} initialCampaigns={[launched]} initialResults={{}}
      leadForms={[]} leadFormError={null} metaReady={false} adAccountId="act_9000000000000001" />);
    const card = screen.getByRole("article", { name: "First lead campaign" });
    fireEvent.click(within(card).getByRole("button", { name: /Refresh results/ }));
    expect(await within(card).findByText("Deleted in Meta")).toBeTruthy();
    expect(within(card).getByText(message)).toBeTruthy();
    expect(within(card).queryByText("paused")).toBeNull();
    // #1600 (CPO #1601): the card's own line, which stays after the notice.
    expect(within(card).getByText("This campaign was deleted in Meta Ads Manager, so it can't run or be changed here. Nothing more will spend. Its results up to then stay below.")).toBeTruthy();
    // Designer #1633: nothing to fetch any more, so no Refresh; ⋯ stays.
    expect(within(card).queryByRole("button", { name: /Refresh results/ })).toBeNull();
    expect(within(card).getByRole("button", { name: /More actions/ })).toBeTruthy();
  });
});

// CPO on #1255: a weak ad (it costs money) outranks one rejected ad of several (it doesn't); all rejected always shows.
describe("core: a weak ad outranks 1-of-N rejected on the card (#1274)", () => {
  const ad = (adId: string, over: Record<string, unknown>) => ({ adId, name: `Ad ${adId}`, delivered: true, replaced: false, best: false, creative: null, earlier: false, impressions: 1000, status: "ACTIVE", ...over });
  const rows = [ad("1", { best: true, results: 6, spend: 600, costPerResult: 100 }), ad("2", { results: 2, spend: 600, costPerResult: 300 })];
  function show(review: Ad[]) {
    const live = { ...launched, status: "active", destination: "whatsapp" } as Campaign;
    const result = { id: "r1", campaign_id: "c1", destination: "whatsapp", impressions: 9000, clicks: 90, leads: 0, conversations: 8, spend: 1200, cpl: null, fetched_at: new Date().toISOString() };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/refresh")) return Response.json({ result, review: review.map(adReviewState) });
      if (url.endsWith("/ads")) return Response.json({ ok: true, syncedAt: null, ads: rows });
      return Response.json({ campaigns: [live], results: { c1: result }, nextCursor: null });
    }));
    render(<Campaigns business={business} approved={[]} initialCampaigns={[live]} initialResults={{ c1: result } as never}
      leadForms={[]} leadFormError={null} metaReady={false} adAccountId="act_9000000000000001" adResults />);
    fireEvent.click(screen.getByRole("button", { name: /Refresh results/ }));
  }
  const rejected = { id: "a1", effective_status: "DISAPPROVED", ad_review_feedback: { global: { "Adult Content": "Suggestive." } } };

  it("1 of 2 rejected with a weak ad: the pause offer leads, the rejection waits", async () => {
    show([rejected, { id: "a2", effective_status: "ACTIVE" }]);
    expect(await screen.findByRole("button", { name: "Pause this ad" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("region", { name: "Ads Meta didn't approve" })).toBeNull());
  });

  it("every ad rejected: the rejection shows", async () => {
    show([rejected]);
    expect(await screen.findByRole("region", { name: "Ads Meta didn't approve" })).toBeTruthy();
  });
});
