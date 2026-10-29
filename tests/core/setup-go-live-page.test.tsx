// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Business, Creative } from "@/lib/types";

// #1271: which first-timers the Campaigns page sends to Go live, and the budget it carries to the review.
const m = vi.hoisted(() => ({
  getPrimaryBusiness: vi.fn(), getCampaignPage: vi.fn(), getLatestResultsWithEnquiries: vi.fn(async () => ({})),
  getApprovedCreatives: vi.fn(), getSpendLimits: vi.fn(async () => ({ weeklyCapRupees: 2000, alertPct: 80, autoPause: false })),
  getActiveCampaignBudgets: vi.fn(async () => []), getMetaConnection: vi.fn(), fundingMode: vi.fn(async () => "managed"),
  canUseMetaConnect: vi.fn(() => false), goLive: vi.fn(), campaigns: vi.fn(),
}));
vi.mock("@/lib/supabase/queries", () => m);
vi.mock("@/lib/meta/credentials", () => ({ getMetaConnection: m.getMetaConnection }));
vi.mock("@/lib/payments/operator-funding", () => ({ fundingMode: m.fundingMode }));
vi.mock("@/lib/meta/pilot-access", () => ({ canUseMetaConnect: m.canUseMetaConnect }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } }) }));
vi.mock("@/lib/meta/connection-access", () => ({ requireOwnedBusiness: async () => { throw new Error("skip drafts"); } }));
vi.mock("@/components/setup-go-live", () => ({ SetupGoLive: (props: unknown) => { m.goLive(props); return <div>Go live step</div>; } }));
vi.mock("@/components/campaigns", () => ({ Campaigns: (props: unknown) => { m.campaigns(props); return <div>Campaigns loaded</div>; } }));
vi.mock("next/navigation", async (actual) => ({ ...(await actual<typeof import("next/navigation")>()), redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
vi.mock("@/components/ready-ads-next-step", () => ({ ReadyAdsNextStep: () => <div>Ready ads next step</div> }));

const business = { id: "b1", name: "SunPeak", locations: ["Jaipur"], phone: "98765 43210" } as unknown as Business;
// Made by step 2 from today's step 1: its source fact is setupGoal(business) (#1432).
const ad = (id: string, goal = "Get WhatsApp enquiries for our business in Jaipur") =>
  ({ id, status: "approved", headline: id, image_url: null, generation: { sourceFacts: [goal] } }) as unknown as Creative;

async function page(params: Record<string, string>) {
  const { default: CampaignsPage } = await import("@/app/(app)/campaigns/page");
  render(await CampaignsPage({ searchParams: Promise.resolve(params) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  m.getPrimaryBusiness.mockResolvedValue(business);
  m.getCampaignPage.mockResolvedValue({ campaigns: [], nextCursor: null });
  m.getApprovedCreatives.mockResolvedValue([ad("a"), ad("b"), ad("c")]);
  m.getMetaConnection.mockResolvedValue({ ready: true, source: "oauth" });
});

describe("core: Campaigns → Go live for a first-timer (#1271)", () => {
  it("ready ads and no campaign yet: Go live with the picked ads, funding, masked WhatsApp and the cap", async () => {
    await page({ new: "1", creatives: "b,c" });
    expect(screen.getByText("Go live step")).toBeInTheDocument();
    expect(m.goLive.mock.calls[0][0]).toMatchObject({
      ads: [{ id: "b" }, { id: "c" }], pageConnected: true, funding: "managed", whatsappNumber: "+91 ••••• 3210",
      weeklyCap: { capRupees: 2000, active: [] },
    });
  });

  it("#1529: passes the welcome Go live sends (the Brand's saved message here)", async () => {
    m.getPrimaryBusiness.mockResolvedValue({ ...business, whatsapp_template: { greeting: "Namaste from SunPeak!", opening: { kind: "prefill", prefill: "I'd like a free site survey", callButton: false }, language: "en" } });
    await page({});
    expect(m.goLive.mock.calls[0][0].welcome).toEqual({ source: "saved", language: "en", greeting: "Namaste from SunPeak!", autofill: "I'd like a free site survey", callButton: false });
  });

  it("?all=1 opens the campaign review with Go live's budget; an amount not offered is ignored", async () => {
    await page({ all: "1", new: "1", review: "1", budget: "500", creatives: "a" });
    expect(m.campaigns.mock.calls[0][0].newCampaign).toEqual({ creativeIds: ["a"], review: true, budget: 500 });
    vi.clearAllMocks();
    m.getPrimaryBusiness.mockResolvedValue(business);
    m.getCampaignPage.mockResolvedValue({ campaigns: [], nextCursor: null });
    m.getApprovedCreatives.mockResolvedValue([ad("a")]);
    m.getMetaConnection.mockResolvedValue({ ready: true });
    document.body.innerHTML = "";
    await page({ all: "1", new: "1", budget: "99999", creatives: "a" });
    expect(m.campaigns.mock.calls[0][0].newCampaign.budget).toBeUndefined();
  });

  it("#1432: approved ads made from an earlier step 1 (or outside the setup) send the owner back to step 2", async () => {
    m.getApprovedCreatives.mockResolvedValue([ad("old", "Get WhatsApp enquiries for rooftop solar in Mohali, leading with: Free site survey"),
      { ...ad("studio"), generation: { sourceFacts: [] } }]);
    await expect(page({})).rejects.toThrow("redirect:/create");
    m.getApprovedCreatives.mockResolvedValue([ad("old", "Get WhatsApp enquiries for rooftop solar in Mohali"), ad("new")]);
    await page({});
    expect(m.goLive.mock.calls[0][0].ads).toEqual([expect.objectContaining({ id: "new" })]);
  });

  it("#1934: ?again=1 opens Go live even with campaigns, budget nearest the last one's; no current ads goes back to step 2 again", async () => {
    m.getCampaignPage.mockResolvedValue({ campaigns: [
      { id: "old", status: "paused", daily_budget: 2000, created_at: "2026-09-01T00:00:00Z" },
      { id: "last", status: "completed", daily_budget: 480, created_at: "2026-10-20T00:00:00Z" },
    ], nextCursor: null });
    await page({ again: "1", creatives: "a" });
    expect(m.goLive.mock.calls[0][0]).toMatchObject({ returning: true, initialDaily: 500, ads: [{ id: "a" }] });
    m.getApprovedCreatives.mockResolvedValue([ad("old", "Get WhatsApp enquiries for rooftop solar in Mohali")]);
    await expect(page({ again: "1" })).rejects.toThrow("redirect:/create?again=1");
  });

  it("a business with a campaign keeps the Campaigns page", async () => {
    m.getCampaignPage.mockResolvedValue({ campaigns: [{ id: "c1", status: "paused" }], nextCursor: null });
    await page({});
    expect(screen.getByText("Campaigns loaded")).toBeInTheDocument();
  });

  it("before App Review an owner who can't connect still gets the ready-ads step (#336)", async () => {
    m.getMetaConnection.mockResolvedValue({ ready: false, source: "none" });
    await page({});
    expect(screen.getByText("Ready ads next step")).toBeInTheDocument();
    m.canUseMetaConnect.mockReturnValue(true);
    document.body.innerHTML = "";
    await page({});
    expect(screen.getByText("Go live step")).toBeInTheDocument();
  });
});
