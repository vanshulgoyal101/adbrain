// @vitest-environment jsdom
// #2456: the activation review's states that had no UI test. They assert by role and visible text only, so a
// reworked summary (details behind a disclosure) keeps passing while each blocker stays on screen by default.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Campaigns } from "@/components/campaigns";
import type { Business, Campaign, Creative } from "@/lib/types";
import type { ConnectionDTO } from "@/lib/meta/connect-contracts";

const mocks = vi.hoisted(() => ({
  drafts: vi.fn(), status: vi.fn(),
  dialog: { current: null as null | { onConnected: (connection: ConnectionDTO) => void } },
}));
vi.mock("@/components/ui/confirm-dialog", () => ({ useConfirm: () => [async () => true, null] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/meta-connect/meta-connect-dialog", () => ({ MetaConnectDialog: (props: { onConnected: (connection: ConnectionDTO) => void }) => { mocks.dialog.current = props; return null; } }));
vi.mock("@/components/campaign-chat", () => ({ CampaignChat: () => null }));
vi.mock("@/lib/meta-connect-ui/client", () => ({ createMetaConnectClient: () => mocks, MetaConnectClientError: class extends Error {} }));

const business = { id: "11111111-1111-4111-8111-111111111111", owner_id: "owner-1", name: "Solar installer", locations: ["Jaipur"] } as Business;
const creative = { id: "22222222-2222-4222-8222-222222222222", headline: "Lower electricity bills", image_url: "/icon.png", status: "approved" } as Creative;
const selected = { adAccountId: "act_1", accountName: "Solar account", pageId: "page_1", pageName: "Solar Page", currency: "INR", timezoneName: "Asia/Kolkata", metaBusinessId: null };
const campaign = {
  id: "campaign-1", business_id: business.id, name: "Saved campaign", status: "paused", meta_campaign_id: "100", daily_budget: 500,
  meta_adset_id: "200", meta_ad_ids: ["301", "302"], meta_ad_account_id: "act_1", meta_page_id: "page_1", meta_connection_generation: 1,
  raw: { source: "campaign_operation", metaResult: { campaignId: "100", adSetIds: ["200"], adIds: ["301", "302"] } },
} as unknown as Campaign;

type Status = "ACTIVE" | "PAUSED";
function delivery(adSet: Status, ads: [Status, Status]) {
  return {
    campaign: { id: "100", status: "PAUSED", effectiveStatus: "PAUSED" },
    adSets: [{ id: "200", status: adSet, effectiveStatus: "CAMPAIGN_PAUSED", dailyBudgetPaise: 50000, pageId: "page_1", destinationType: "ON_AD", targeting: null }],
    ads: ads.map((status, index) => ({ id: `30${index + 1}`, status, effectiveStatus: "CAMPAIGN_PAUSED", adSetId: "200", creativeId: `40${index + 1}` })),
  };
}

async function openReview(review: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") return Response.json({ ok: true, status: "active" });
    if (url.startsWith("/api/payments/customer-balance")) return Response.json({});
    if (url === "/api/campaigns/campaign-1") return Response.json(review);
    return Response.json({ campaigns: [], nextCursor: null });
  }));
  render(<Campaigns business={business} approved={[creative]} initialCampaigns={[campaign]} initialResults={{}} leadForms={[]} leadFormError={null} metaReady={false} adAccountId="act_1" />);
  fireEvent.click(screen.getByRole("button", { name: "Resume" }));
  await act(async () => { mocks.dialog.current!.onConnected({ authorization: "connected", selected, generation: 1 } as ConnectionDTO); });
}

const patched = () => vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === "PATCH");

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  localStorage.setItem(`campaign-sync:${business.owner_id}:${business.id}:act_1`, String(Date.now()));
  mocks.drafts.mockResolvedValue([]);
  mocks.status.mockResolvedValue(null);
});

describe("activation review names what blocks it, on screen by default (#2456)", () => {
  it("some children on and some paused: says to make them match, and activation stays off", async () => {
    await openReview({ delivery: delivery("ACTIVE", ["ACTIVE", "PAUSED"]) });
    expect(await screen.findByText(/Some listed children are on and some are paused/)).toBeVisible();
    const button = screen.getByRole("button", { name: "Request activation" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(patched()).toBe(false);
  });

  it("a business funded on Meta with its children on: says it runs only with a total limit, and activation stays off", async () => {
    const funding = { spendCapPaise: 204237, amountSpentPaise: 4237, roomPaise: 200000, prepay: true };
    await openReview({ delivery: delivery("ACTIVE", ["ACTIVE", "ACTIVE"]), funding, spendLimitRequired: true });
    expect(await screen.findByText(/funded on Meta, so it runs only with a total limit/)).toBeVisible();
    const button = screen.getByRole("button", { name: "Request activation" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(patched()).toBe(false);
  });

  it("an ad the owner paused from the card doesn't block turning the rest back on (#1055)", async () => {
    await openReview({ delivery: delivery("ACTIVE", ["ACTIVE", "PAUSED"]), keptPaused: ["302"] });
    const button = await screen.findByRole("button", { name: "Request activation" });
    expect(button).toBeEnabled();
    expect(screen.queryByText(/Some listed children are on and some are paused/)).toBeNull();
  });

  it("a capped run says the ad the owner paused stays paused", async () => {
    await openReview({ delivery: delivery("PAUSED", ["PAUSED", "PAUSED"]), keptPaused: ["302"] });
    expect(await screen.findByText(/1 ad you paused from the card stays paused/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Approve total and activate" })).toBeEnabled();
  });
});
