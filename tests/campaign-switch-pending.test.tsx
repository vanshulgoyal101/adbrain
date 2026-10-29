// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Campaigns } from "@/components/campaigns";
import type { ConnectionDTO } from "@/lib/meta/connect-contracts";
import type { Business, Campaign, Creative } from "@/lib/types";

// #1571 (QA red test for #1539): turning a campaign on while a new-audience copy waits answers 409 switch_pending.
// The card must say the server's words and offer the way out (Use / Cancel the new audience), not a generic error.
// Control: a different refusal shows its own words, so the assertions can tell messages apart.
const mocks = vi.hoisted(() => ({
  status: vi.fn(), drafts: vi.fn(async () => []),
  dialog: { current: null as null | { open?: boolean; onConnected: (connection: ConnectionDTO) => void } },
  waiting: [] as Array<{ id: string; campaign_id: string; sanitized_error: string | null }>,
}));
vi.mock("@/components/ui/confirm-dialog", () => ({ useConfirm: () => [async () => true, null] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/meta-connect/meta-connect-dialog", () => ({ MetaConnectDialog: (props: { open?: boolean; onConnected: (connection: ConnectionDTO) => void }) => { mocks.dialog.current = props; return null; } }));
vi.mock("@/components/campaign-chat", () => ({ CampaignChat: () => null }));
vi.mock("@/lib/meta-connect-ui/client", () => ({ createMetaConnectClient: () => mocks, MetaConnectClientError: class extends Error {} }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ from: () => ({ select: () => ({ eq: async () => ({ data: mocks.waiting, error: null }) }) }) }),
}));

const SWITCH_PENDING = "A new audience is waiting for this campaign. Turn it on or cancel it first.";
const business = { id: "11111111-1111-4111-8111-111111111111", owner_id: "owner-1", name: "Solar installer", locations: ["Jaipur"] } as Business;
const creative = { id: "22222222-2222-4222-8222-222222222222", headline: "Lower electricity bills", image_url: "/icon.png", status: "approved" } as Creative;
const selected = { adAccountId: "act_1", accountName: "Solar account", pageId: "page_1", pageName: "Solar Page", currency: "INR", timezoneName: "Asia/Kolkata", metaBusinessId: null };
const campaign = { id: "campaign-1", business_id: business.id, name: "Saved campaign", status: "paused", meta_campaign_id: "meta-1", daily_budget: 500,
  meta_adset_id: "set-1", meta_ad_ids: ["ad-1"], meta_ad_account_id: "act_1", meta_page_id: "page_1", meta_connection_generation: 1,
  raw: { source: "campaign_operation", metaResult: { campaignId: "meta-1", adSetIds: ["set-1"], adIds: ["ad-1"] } } } as unknown as Campaign;
const delivery = {
  campaign: { id: "meta-1", status: "PAUSED", effectiveStatus: "PAUSED" },
  adSets: [{ id: "set-1", status: "PAUSED", effectiveStatus: "CAMPAIGN_PAUSED", dailyBudgetPaise: 50000, pageId: "page_1", destinationType: "ON_AD", targeting: null }],
  ads: [{ id: "ad-1", status: "PAUSED", effectiveStatus: "CAMPAIGN_PAUSED", adSetId: "set-1", creativeId: "creative-1" }],
};

/** Opens the activation review from Resume and confirms it; the PATCH answers `refusal`. */
async function turnOn(refusal: { status: number; body: Record<string, unknown> }, onPatch: () => void = () => {}) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/payments/customer-balance")) return Response.json({});
    if (url === "/api/campaigns/campaign-1" && init?.method === "PATCH") { onPatch(); return Response.json(refusal.body, { status: refusal.status }); }
    if (url === "/api/campaigns/campaign-1") return Response.json({ delivery, learning: { costPerResultRupees: 69, pausedAt: null } });
    return Response.json({ campaigns: [], nextCursor: null });
  }));
  render(<Campaigns business={business} approved={[creative]} initialCampaigns={[campaign]} initialResults={{}} leadForms={[]} leadFormError={null} metaReady={false} adAccountId="act_1" />);
  fireEvent.click(await screen.findByRole("button", { name: "Resume" }));
  await act(async () => { mocks.dialog.current!.onConnected({ authorization: "connected", selected, generation: 1 } as ConnectionDTO); });
  fireEvent.click(await screen.findByRole("button", { name: "Approve total and activate" }));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([, call]) => call?.method === "PATCH")).toBe(true));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem(`campaign-sync:${business.owner_id}:${business.id}:`, String(Date.now()));
  mocks.status.mockResolvedValue({ authorization: "connected", selected, generation: 1, capabilities: {}, checkedAt: null });
  mocks.waiting = [];
});

describe("core: turn-on refused while a new audience waits (#1571, #1539)", () => {
  // #1588 (Designer): a card holding a pending decision owns the screen's one solid button; New campaign steps down.
  it("drops New campaign to outline while a new audience waits for the owner's decision", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ campaigns: [], nextCursor: null })));
    const { unmount } = render(<Campaigns business={business} approved={[creative]} initialCampaigns={[campaign]} initialResults={{}} leadForms={[]} leadFormError={null} metaReady={false} adAccountId="act_1" />);
    expect(screen.getByRole("button", { name: "New campaign" }).className).toContain("bg-primary");
    unmount();
    mocks.waiting = [{ id: "op-1", campaign_id: campaign.id, sanitized_error: null }];
    render(<Campaigns business={business} approved={[creative]} initialCampaigns={[campaign]} initialResults={{}} leadForms={[]} leadFormError={null} metaReady={false} adAccountId="act_1" />);
    await waitFor(() => expect(screen.getByRole("button", { name: "New campaign" }).className).not.toContain("bg-primary"));
  });

  it("control: another refusal shows its own words, not the switch line", async () => {
    await turnOn({ status: 409, body: { error: "Meta is busy with this campaign. Try again in a minute.", code: "busy" } });
    expect(await screen.findByText("Meta is busy with this campaign. Try again in a minute.")).toBeInTheDocument();
    expect(screen.queryByText(SWITCH_PENDING)).toBeNull();
  });

  it("switch_pending shows the server's line, not a generic error", async () => {
    await turnOn({ status: 409, body: { error: SWITCH_PENDING, code: "switch_pending", retryable: false } });
    expect(await screen.findByText(SWITCH_PENDING)).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't update the campaign|Something went wrong/)).toBeNull();
  });

  // #1576: the card re-reads the waiting list when the server says a copy waits.
  it("switch_pending offers the way out on the card, even when the copy appeared after the page loaded (#1576)", async () => {
    // The copy was made in another tab after this page read the waiting list; the server knows, the card doesn't yet.
    await turnOn({ status: 409, body: { error: SWITCH_PENDING, code: "switch_pending", retryable: false } },
      () => { mocks.waiting = [{ id: "op-1", campaign_id: "campaign-1", sanitized_error: null }]; });
    expect(await screen.findByText(SWITCH_PENDING)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Use the new audience" }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel new audience" })).toBeInTheDocument();
  });
});
