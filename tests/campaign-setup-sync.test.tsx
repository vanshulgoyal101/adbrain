// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Campaigns } from "@/components/campaigns";
import type { DraftDTO, DraftInput } from "@/lib/campaign/connect-contracts";
import type { Business, Campaign, Creative } from "@/lib/types";
import type { ConnectionDTO } from "@/lib/meta/connect-contracts";
// #403 S6: the confirm dialog has its own tests (confirm-dialog.test.tsx); here window.confirm stands in for the owner's answer.
vi.mock("@/components/ui/confirm-dialog", () => ({
  useConfirm: () => [async (options: { title: string; description?: string }) => window.confirm([options.title, options.description].filter(Boolean).join(" ")), null],
}));

const mocks = vi.hoisted(() => ({
  drafts: vi.fn(), draft: vi.fn(), saveDraft: vi.fn(), updateDraft: vi.fn(), status: vi.fn(), preflight: vi.fn(), createCampaign: vi.fn(), operationForRequest: vi.fn(),
  dialog: { current: null as null | { onConnected: (connection: ConnectionDTO) => void; onBeforeStart?: () => Promise<unknown> } },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/meta-connect/meta-connect-dialog", () => ({ MetaConnectDialog: (props: { onConnected: (connection: ConnectionDTO) => void; onBeforeStart?: () => Promise<unknown> }) => { mocks.dialog.current = props; return null; } }));
vi.mock("@/components/campaign-chat", () => ({ CampaignChat: () => <div data-testid="guided-campaign-chat" /> }));
vi.mock("@/lib/meta-connect-ui/client", () => ({ createMetaConnectClient: () => mocks, MetaConnectClientError: class extends Error {} }));

const business = { id: "11111111-1111-4111-8111-111111111111", owner_id: "owner-1", name: "Solar installer", locations: ["Jaipur"] } as Business;
const creative = { id: "22222222-2222-4222-8222-222222222222", headline: "Lower electricity bills", image_url: "/icon.png", status: "approved" } as Creative;
const recommended: DraftInput["targeting"] = {
  age: { mode: "manual", min: 30, max: 65 },
  location: { mode: "ai", includedNames: ["Jaipur"], excludedNames: ["Ajmer"], radiusKm: 20 },
  audience: { interestNames: ["Solar energy"], rationale: "Test local solar interest against the current offer." },
};
const selected = { adAccountId: "act_1", accountName: "Solar account", pageId: "page_1", pageName: "Solar Page", currency: "INR", timezoneName: "Asia/Kolkata", metaBusinessId: null };
// What AdBrain stores when it launches a campaign: its ad sets and ads, and the Meta account it's bound to (#662).
const launched = {
  meta_adset_id: "set-1", meta_ad_ids: ["ad-1"], meta_ad_account_id: "act_1", meta_page_id: "page_1", meta_connection_generation: 1,
  raw: { source: "campaign_operation", metaResult: { campaignId: "meta-1", adSetIds: ["set-1"], adIds: ["ad-1"] } },
};
let saved: DraftDTO;

function view(metaReady = false) {
  return render(<Campaigns business={business} approved={[creative]} initialCampaigns={[]} initialResults={{}} leadForms={[{ id: "form-1", name: "Enquiries", status: "ACTIVE" }]} leadFormError={null} metaReady={metaReady} adAccountId="" />);
}

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  localStorage.setItem(`campaign-sync:${business.owner_id}:${business.id}:`, String(Date.now()));
  localStorage.setItem(`campaign-sync:${business.owner_id}:${business.id}:act_1`, String(Date.now()));
  mocks.drafts.mockResolvedValue([]);
  mocks.status.mockResolvedValue({ authorization: "connected", selected, generation: 1 });
  mocks.saveDraft.mockImplementation(async (input: DraftInput) => {
    saved = { draftId: "33333333-3333-4333-8333-333333333333", version: 1, expiresAt: "2099-01-01T00:00:00.000Z", input };
    return saved;
  });
  mocks.draft.mockImplementation(async () => saved);
  mocks.updateDraft.mockImplementation(async (_id: string, _version: number, input: DraftInput) => ({ ...saved, version: 2, input }));
  mocks.preflight.mockImplementation(async () => ({
    draftId: saved.draftId, draftVersion: saved.version, connectionGeneration: 1,
    canCreatePaused: true, blockers: [], planHash: "a".repeat(64), currency: "INR",
    perAdSetDailyBudgetRupees: 200, totalDailyBudgetRupees: 200, adSetCount: 1,
    resolvedAreaLabel: "Jaipur", selected, audienceInterests: [{ id: "12345", name: "Solar energy" }],
  }));
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url === "/api/campaigns/plan"
    ? { ready: true, targeting: recommended }
    : { forms: [{ id: "form-1", name: "Enquiries", status: "ACTIVE" }] })));
});

describe("unsaved campaign setup", () => {
  it("retains the goal and selected creative after closing and reopening", () => {
    view();
    const trigger = screen.getByRole("button", { name: "Close campaign setup" });
    trigger.focus();
    fireEvent.change(screen.getByLabelText("Campaign name"), { target: { value: "Jaipur solar enquiries" } });
    fireEvent.change(screen.getByLabelText("Daily budget (₹)"), { target: { value: "350" } });
    fireEvent.change(screen.getByLabelText("Campaign goal"), { target: { value: "Enquiries for a local solar offer" } });
    // #305: typed areas live under the location "Choose myself".
    fireEvent.click(screen.getAllByRole("button", { name: "Choose myself" })[0]);
    fireEvent.change(screen.getByLabelText("Planned areas"), { target: { value: "Jaipur" } });
    fireEvent.change(screen.getByLabelText("Excluded areas"), { target: { value: "Ajmer" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /A\/B test the audience by age/ }));
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    fireEvent.click(trigger);
    expect(screen.getByRole("button", { name: "New campaign" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "New campaign" }));
    expect(screen.getByLabelText("Campaign name")).toHaveValue("Jaipur solar enquiries");
    expect(screen.getByLabelText("Campaign name")).toHaveFocus();
    expect(screen.getByLabelText("Daily budget per ad set (₹)")).toHaveValue(350);
    expect(screen.getByLabelText("Campaign goal")).toHaveValue("Enquiries for a local solar offer");
    expect(screen.getByLabelText("Planned areas")).toHaveValue("Jaipur");
    expect(screen.getByLabelText("Excluded areas")).toHaveValue("Ajmer");
    expect(screen.getByRole("checkbox", { name: /A\/B test the audience by age/ })).toBeChecked();
    expect(screen.getByRole("button", { name: creative.headline! })).toHaveAttribute("aria-pressed", "true");
  });

  it("cancels discard without losing edits, then starts clean without removing a saved draft", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    view();
    fireEvent.change(screen.getByLabelText("Campaign name"), { target: { value: "Saved first setup" } });
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await screen.findByRole("button", { name: /^Saved first setup/ });
    fireEvent.change(screen.getByLabelText("Campaign goal"), { target: { value: "Unsent changes" } });
    fireEvent.click(screen.getByRole("button", { name: "Discard and start new" }));
    expect(screen.getByLabelText("Campaign goal")).toHaveValue("Unsent changes");
    fireEvent.click(screen.getByRole("button", { name: "Discard and start new" }));
    await waitFor(() => expect(screen.getByLabelText("Campaign goal")).toHaveValue(""));
    expect(screen.getByRole("button", { name: creative.headline! })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /^Saved first setup/ })).toBeInTheDocument();
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(mocks.createCampaign).not.toHaveBeenCalled();
  });

  it("retains the chosen lead form and destination without another save", () => {
    render(<Campaigns business={business} approved={[creative]} initialCampaigns={[]} initialResults={{}}
      leadForms={[{ id: "form-1", name: "Enquiries", status: "ACTIVE" }, { id: "form-2", name: "Consultations", status: "ACTIVE" }]}
      leadFormError={null} metaReady={false} adAccountId="" />);
    fireEvent.change(screen.getByRole("combobox", { name: "Lead form" }), { target: { value: "form-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Close campaign setup" }));
    fireEvent.click(screen.getByRole("button", { name: "New campaign" }));
    expect(screen.getByRole("combobox", { name: "Lead form" })).toHaveValue("form-2");
    fireEvent.click(screen.getByRole("radio", { name: "WhatsApp chat" }));
    fireEvent.click(screen.getByRole("button", { name: "Close campaign setup" }));
    fireEvent.click(screen.getByRole("button", { name: "New campaign" }));
    expect(screen.getByRole("radio", { name: "WhatsApp chat" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Instant form" }));
    expect(screen.getByRole("combobox", { name: "Lead form" })).toHaveValue("form-2");
    expect(mocks.saveDraft).not.toHaveBeenCalled();
  });

  it("restores keyboard focus to the guided setup when reopening", () => {
    view();
    fireEvent.click(screen.getByRole("radio", { name: "Plan with AdBrain" }));
    const trigger = screen.getByRole("button", { name: "Close campaign setup" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("button", { name: "New campaign" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "New campaign" }));
    expect(screen.getByRole("radio", { name: "Plan with AdBrain" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Plan with AdBrain" })).toHaveFocus();
  });

  it("lets the owner start fresh, after confirming, when Meta only partly created a campaign (#143)", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    mocks.createCampaign.mockResolvedValue({ operationId: "44444444-4444-4444-8444-444444444444", state: "needs_reconciliation", checkpoints: [], externalIds: {}, error: null });
    view();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    fireEvent.click(screen.getByRole("button", { name: "Check my campaign (nothing spends)" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send to Meta (paused)" }));
    await screen.findByText("Campaign creation needs reconciliation. Do not retry the create operation.");
    expect(screen.getByText(/Meta only partly created this campaign/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start a new campaign" }));
    await waitFor(() => expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining("Meta only partly created the last campaign")));
    expect(screen.getByRole("button", { name: creative.headline! })).toHaveAttribute("aria-pressed", "true");
    expect(sessionStorage.length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Discard and start new" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Start a new campaign" })).not.toBeInTheDocument());
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Resolve the current campaign operation before starting another campaign.")).not.toBeInTheDocument();
    expect(screen.queryByText("Campaign creation needs reconciliation. Do not retry the create operation.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start a new campaign" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: creative.headline! })).toHaveAttribute("aria-pressed", "false");
    expect(sessionStorage.length).toBe(0);
    expect(mocks.createCampaign).toHaveBeenCalledTimes(1);
  });

  it("keeps a campaign launch with an unknown outcome locked", async () => {
    const confirm = vi.spyOn(window, "confirm");
    mocks.createCampaign.mockRejectedValue(new Error("Network lost"));
    view();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    fireEvent.click(screen.getByRole("button", { name: "Check my campaign (nothing spends)" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send to Meta (paused)" }));
    await screen.findByText("Network lost");
    fireEvent.click(screen.getByRole("button", { name: "Discard and start new" }));
    expect(screen.getByText("Resolve the current campaign operation before starting another campaign.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: creative.headline! })).toHaveAttribute("aria-pressed", "true");
    expect(confirm).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBeGreaterThan(0);
  });

  it.each(["business", "owner"])("keeps unsaved setups separate when switching %s and back", (boundary) => {
    const props = { approved: [creative], initialCampaigns: [], initialResults: {}, leadForms: [], leadFormError: null, metaReady: false, adAccountId: "" };
    const current = render(<Campaigns {...props} business={business} />);
    fireEvent.change(screen.getByLabelText("Campaign goal"), { target: { value: "Jaipur enquiries" } });
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    const otherBusiness = boundary === "owner"
      ? { ...business, owner_id: "other-owner" }
      : { ...business, id: "other-business", name: "Another business" };
    current.rerender(<Campaigns {...props} business={otherBusiness} />);
    expect(screen.getByLabelText("Campaign goal")).toHaveValue("");
    expect(screen.getByRole("button", { name: creative.headline! })).toHaveAttribute("aria-pressed", "false");
    current.rerender(<Campaigns {...props} business={business} />);
    expect(screen.getByLabelText("Campaign goal")).toHaveValue("Jaipur enquiries");
    expect(screen.getByRole("button", { name: creative.headline! })).toHaveAttribute("aria-pressed", "true");
  });
});
describe("campaign sync feedback", () => {
  it("shows the intended audience, budget, destination and creative before activation", async () => {
    const campaign = { id: "campaign-1", business_id: business.id, name: "Saved campaign", status: "paused", meta_campaign_id: "meta-1", daily_budget: 500, ...launched } as unknown as Campaign;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.startsWith("/api/payments/customer-balance")) return Response.json({});
      if (url === "/api/campaigns/campaign-1") return Response.json({ delivery: {
        campaign: { id: "meta-1", status: "PAUSED", effectiveStatus: "CAMPAIGN_PAUSED" },
        adSets: [{ id: "set-1", status: "ACTIVE", effectiveStatus: "CAMPAIGN_PAUSED", dailyBudgetPaise: 50000, pageId: "page_1", destinationType: "ON_AD", targeting: { geo_locations: { countries: ["IN"] } } }],
        ads: [{ id: "ad-1", status: "ACTIVE", effectiveStatus: "CAMPAIGN_PAUSED", adSetId: "set-1", creativeId: "creative-1" }],
      }, learning: { costPerResultRupees: 69, pausedAt: new Date(Date.now() - 10.5 * 86_400_000).toISOString() } });
      return Response.json({ campaigns: [], nextCursor: null });
    }));
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<Campaigns business={business} approved={[creative]} initialCampaigns={[campaign]} initialResults={{}} leadForms={[]} leadFormError={null} metaReady={false} adAccountId="act_1" />);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await act(async () => { mocks.dialog.current!.onConnected({ authorization: "connected", selected, generation: 1 } as ConnectionDTO); });
    expect(await screen.findByText(/Targeting:.*"IN"/)).toBeInTheDocument();
    // #662: the review opens above the list, so it's brought on screen on a phone.
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    // #419 item 2: resuming after AdBrain paused it 10 days ago restarts Meta's learning; a note, not a block.
    expect(screen.getByRole("list", { name: "Before you activate" })).toHaveTextContent("Paused for 10 days: Meta restarts learning");
    expect(screen.getByText(/Ad set set-1:.*₹500.*destination ON_AD/)).toBeInTheDocument();
    expect(screen.getByText(/Ad ad-1 .*creative creative-1/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request activation" })).toBeEnabled();
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });

  it("offers a capped run when every reviewed child is paused, and sends the approved days with a digest covering them (#157)", async () => {
    const campaign = { id: "campaign-1", business_id: business.id, name: "Saved campaign", status: "paused", meta_campaign_id: "meta-1", daily_budget: 500, ...launched } as unknown as Campaign;
    const delivery = {
      campaign: { id: "meta-1", status: "PAUSED", effectiveStatus: "PAUSED" },
      adSets: [{ id: "set-1", status: "PAUSED", effectiveStatus: "CAMPAIGN_PAUSED", dailyBudgetPaise: 50000, pageId: "page_1", destinationType: "ON_AD", targeting: null }],
      ads: [{ id: "ad-1", status: "PAUSED", effectiveStatus: "CAMPAIGN_PAUSED", adSetId: "set-1", creativeId: "creative-1" }],
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/payments/customer-balance")) return Response.json({});
      if (url === "/api/campaigns/campaign-1" && init?.method === "PATCH") return Response.json({ ok: true, status: "active" });
      if (url === "/api/campaigns/campaign-1") return Response.json({ delivery, learning: { costPerResultRupees: 69, pausedAt: null } });
      return Response.json({ campaigns: [], nextCursor: null });
    }));
    const connection = { authorization: "connected", selected, generation: 1 } as ConnectionDTO;
    render(<Campaigns business={business} approved={[creative]} initialCampaigns={[campaign]} initialResults={{}} leadForms={[]} leadFormError={null} metaReady={false} adAccountId="act_1" />);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await act(async () => { mocks.dialog.current!.onConnected(connection); });
    expect(await screen.findByText(/Total limit on Meta: ₹1,500 over 3 days/)).toBeInTheDocument();
    // #419 item 2: the copy is a new ad set; ₹500 × 3 days at ₹69 a chat is about 21, under Meta's ~50.
    expect(screen.getByText(/new ad set.*3 days at about ₹69 a result buys about 21 results/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Run for"), { target: { value: "2" } });
    expect(screen.getByText(/Total limit on Meta: ₹1,000 over 2 days/)).toBeInTheDocument();
    expect(screen.getByText(/2 days at about ₹69 a result buys about 14 results/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve total and activate" }));
    await screen.findByText(/₹1,000 total limit on Meta for 2 days/);
    const [, init] = vi.mocked(fetch).mock.calls.find(([, call]) => call?.method === "PATCH")!;
    const { createHash } = await import("node:crypto");
    const { activationConfirmationPayload } = await import("@/lib/campaign/activation");
    expect(JSON.parse(String(init!.body))).toEqual({
      status: "active", connectionGeneration: 1, capDays: 2,
      confirmationDigest: createHash("sha256").update(activationConfirmationPayload(campaign, connection, delivery, 2)).digest("hex"),
    });
    // #208: delivery review first, then the funds review at one capped day.
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    const reviewAt = urls.indexOf("/api/campaigns/campaign-1");
    const fundsAt = urls.findIndex(url => url.startsWith("/api/payments/customer-balance"));
    expect(reviewAt).toBeGreaterThanOrEqual(0);
    expect(fundsAt).toBeGreaterThan(reviewAt);
    expect(urls[fundsAt]).toContain("&capDays=1");
  });

  it("reviews funds without a cap when the reviewed children are already active (#208)", async () => {
    const campaign = { id: "campaign-1", business_id: business.id, name: "Saved campaign", status: "paused", meta_campaign_id: "meta-1", daily_budget: 500, ...launched } as unknown as Campaign;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.startsWith("/api/payments/customer-balance")) return Response.json({});
      if (url === "/api/campaigns/campaign-1") return Response.json({ delivery: {
        campaign: { id: "meta-1", status: "PAUSED", effectiveStatus: "PAUSED" },
        adSets: [{ id: "set-1", status: "ACTIVE", effectiveStatus: "CAMPAIGN_PAUSED", dailyBudgetPaise: 50000, pageId: "page_1", destinationType: "ON_AD", targeting: null }],
        ads: [{ id: "ad-1", status: "ACTIVE", effectiveStatus: "CAMPAIGN_PAUSED", adSetId: "set-1", creativeId: "creative-1" }],
      } });
      return Response.json({ campaigns: [], nextCursor: null });
    }));
    render(<Campaigns business={business} approved={[creative]} initialCampaigns={[campaign]} initialResults={{}} leadForms={[]} leadFormError={null} metaReady={false} adAccountId="act_1" />);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await act(async () => { mocks.dialog.current!.onConnected({ authorization: "connected", selected, generation: 1 } as ConnectionDTO); });
    await screen.findByRole("button", { name: "Request activation" });
    expect(screen.queryByRole("list", { name: "Before you activate" })).toBeNull();
    const funds = vi.mocked(fetch).mock.calls.map(([url]) => String(url)).find(url => url.startsWith("/api/payments/customer-balance"));
    expect(funds).toBeDefined();
    expect(funds).not.toContain("capDays");
  });

  it("shows Meta's room against the cap for an operator-funded business instead of the AdBrain balance (#245)", async () => {
    const campaign = { id: "campaign-1", business_id: business.id, name: "Saved campaign", status: "paused", meta_campaign_id: "meta-1", daily_budget: 500, ...launched } as unknown as Campaign;
    const delivery = {
      campaign: { id: "meta-1", status: "PAUSED", effectiveStatus: "PAUSED" },
      adSets: [{ id: "set-1", status: "PAUSED", effectiveStatus: "CAMPAIGN_PAUSED", dailyBudgetPaise: 50000, pageId: "page_1", destinationType: "ON_AD", targeting: null }],
      ads: [{ id: "ad-1", status: "PAUSED", effectiveStatus: "CAMPAIGN_PAUSED", adSetId: "set-1", creativeId: "creative-1" }],
    };
    const funding = { spendCapPaise: 204237, amountSpentPaise: 4237, roomPaise: 200000, prepay: true };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/campaigns/campaign-1") return Response.json({ delivery, funding });
      return Response.json({ campaigns: [], nextCursor: null });
    }));
    render(<Campaigns business={business} approved={[creative]} initialCampaigns={[campaign]} initialResults={{}} leadForms={[]} leadFormError={null} metaReady={false} adAccountId="act_1" />);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await act(async () => { mocks.dialog.current!.onConnected({ authorization: "connected", selected, generation: 1 } as ConnectionDTO); });
    expect(await screen.findByText("Funded on Meta: ₹2,000.00 room for a ₹1,500.00 cap.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve total and activate" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Run for"), { target: { value: "5" } });
    expect(screen.getByText("Funded on Meta: ₹2,000.00 room for a ₹2,500.00 cap. Add funds on Meta or choose fewer days.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve total and activate" })).toBeDisabled();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith("/api/payments/customer-balance"))).toBe(false);
  });

  // #1058: Meta's room doesn't count what the account's other live capped runs may still spend.
  it("subtracts the account's other live capped runs from Meta's room and says so", async () => {
    const campaign = { id: "campaign-1", business_id: business.id, name: "Saved campaign", status: "paused", meta_campaign_id: "meta-1", daily_budget: 500, ...launched } as unknown as Campaign;
    const delivery = {
      campaign: { id: "meta-1", status: "PAUSED", effectiveStatus: "PAUSED" },
      adSets: [{ id: "set-1", status: "PAUSED", effectiveStatus: "CAMPAIGN_PAUSED", dailyBudgetPaise: 50000, pageId: "page_1", destinationType: "ON_AD", targeting: null }],
      ads: [{ id: "ad-1", status: "PAUSED", effectiveStatus: "CAMPAIGN_PAUSED", adSetId: "set-1", creativeId: "creative-1" }],
    };
    const funding = { spendCapPaise: 204237, amountSpentPaise: 4237, roomPaise: 200000, prepay: true, committed: { runs: 1, remainingPaise: 50000 } };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/campaigns/campaign-1") return Response.json({ delivery, funding });
      return Response.json({ campaigns: [], nextCursor: null });
    }));
    render(<Campaigns business={business} approved={[creative]} initialCampaigns={[campaign]} initialResults={{}} leadForms={[]} leadFormError={null} metaReady={false} adAccountId="act_1" />);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await act(async () => { mocks.dialog.current!.onConnected({ authorization: "connected", selected, generation: 1 } as ConnectionDTO); });
    expect(await screen.findByText("Funded on Meta: ₹1,500.00 room for a ₹1,500.00 cap after ₹500.00 for your 1 other live run.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve total and activate" })).toBeEnabled();
    // ₹2,000 fits Meta's ₹2,000 room but not the ₹1,500 left after the other run.
    fireEvent.change(screen.getByLabelText("Run for"), { target: { value: "4" } });
    expect(screen.getByText("Funded on Meta: ₹1,500.00 room for a ₹2,000.00 cap after ₹500.00 for your 1 other live run. Add funds on Meta or choose fewer days.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve total and activate" })).toBeDisabled();
  });

  // #759: an owner on their own ad account needs no account spending limit; the total limit on Meta is the guard.
  it.each([
    [false, "Funded on your Meta ad account: no spending limit set; Meta stops at the total limit above.", true],
    [true, "Funded on Meta: set a spending limit on the Meta ad account first.", false],
  ])("with no account spending limit and spendLimitRequired=%s, the review says so and activation is %s", async (spendLimitRequired, text, enabled) => {
    const campaign = { id: "campaign-1", business_id: business.id, name: "Saved campaign", status: "paused", meta_campaign_id: "meta-1", daily_budget: 500, ...launched } as unknown as Campaign;
    const delivery = {
      campaign: { id: "meta-1", status: "PAUSED", effectiveStatus: "PAUSED" },
      adSets: [{ id: "set-1", status: "PAUSED", effectiveStatus: "CAMPAIGN_PAUSED", dailyBudgetPaise: 50000, pageId: "page_1", destinationType: "ON_AD", targeting: null }],
      ads: [{ id: "ad-1", status: "PAUSED", effectiveStatus: "CAMPAIGN_PAUSED", adSetId: "set-1", creativeId: "creative-1" }],
    };
    const funding = { spendCapPaise: 0, amountSpentPaise: 4237, roomPaise: 0, prepay: false };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "/api/campaigns/campaign-1"
      ? Response.json({ delivery, funding, spendLimitRequired })
      : Response.json({ campaigns: [], nextCursor: null })));
    render(<Campaigns business={business} approved={[creative]} initialCampaigns={[campaign]} initialResults={{}} leadForms={[]} leadFormError={null} metaReady={false} adAccountId="act_1" />);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await act(async () => { mocks.dialog.current!.onConnected({ authorization: "connected", selected, generation: 1 } as ConnectionDTO); });
    expect(await screen.findByText(text)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Approve total and activate" });
    if (enabled) expect(button).toBeEnabled(); else expect(button).toBeDisabled();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith("/api/payments/customer-balance"))).toBe(false);
  });

  // #662 (QA, 390 px): a synced campaign's Resume could never work and failed off-screen.
  it("sends a paused campaign AdBrain didn't launch to Ads Manager, with the reason on its card", async () => {
    const synced = { id: "campaign-9", business_id: business.id, name: "new year", status: "paused", meta_campaign_id: "meta-9", meta_ad_account_id: "act_1", daily_budget: 500, raw: null } as unknown as Campaign;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ campaigns: [], nextCursor: null })));
    render(<Campaigns business={business} approved={[creative]} initialCampaigns={[synced]} initialResults={{}} leadForms={[]} leadFormError={null} metaReady={false} adAccountId="act_1" />);
    const card = within(screen.getByRole("heading", { name: "new year" }).closest("article")!);
    expect(card.queryByRole("button", { name: "Resume" })).toBeNull();
    const link = card.getByRole("link", { name: "Resume in Ads Manager" });
    expect(link).toHaveAttribute("href", expect.stringContaining("selected_campaign_ids=meta-9"));
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.className).toMatch(/\bh-11\b/);
    // #847: the button carries the reason instead of a sentence repeated on every synced card.
    expect(link).toHaveAttribute("title", "AdBrain can only resume campaigns it launched. Resume this one in Ads Manager.");
  });

  it("shows a failed activation review on the campaign's card, where the owner tapped Resume", async () => {
    const campaign = { id: "campaign-1", business_id: business.id, name: "Saved campaign", status: "paused", meta_campaign_id: "meta-1", daily_budget: 500, ...launched } as unknown as Campaign;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "/api/campaigns/campaign-1"
      ? Response.json({ error: "Campaign budget changed in Meta. Refresh and review the budget before activation." }, { status: 409 })
      : Response.json({ campaigns: [], nextCursor: null })));
    render(<Campaigns business={business} approved={[creative]} initialCampaigns={[campaign]} initialResults={{}} leadForms={[]} leadFormError={null} metaReady={false} adAccountId="act_1" />);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await act(async () => { mocks.dialog.current!.onConnected({ authorization: "connected", selected, generation: 1 } as ConnectionDTO); });
    const card = within(screen.getByRole("heading", { name: "Saved campaign" }).closest("article")!);
    expect(await card.findByRole("alert")).toHaveTextContent("Campaign budget changed in Meta. Refresh and review the budget before activation.");
  });

  it("brings the review on screen each time Resume opens it, not on Refresh review; a failed Refresh review stays by the panel", async () => {
    const campaign = { id: "campaign-1", business_id: business.id, name: "Saved campaign", status: "paused", meta_campaign_id: "meta-1", daily_budget: 500, ...launched } as unknown as Campaign;
    const delivery = {
      campaign: { id: "meta-1", status: "PAUSED", effectiveStatus: "PAUSED" },
      adSets: [{ id: "set-1", status: "ACTIVE", effectiveStatus: "CAMPAIGN_PAUSED", dailyBudgetPaise: 50000, pageId: "page_1", destinationType: "ON_AD", targeting: null }],
      ads: [{ id: "ad-1", status: "ACTIVE", effectiveStatus: "CAMPAIGN_PAUSED", adSetId: "set-1", creativeId: "creative-1" }],
    };
    let reviews = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.startsWith("/api/payments/customer-balance")) return Response.json({});
      if (url === "/api/campaigns/campaign-1") return (reviews += 1) === 3
        ? Response.json({ error: "Campaign budget changed in Meta. Refresh and review the budget before activation." }, { status: 409 })
        : Response.json({ delivery });
      return Response.json({ campaigns: [], nextCursor: null });
    }));
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      render(<Campaigns business={business} approved={[creative]} initialCampaigns={[campaign]} initialResults={{}} leadForms={[]} leadFormError={null} metaReady={false} adAccountId="act_1" />);
      const resume = async () => {
        fireEvent.click(screen.getByRole("button", { name: "Resume" }));
        await act(async () => { mocks.dialog.current!.onConnected({ authorization: "connected", selected, generation: 1 } as ConnectionDTO); });
      };
      await resume();
      await screen.findByRole("button", { name: "Request activation" });
      // The scroll runs in an effect after the review renders, so wait for it (flaked on PR #716 and next 5ece32f).
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
      // The owner scrolled back down to the card and tapped Resume again: the same review, brought back on screen.
      await resume();
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(2));
      fireEvent.click(screen.getByRole("button", { name: "Refresh review" }));
      expect(await screen.findByText("Campaign budget changed in Meta. Refresh and review the budget before activation.")).toBeInTheDocument();
      expect(within(screen.getByRole("heading", { name: "Saved campaign" }).closest("article")!).queryByRole("alert")).toBeNull();
      expect(scrollIntoView).toHaveBeenCalledTimes(2);
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it("keeps Pause on an active campaign AdBrain didn't launch, and shows a failed pause on its card", async () => {
    const synced = { id: "campaign-9", business_id: business.id, name: "new year", status: "active", meta_campaign_id: "meta-9", meta_ad_account_id: "act_1", daily_budget: 500, raw: null } as unknown as Campaign;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => url === "/api/campaigns/campaign-9" && init?.method === "PATCH"
      ? Response.json({ error: "Meta did not confirm the pause. Pause the campaign in Ads Manager now." }, { status: 502 })
      : Response.json({ campaigns: [], nextCursor: null })));
    render(<Campaigns business={business} approved={[creative]} initialCampaigns={[synced]} initialResults={{}} leadForms={[]} leadFormError={null} metaReady={false} adAccountId="act_1" />);
    const card = within(screen.getByRole("heading", { name: "new year" }).closest("article")!);
    expect(card.queryByRole("link", { name: "Resume in Ads Manager" })).toBeNull();
    fireEvent.click(card.getByRole("button", { name: "Pause" }));
    expect(await card.findByRole("alert")).toHaveTextContent("Meta did not confirm the pause. Pause the campaign in Ads Manager now.");
  });

  // #757: a dead token can't pause; the card names the manual step and links straight to the campaign in Ads Manager.
  it("a pause refused for a dead Meta token links to the campaign in Ads Manager on its card", async () => {
    const live = { id: "campaign-9", business_id: business.id, name: "new year", status: "active", meta_campaign_id: "meta-9", daily_budget: 500, ...launched } as unknown as Campaign;
    const message = "Meta stopped accepting AdBrain's access, so we couldn't pause this campaign. Pause it in Ads Manager now, then reconnect Facebook in Settings.";
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => url === "/api/campaigns/campaign-9" && init?.method === "PATCH"
      ? Response.json({ error: message, code: "META_REAUTH" }, { status: 409 })
      : Response.json({ campaigns: [], nextCursor: null })));
    render(<Campaigns business={business} approved={[creative]} initialCampaigns={[live]} initialResults={{}} leadForms={[]} leadFormError={null} metaReady={false} adAccountId="act_1" />);
    const card = within(screen.getByRole("heading", { name: "new year" }).closest("article")!);
    fireEvent.click(card.getByRole("button", { name: "Pause" }));
    const alert = await card.findByRole("alert");
    expect(alert).toHaveTextContent(message);
    const link = within(alert).getByRole("link", { name: "Open in Ads Manager" });
    expect(link.getAttribute("href")).toContain("selected_campaign_ids=meta-9");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("shows a failed refresh on the campaign's card, and clears it on the next try", async () => {
    const campaign = { id: "campaign-1", business_id: business.id, name: "Saved campaign", status: "paused", meta_campaign_id: "meta-1", daily_budget: 500, ...launched } as unknown as Campaign;
    let fail = true;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "/api/campaigns/campaign-1/refresh"
      ? fail ? Response.json({ error: "Meta is busy. Try again in a minute." }, { status: 503 }) : Response.json({})
      : Response.json({ campaigns: [], nextCursor: null })));
    render(<Campaigns business={business} approved={[creative]} initialCampaigns={[campaign]} initialResults={{}} leadForms={[]} leadFormError={null} metaReady={false} adAccountId="act_1" />);
    const card = within(screen.getByRole("heading", { name: "Saved campaign" }).closest("article")!);
    fireEvent.click(card.getByRole("button", { name: "Refresh results" }));
    expect(await card.findByRole("alert")).toHaveTextContent("Meta is busy. Try again in a minute.");
    fail = false;
    fireEvent.click(card.getByRole("button", { name: "Refresh results" }));
    await waitFor(() => expect(card.queryByRole("alert")).toBeNull());
  });

  // #671: a refresh always answers on the card, even when Meta's numbers didn't move.
  it("says on the card whether a refresh brought new results", async () => {
    const campaign = { id: "campaign-1", business_id: business.id, name: "Saved campaign", status: "paused", meta_campaign_id: "meta-1", daily_budget: 500, ...launched } as unknown as Campaign;
    const before = { id: "r1", campaign_id: "campaign-1", impressions: 120, clicks: 4, leads: 1, spend: 80, cpl: 80, fetched_at: "2026-10-26T03:35:00.000Z" };
    let next = { ...before, id: "r2", fetched_at: "2026-10-26T05:00:00.000Z" };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "/api/campaigns/campaign-1/refresh"
      ? Response.json({ result: next })
      : Response.json({ campaigns: [], nextCursor: null })));
    render(<Campaigns business={business} approved={[creative]} initialCampaigns={[campaign]} initialResults={{ "campaign-1": before } as never} leadForms={[]} leadFormError={null} metaReady={false} adAccountId="act_1" />);
    const card = within(screen.getByRole("heading", { name: "Saved campaign" }).closest("article")!);
    fireEvent.click(card.getByRole("button", { name: "Refresh results" }));
    const since = new Date(before.fetched_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    expect(await card.findByRole("status")).toHaveTextContent(`Checked just now: no new results since ${since}.`);
    next = { ...next, id: "r3", impressions: 300, fetched_at: "2026-10-26T06:00:00.000Z" };
    fireEvent.click(card.getByRole("button", { name: "Refresh results" }));
    await waitFor(() => expect(card.getByRole("status")).toHaveTextContent("Results updated just now."));
  });

  // #763: owners read "Running" (was "Requested active"); a row synced from Meta says it was made outside AdBrain.
  it("labels an active campaign Running and a synced one Made outside AdBrain", () => {
    const campaign = { id: "campaign-1", name: "Saved campaign", status: "active" } as Campaign;
    const synced = { id: "campaign-2", name: "Agency campaign", status: "paused", meta_campaign_id: "120000000000000001", raw: { source: "sync" } } as unknown as Campaign;
    render(<Campaigns business={business} approved={[creative]} initialCampaigns={[campaign, synced]} initialResults={{}} leadForms={[]} leadFormError={null} metaReady={false} adAccountId="" />);
    expect(screen.getAllByText("Running")).toHaveLength(2);
    expect(screen.getByText(/1 running/)).toBeInTheDocument();
    expect(screen.queryByText(/requested active/i)).toBeNull();
    const row = (name: string) => within(screen.getByRole("heading", { name }).closest("article")!);
    expect(row("Agency campaign").getByText("Made outside AdBrain")).toBeInTheDocument();
    expect(row("Saved campaign").queryByText("Made outside AdBrain")).toBeNull();
  });

  it("shows Needs attention with the reason for a live campaign the scheduled refresh flagged (#258)", () => {
    const flag = { kind: "rejected", reason: "Meta rejected an ad: Ads about housing must run with a special ad category.", since: "2026-10-23T17:00:00.000Z", key: "aaaaaaaaaaaa" };
    const campaign = { id: "campaign-1", name: "Saved campaign", status: "active", raw: { health: { checkedAt: flag.since, activeSince: flag.since, flags: [flag] } } } as unknown as Campaign;
    render(<Campaigns business={business} approved={[creative]} initialCampaigns={[campaign]} initialResults={{}} leadForms={[]} leadFormError={null} metaReady={false} adAccountId="" />);
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
    expect(screen.getByText(flag.reason)).toBeInTheDocument();
  });

  it("requests a status selection immediately without the search typing delay", async () => {
    const first = { id: "first", name: "First campaign", status: "paused" } as Campaign;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ campaigns: [], results: {}, nextCursor: null })));
    render(<Campaigns business={business} approved={[creative]} initialCampaigns={[first]} initialResults={{}} leadForms={[]} leadFormError={null} metaReady={false} adAccountId="" />);
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("combobox", { name: "Campaign status" }), { target: { value: "active" } });
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("status=active"), { signal: expect.any(AbortSignal), credentials: "same-origin", cache: "no-store" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Loading campaigns..." })).not.toBeInTheDocument());
  });

  it("loads another page and can recover from an empty server-side search", async () => {
    const first = { id: "first", name: "First campaign", status: "paused" } as Campaign;
    const second = { id: "second", name: "Second campaign", status: "active" } as Campaign;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const params = new URL(url, "http://localhost").searchParams;
      return Response.json({ campaigns: params.has("query") ? [] : params.has("cursor") ? [first, second] : [first], results: {}, nextCursor: null });
    }));
    render(<Campaigns business={business} approved={[creative]} initialCampaigns={[first]} initialNextCursor="next-page" initialResults={{}} leadForms={[]} leadFormError={null} metaReady={false} adAccountId="" />);
    fireEvent.click(screen.getByRole("button", { name: "Load more campaigns" }));
    await screen.findByText("Second campaign");
    expect(screen.getAllByText("First campaign")).toHaveLength(1);
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain("cursor=next-page");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search campaigns" }), { target: { value: "missing" } });
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("query=missing"))).toBe(true));
    await screen.findByText("No matching campaigns");
    expect(screen.getByRole("searchbox", { name: "Search campaigns" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(String(vi.mocked(fetch).mock.lastCall![0])).not.toContain("query=");
    await screen.findByText("First campaign");
    expect(String(vi.mocked(fetch).mock.lastCall![0])).not.toContain("cursor=");
  });

  it("ignores a canceled page response when status filters change", async () => {
    let completePage!: (response: Response) => void;
    const first = { id: "first", name: "First campaign", status: "paused" } as Campaign;
    const active = { id: "active", name: "Active campaign", status: "active" } as Campaign;
    vi.stubGlobal("fetch", vi.fn((url: string) => String(url).includes("cursor=")
      ? new Promise<Response>(resolve => { completePage = resolve; })
      : Promise.resolve(Response.json({ campaigns: [active], results: {}, nextCursor: null }))));
    render(<Campaigns business={business} approved={[creative]} initialCampaigns={[first]} initialNextCursor="next-page" initialResults={{}} leadForms={[]} leadFormError={null} metaReady={false} adAccountId="" />);
    fireEvent.click(screen.getByRole("button", { name: "Load more campaigns" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Campaign status" }), { target: { value: "active" } });
    await screen.findByText("Active campaign");
    await act(async () => { completePage(Response.json({ campaigns: [{ ...active, id: "late", name: "Late campaign" }], results: {}, nextCursor: "stale" })); });
    expect(screen.queryByText("Late campaign")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more campaigns" })).not.toBeInTheDocument();
  });

  it("caches empty results but never shares freshness across businesses or owners", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ forms: [] })));
    const props = { approved: [creative], initialCampaigns: [], initialResults: {}, leadForms: [], leadFormError: null, metaReady: true, adAccountId: "" };
    const current = render(<Campaigns {...props} business={business} />);
    await waitFor(() => expect(screen.queryByText("Loading lead forms...")).not.toBeInTheDocument());
    const formCalls = () => vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/campaigns/lead-forms");
    expect(formCalls()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Close campaign setup" }));
    fireEvent.click(screen.getByRole("button", { name: "New campaign" }));
    expect(formCalls()).toHaveLength(1);
    current.rerender(<Campaigns {...props} business={{ ...business, id: "other-business" }} />);
    await waitFor(() => expect(formCalls()).toHaveLength(2));
    current.rerender(<Campaigns {...props} business={{ ...business, id: "other-business", owner_id: "other-owner" }} />);
    await waitFor(() => expect(formCalls()).toHaveLength(3));
  });

  it("does not cache a cancelled response or a failure on reopen", async () => {
    let completeFirst!: (response: Response) => void;
    const forms = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>(resolve => { completeFirst = resolve; }))
      .mockResolvedValueOnce(Response.json({ error: "Unavailable" }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ forms: [{ id: "form-2", name: "Fresh form", status: "ACTIVE" }] }));
    vi.stubGlobal("fetch", vi.fn((url: string) => url === "/api/campaigns/lead-forms"
      ? forms() : Promise.resolve(Response.json({ campaigns: [], nextCursor: null }))));
    view(true);
    await screen.findByText("Loading lead forms...");
    fireEvent.click(screen.getByRole("button", { name: "Close campaign setup" }));
    await act(async () => { completeFirst(Response.json({ forms: [{ id: "old", name: "Cancelled form", status: "ACTIVE" }] })); });
    fireEvent.click(screen.getByRole("button", { name: "New campaign" }));
    await screen.findByText(/Page forms are temporarily unavailable/);
    expect(screen.queryByRole("option", { name: "Cancelled form" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close campaign setup" }));
    fireEvent.click(screen.getByRole("button", { name: "New campaign" }));
    await screen.findByRole("option", { name: "Fresh form" });
    expect(forms).toHaveBeenCalledTimes(3);
    // #667: the Page's only form is preselected.
    expect(screen.getByRole("combobox", { name: "Lead form" })).toHaveValue("form-2");
  });

  it("reuses successful forms on reopen and refreshes after one minute", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    try {
      view(true);
      await waitFor(() => expect(screen.queryByText("Loading lead forms...")).not.toBeInTheDocument());
      const formCalls = () => vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/campaigns/lead-forms");
      expect(formCalls()).toHaveLength(1);
      fireEvent.click(screen.getByRole("button", { name: "Close campaign setup" }));
      fireEvent.click(screen.getByRole("button", { name: "New campaign" }));
      expect(screen.getByRole("option", { name: "Enquiries" })).toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: "Lead form" })).toHaveValue("form-1");
      expect(screen.queryByText("Loading lead forms...")).not.toBeInTheDocument();
      expect(formCalls()).toHaveLength(1);
      fireEvent.click(screen.getByRole("button", { name: "Close campaign setup" }));
      clock.mockReturnValue(1_060_000);
      fireEvent.click(screen.getByRole("button", { name: "New campaign" }));
      await waitFor(() => expect(formCalls()).toHaveLength(2));
      expect(mocks.preflight).not.toHaveBeenCalled();
      expect(mocks.createCampaign).not.toHaveBeenCalled();
    } finally { clock.mockRestore(); }
  });

  it("refreshes fresh forms after reconnecting", async () => {
    view(true);
    await waitFor(() => expect(screen.queryByText("Loading lead forms...")).not.toBeInTheDocument());
    await act(async () => { await mocks.dialog.current!.onBeforeStart!(); });
    await act(async () => { mocks.dialog.current!.onConnected({ authorization: "connected", selected, generation: 2 } as ConnectionDTO); });
    const formUrls = () => vi.mocked(fetch).mock.calls.map(([url]) => String(url)).filter(url => url.startsWith("/api/campaigns/lead-forms"));
    await waitFor(() => expect(formUrls()).toHaveLength(2));
    // #271: a reconnect skips the server's lead-form cache.
    expect(formUrls()).toEqual(["/api/campaigns/lead-forms", "/api/campaigns/lead-forms?fresh=1"]);
    expect(mocks.createCampaign).not.toHaveBeenCalled();
  });

  it("loads lead forms once when a connection completes", async () => {
    view(false);
    await act(async () => { await mocks.dialog.current!.onBeforeStart!(); });
    await act(async () => { mocks.dialog.current!.onConnected({ authorization: "connected", selected, generation: 1 } as ConnectionDTO); });
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith("/api/campaigns/lead-forms"))).toHaveLength(1));
    expect(vi.mocked(fetch).mock.calls.some(([url]) => url === "/api/campaigns/lead-forms?fresh=1")).toBe(true);
    expect(screen.getByText(/Review your lead form before continuing/)).toBeInTheDocument();
    expect(mocks.createCampaign).not.toHaveBeenCalled();
  });

  it("opens recently synced campaigns without a Meta sync until requested", async () => {
    const sync = vi.fn().mockResolvedValue(Response.json({ campaigns: [], nextCursor: null }));
    vi.stubGlobal("fetch", vi.fn((url: string) => url.startsWith("/api/campaigns/sync")
      ? sync() : Promise.resolve(Response.json({ forms: [] }))));
    view(true);
    const button = await screen.findByRole("button", { name: "Sync from Meta" });
    expect(sync).not.toHaveBeenCalled();
    fireEvent.click(button);
    await screen.findByText("Campaign sync completed.");
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("syncs stale connected campaigns after rendering and remembers completion", async () => {
    const key = `campaign-sync:${business.owner_id}:${business.id}:`;
    const previousSync = String(Date.now() - 16 * 60_000);
    localStorage.setItem(key, previousSync);
    let complete!: (response: Response) => void;
    const sync = vi.fn(() => new Promise<Response>(resolve => { complete = resolve; }));
    vi.stubGlobal("fetch", vi.fn((url: string) => url.startsWith("/api/campaigns/sync")
      ? sync() : Promise.resolve(Response.json({ forms: [] }))));
    view(true);
    expect(screen.getByRole("heading", { name: /Your campaigns/ })).toBeInTheDocument();
    await waitFor(() => expect(sync).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem(key)).toBe(previousSync);
    await act(async () => { complete(Response.json({ campaigns: [], nextCursor: null })); });
    await screen.findByText("Campaign sync completed.");
    expect(Number(localStorage.getItem(key))).toBeGreaterThan(Date.now() - 60_000);
  });

  it("retries failed stale syncs and isolates freshness by Meta account", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_800_000);
    try {
      const key = `campaign-sync:${business.owner_id}:${business.id}:act_1`;
      localStorage.setItem(key, String(900_000));
      const sync = vi.fn().mockResolvedValue(Response.json({ error: "Unavailable" }, { status: 503 }));
      vi.stubGlobal("fetch", vi.fn((url: string) => url.startsWith("/api/campaigns/sync")
        ? sync() : Promise.resolve(Response.json({ forms: [] }))));
      const props = { business, approved: [creative], initialCampaigns: [], initialResults: {}, leadForms: [], leadFormError: null, metaReady: true, adAccountId: "act_1" };
      const first = render(<Campaigns {...props} />);
      await screen.findByText("Unavailable");
      expect(localStorage.getItem(key)).toBe("900000");
      first.unmount();
      localStorage.setItem(key, String(1_799_999));
      render(<Campaigns {...props} adAccountId="act_2" />);
      await waitFor(() => expect(sync).toHaveBeenCalledTimes(2));
    } finally { clock.mockRestore(); }
  });

  it("loads forms only when setup opens, retries failures, and cancels on close", async () => {
    const requests: AbortSignal[] = [];
    const urls: string[] = [];
    const forms = vi.fn().mockResolvedValueOnce(Response.json({ error: "Unavailable" }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ forms: [{ id: "form-2", name: "New enquiry", status: "ACTIVE" }] }));
    vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
      if (url.startsWith("/api/campaigns/lead-forms")) {
        urls.push(url);
        requests.push(options!.signal as AbortSignal);
        return forms();
      }
      return Promise.resolve(Response.json({ campaigns: [], nextCursor: null }));
    }));
    const campaign = { id: "campaign-1", name: "Saved campaign", status: "paused" } as Campaign;
    render(<Campaigns business={business} approved={[creative]} initialCampaigns={[campaign]} initialResults={{}} leadForms={[]} leadFormError={null} metaReady adAccountId="act_1" />);
    await screen.findByRole("button", { name: "New campaign" });
    expect(forms).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "New campaign" }));
    await screen.findByText(/Page forms are temporarily unavailable/);
    fireEvent.click(screen.getByRole("button", { name: "Retry lead forms" }));
    await screen.findByRole("option", { name: "New enquiry" });
    expect(screen.getByRole("combobox", { name: "Lead form" })).toHaveValue("form-2");
    expect(forms).toHaveBeenCalledTimes(2);
    expect(urls).toEqual(["/api/campaigns/lead-forms", "/api/campaigns/lead-forms?fresh=1"]);
    fireEvent.click(screen.getByRole("button", { name: "Close campaign setup" }));
    expect(requests.every(signal => signal.aborted)).toBe(true);
    expect(mocks.createCampaign).not.toHaveBeenCalled();
  });

  // #671: the banner names each skipped campaign and why, across pages.
  it("names skipped campaigns across pages and clears stale continuation warnings", async () => {
    const sync = vi.fn()
      .mockResolvedValueOnce(Response.json({ campaigns: [], nextCursor: "next/page", skipped: 2, skippedCampaigns: [{ name: "Capped trial", reason: "capped" }, { name: "Old Page ads", reason: "other_page" }] }))
      .mockResolvedValueOnce(Response.json({ campaigns: [], nextCursor: null, skipped: 1, skippedCampaigns: [{ name: "Diwali", reason: "lifetime_budget" }] }))
      .mockResolvedValueOnce(Response.json({ campaigns: [], nextCursor: null, skipped: 0, skippedCampaigns: [] }));
    vi.stubGlobal("fetch", vi.fn((url: string) => url.startsWith("/api/campaigns/sync") ? sync(url) : Promise.resolve(Response.json({ forms: [] }))));
    view(true);
    fireEvent.click(await screen.findByRole("button", { name: "Sync from Meta" }));
    expect(await screen.findByText(/More campaigns are available/)).toHaveTextContent(
      "\"Capped trial\" was left unchanged: it runs on a spend cap AdBrain manages, so sync leaves it as is. \"Old Page ads\" was left unchanged: it advertises a different Facebook Page.");
    fireEvent.click(await screen.findByRole("button", { name: "Sync from Meta" }));
    const done = await screen.findByText(/Campaign sync completed/);
    expect(done).toHaveTextContent("\"Capped trial\" was left unchanged");
    expect(done).toHaveTextContent("\"Diwali\" was left unchanged: it uses a lifetime budget set in Meta, which AdBrain doesn't manage.");
    expect(sync).toHaveBeenNthCalledWith(2, "/api/campaigns/sync?after=next%2Fpage");
    expect(screen.queryByText(/More campaigns are available/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sync from Meta" }));
    await waitFor(() => expect(screen.getByText("Campaign sync completed.")).toBeInTheDocument());
    expect(screen.queryByText(/left unchanged/)).not.toBeInTheDocument();
  });

  it("reports a malformed success response and retries the same page", async () => {
    const sync = vi.fn()
      .mockResolvedValueOnce(Response.json({ campaigns: [], nextCursor: "next-page" }))
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(Response.json({ campaigns: [], nextCursor: null }));
    vi.stubGlobal("fetch", vi.fn((url: string) => url.startsWith("/api/campaigns/sync") ? sync(url) : Promise.resolve(Response.json({ forms: [] }))));
    view(true);
    fireEvent.click(await screen.findByRole("button", { name: "Sync from Meta" }));
    await screen.findByText(/More campaigns are available/);
    fireEvent.click(screen.getByRole("button", { name: "Sync from Meta" }));
    expect(await screen.findByText("Couldn't sync from Meta. Your campaigns below are from the last sync; try Sync from Meta again.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sync from Meta" }));
    await screen.findByText("Campaign sync completed.");
    expect(sync).toHaveBeenNthCalledWith(3, "/api/campaigns/sync?after=next-page");
    expect(screen.queryByText("Couldn't sync from Meta. Your campaigns below are from the last sync; try Sync from Meta again.")).not.toBeInTheDocument();
  });
});
