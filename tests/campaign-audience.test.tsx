// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Campaigns } from "@/components/campaigns";
import type { DraftDTO, DraftInput } from "@/lib/campaign/connect-contracts";
import type { Business, Campaign, Creative } from "@/lib/types";
import type { ConnectionDTO } from "@/lib/meta/connect-contracts";

const mocks = vi.hoisted(() => ({
  drafts: vi.fn(), draft: vi.fn(), saveDraft: vi.fn(), updateDraft: vi.fn(), status: vi.fn(), preflight: vi.fn(), createCampaign: vi.fn(),
  dialog: { current: null as null | { onConnected: (connection: ConnectionDTO) => void; onBeforeStart?: () => Promise<unknown> } },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/meta-connect/meta-connect-dialog", () => ({ MetaConnectDialog: (props: { onConnected: (connection: ConnectionDTO) => void; onBeforeStart?: () => Promise<unknown> }) => { mocks.dialog.current = props; return null; } }));
vi.mock("@/components/campaign-chat", () => ({ CampaignChat: () => null }));
vi.mock("@/lib/meta-connect-ui/client", () => ({ createMetaConnectClient: () => mocks, MetaConnectClientError: class extends Error {} }));

const business = { id: "11111111-1111-4111-8111-111111111111", owner_id: "owner-1", name: "Solar installer", locations: ["Jaipur"] } as Business;
const creative = { id: "22222222-2222-4222-8222-222222222222", headline: "Lower electricity bills", image_url: "/icon.png", status: "approved" } as Creative;
const recommended: DraftInput["targeting"] = {
  age: { mode: "manual", min: 30, max: 65 },
  location: { mode: "ai", includedNames: ["Jaipur"], excludedNames: ["Ajmer"], radiusKm: 20 },
  audience: { interestNames: ["Solar energy"], rationale: "Test local solar interest against the current offer." },
};
const selected = { adAccountId: "act_1", accountName: "Solar account", pageId: "page_1", pageName: "Solar Page", currency: "INR", timezoneName: "Asia/Kolkata", metaBusinessId: null };
let saved: DraftDTO;

function view(metaReady = false) {
  return render(<Campaigns business={business} approved={[creative]} initialCampaigns={[]} initialResults={{}} leadForms={[{ id: "form-1", name: "Enquiries", status: "ACTIVE" }]} leadFormError={null} metaReady={metaReady} adAccountId="" />);
}

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
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

describe("campaign Ads Manager links", () => {
  it.each([
    ["act_2398686420592052", "act_999", "2398686420592052"],
    ["2398686420592052", "act_999", "2398686420592052"],
    [null, "act_999", "999"],
    [null, "", null],
    ["invalid", "act_999", null],
  ])("uses the bound account %s with connection %s", async (boundAccount, connectionAccount, expectedAccount) => {
    const campaign = { id: "campaign-1", name: "Saved campaign", status: "paused", meta_campaign_id: "120252972379040526", meta_ad_account_id: boundAccount } as Campaign;
    render(<Campaigns business={business} approved={[creative]} initialCampaigns={[campaign]} initialResults={{}} leadForms={[]} leadFormError={null} metaReady={false} adAccountId={connectionAccount ?? ""} />);
    const link = await screen.findByRole("link", { name: "Ads Manager" });
    const url = new URL(link.getAttribute("href")!);
    expect(url.origin).toBe("https://adsmanager.facebook.com");
    expect(url.pathname).toBe("/adsmanager/manage/campaigns/");
    expect(url.searchParams.get("act")).toBe(expectedAccount);
    expect(url.searchParams.get("selected_campaign_ids")).toBe(expectedAccount ? campaign.meta_campaign_id : null);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});

describe("campaign sync feedback", () => {
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
    expect(screen.getByLabelText("Lead form")).toHaveValue("");
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
      expect(screen.getByLabelText("Lead form")).toHaveValue("");
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
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/campaigns/lead-forms")).toHaveLength(2));
    expect(mocks.createCampaign).not.toHaveBeenCalled();
  });

  it("loads lead forms once when a connection completes", async () => {
    view(false);
    await act(async () => { await mocks.dialog.current!.onBeforeStart!(); });
    await act(async () => { mocks.dialog.current!.onConnected({ authorization: "connected", selected, generation: 1 } as ConnectionDTO); });
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/campaigns/lead-forms")).toHaveLength(1));
    expect(screen.getByText(/Review your lead form before continuing/)).toBeInTheDocument();
    expect(mocks.createCampaign).not.toHaveBeenCalled();
  });

  it("loads forms only when setup opens, retries failures, and cancels on close", async () => {
    const requests: AbortSignal[] = [];
    const forms = vi.fn().mockResolvedValueOnce(Response.json({ error: "Unavailable" }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ forms: [{ id: "form-2", name: "New enquiry", status: "ACTIVE" }] }));
    vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => {
      if (url === "/api/campaigns/lead-forms") {
        requests.push(options!.signal as AbortSignal);
        return forms();
      }
      return Promise.resolve(Response.json({ campaigns: [], nextCursor: null }));
    }));
    const campaign = { id: "campaign-1", name: "Saved campaign", status: "paused" } as Campaign;
    render(<Campaigns business={business} approved={[creative]} initialCampaigns={[campaign]} initialResults={{}} leadForms={[]} leadFormError={null} metaReady adAccountId="act_1" />);
    await screen.findByText("Campaign sync completed.");
    expect(forms).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "New campaign" }));
    await screen.findByText(/Page forms are temporarily unavailable/);
    fireEvent.click(screen.getByRole("button", { name: "Retry lead forms" }));
    await screen.findByRole("option", { name: "New enquiry" });
    expect(screen.getByLabelText("Lead form")).toHaveValue("");
    expect(forms).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Close campaign setup" }));
    expect(requests.every(signal => signal.aborted)).toBe(true);
    expect(mocks.createCampaign).not.toHaveBeenCalled();
  });

  it("keeps skipped counts across pages and clears stale continuation warnings", async () => {
    const sync = vi.fn()
      .mockResolvedValueOnce(Response.json({ campaigns: [], nextCursor: "next/page", skipped: 2 }))
      .mockResolvedValueOnce(Response.json({ campaigns: [], nextCursor: null, skipped: 1 }))
      .mockResolvedValueOnce(Response.json({ campaigns: [], nextCursor: null, skipped: 0 }));
    vi.stubGlobal("fetch", vi.fn((url: string) => url.startsWith("/api/campaigns/sync") ? sync(url) : Promise.resolve(Response.json({ forms: [] }))));
    view(true);
    expect(await screen.findByText(/More campaigns are available/)).toHaveTextContent("2 campaign(s) could not be imported");
    fireEvent.click(await screen.findByRole("button", { name: "Sync from Meta" }));
    expect(await screen.findByText(/Campaign sync completed/)).toHaveTextContent("3 campaign(s) could not be imported");
    expect(sync).toHaveBeenNthCalledWith(2, "/api/campaigns/sync?after=next%2Fpage");
    expect(screen.queryByText(/More campaigns are available/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sync from Meta" }));
    await waitFor(() => expect(screen.getByText("Campaign sync completed.")).toBeInTheDocument());
    expect(screen.queryByText(/could not be imported/)).not.toBeInTheDocument();
  });

  it("reports a malformed success response and retries the same page", async () => {
    const sync = vi.fn()
      .mockResolvedValueOnce(Response.json({ campaigns: [], nextCursor: "next-page" }))
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(Response.json({ campaigns: [], nextCursor: null }));
    vi.stubGlobal("fetch", vi.fn((url: string) => url.startsWith("/api/campaigns/sync") ? sync(url) : Promise.resolve(Response.json({ forms: [] }))));
    view(true);
    await screen.findByText(/More campaigns are available/);
    fireEvent.click(screen.getByRole("button", { name: "Sync from Meta" }));
    expect(await screen.findByText("Sync failed. Please try again.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sync from Meta" }));
    await screen.findByText("Campaign sync completed.");
    expect(sync).toHaveBeenNthCalledWith(3, "/api/campaigns/sync?after=next-page");
    expect(screen.queryByText("Sync failed. Please try again.")).not.toBeInTheDocument();
  });
});

describe("campaign audience workflow", () => {
  it("surfaces failed eligibility checks without offering a Meta submission", async () => {
    mocks.preflight.mockResolvedValueOnce({
      canCreatePaused: false, planHash: null, currency: "INR", selected,
      perAdSetDailyBudgetRupees: 200, totalDailyBudgetRupees: 200,
      blockers: [{ code: "FORM_UNAVAILABLE", message: "Choose an active Page form." }],
    });
    view();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    fireEvent.click(screen.getByRole("button", { name: "Prepare campaign review" }));
    await screen.findByText("Choose an active Page form.");
    await waitFor(() => expect(screen.getByRole("region", { name: "Campaign review result" })).toHaveFocus());
    expect(screen.queryByRole("button", { name: "Send to Meta (paused)" })).not.toBeInTheDocument();
    expect(mocks.createCampaign).not.toHaveBeenCalled();
  });

  it("requires a lead form before starting AI work for a connected campaign", async () => {
    view(true);
    await waitFor(() => expect(screen.queryByText("Loading lead forms...")).not.toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Lead form"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    fireEvent.click(screen.getByRole("button", { name: "Prepare campaign review" }));
    expect(await screen.findByText("Choose a lead form before preparing campaign review.")).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/campaigns/plan")).toHaveLength(0);
    expect(mocks.saveDraft).not.toHaveBeenCalled();
  });

  it("stops a stalled planner immediately and ignores its result during a retry", async () => {
    const pending: { resolve: (response: Response) => void; signal: AbortSignal }[] = [];
    vi.stubGlobal("fetch", vi.fn((_url: string, options: RequestInit) => new Promise<Response>(resolve => {
      pending.push({ resolve, signal: options.signal as AbortSignal });
    })));
    view();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    fireEvent.click(screen.getByRole("button", { name: "Prepare campaign review" }));
    expect(screen.getByText("Recommending audience...")).toBeInTheDocument();
    const stop = screen.getByRole("button", { name: "Stop preparation" });
    expect(stop).toBeEnabled();
    fireEvent.click(stop);
    expect(pending[0].signal.aborted).toBe(true);
    expect(screen.getByRole("button", { name: "Prepare campaign review" })).toBeEnabled();
    expect(screen.getByText(/Campaign preparation stopped/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Prepare campaign review" }));
    await act(async () => { pending[0].resolve(Response.json({ ready: true, targeting: recommended })); });
    expect(mocks.saveDraft).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Stop preparation" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Prepare campaign review" })).toBeDisabled();
    await act(async () => { pending[1].resolve(Response.json({ ready: true, targeting: recommended })); });
    await screen.findByText("Campaign review");
    expect(mocks.saveDraft).toHaveBeenCalledOnce();
    expect(mocks.createCampaign).not.toHaveBeenCalled();
  });

  it.each([
    ["saveDraft", "Saving draft..."],
    ["status", "Checking Meta connection..."],
    ["preflight", "Checking campaign readiness..."],
  ] as const)("stops during %s without accepting a late response", async (method, stage) => {
    let complete!: (value: unknown) => void;
    mocks[method].mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    view();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    fireEvent.click(screen.getByRole("button", { name: "Prepare campaign review" }));
    await screen.findByText(stage);
    const signal = mocks[method].mock.calls[0].at(-1) as AbortSignal;
    expect(signal.aborted).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Stop preparation" }));
    expect(signal.aborted).toBe(true);
    await act(async () => { complete({}); });
    expect(screen.getByRole("button", { name: "Prepare campaign review" })).toBeEnabled();
    expect(screen.queryByText("Campaign review")).not.toBeInTheDocument();
    expect(mocks.createCampaign).not.toHaveBeenCalled();
    if (method === "saveDraft") expect(mocks.status).not.toHaveBeenCalled();
  });

  it("times out a stalled preparation and preserves editable inputs", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    view();
    await act(async () => {});
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
      fireEvent.click(screen.getByRole("button", { name: "Prepare campaign review" }));
      const signal = vi.mocked(fetch).mock.calls[0][1]!.signal as AbortSignal;
      await act(async () => { vi.advanceTimersByTime(60_000); });
      expect(signal.aborted).toBe(true);
      expect(screen.getByText(/Campaign preparation timed out/)).toBeInTheDocument();
      expect(screen.getByLabelText("Campaign name")).toHaveValue("Solar installer — leads");
      expect(screen.getByRole("button", { name: "Prepare campaign review" })).toBeEnabled();
      expect(mocks.saveDraft).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("aborts preparation when leaving the view", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    const current = view();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    fireEvent.click(screen.getByRole("button", { name: "Prepare campaign review" }));
    const signal = vi.mocked(fetch).mock.calls[0][1]!.signal as AbortSignal;
    current.unmount();
    expect(signal.aborted).toBe(true);
  });

  it("plans once before review and preserves the AI audience through reopen and edit", async () => {
    const first = view();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    fireEvent.click(screen.getByRole("button", { name: "Prepare campaign review" }));
    await screen.findByText("Campaign review");
    await waitFor(() => expect(screen.getByRole("region", { name: "Campaign review result" })).toHaveFocus());
    expect(screen.getByRole("button", { name: "Send to Meta (paused)" })).toBeEnabled();
    expect(mocks.saveDraft).toHaveBeenCalledWith(expect.objectContaining({
      creativeIds: [creative.id], dailyBudgetRupees: 200, leadFormId: "form-1", targeting: recommended,
    }), expect.any(AbortSignal));
    expect(screen.getByText(/Ages: 30-65\+/)).toHaveTextContent("Interests: Solar energy");
    expect(mocks.createCampaign).not.toHaveBeenCalled();
    first.unmount();
    view();
    await waitFor(() => expect(screen.getByLabelText("Minimum age")).toHaveValue(30));
    expect(screen.getByLabelText(/Interests \(up to 5/)).toHaveValue("Solar energy");
    expect(screen.getByLabelText("Planned areas")).toHaveValue("Jaipur");
    fireEvent.change(screen.getByLabelText(/Interests \(up to 5/), { target: { value: " Solar energy \n\nHome improvement\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mocks.updateDraft).toHaveBeenCalledWith(saved.draftId, 1, expect.objectContaining({
      targeting: expect.objectContaining({ audience: { interestNames: ["Solar energy", "Home improvement"], rationale: recommended.audience!.rationale } }),
    }), expect.any(AbortSignal)));
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/campaigns/plan")).toHaveLength(1);
  });

  it("keeps incomplete draft saves free of model calls", async () => {
    view();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalledOnce());
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.preflight).not.toHaveBeenCalled();
  });

  it("does not save or create when AI needs missing service-area facts", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ready: false, questions: [{ question: "Which city does your business serve?" }] }));
    view();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    fireEvent.click(screen.getByRole("button", { name: "Prepare campaign review" }));
    await screen.findByText("Which city does your business serve?");
    expect(mocks.saveDraft).not.toHaveBeenCalled();
    expect(mocks.createCampaign).not.toHaveBeenCalled();
  });
});