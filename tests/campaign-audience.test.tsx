// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { QueryClient, focusManager, onlineManager } from "@tanstack/react-query";
import { Campaigns } from "@/components/campaigns";
import { useCampaignList } from "@/lib/meta-connect-ui/use-campaign-list";
import type { DraftDTO, DraftInput } from "@/lib/campaign/connect-contracts";
import type { Business, Campaign, CampaignResult, Creative } from "@/lib/types";
import type { ConnectionDTO } from "@/lib/meta/connect-contracts";
import { recoveryStorageKey, writeCampaignRecovery } from "@/lib/meta-connect-ui/recovery";

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
let saved: DraftDTO;

// #305: typed areas live under the location "Choose myself"; "Let AdBrain decide" shows them as a summary.
const chooseAreas = () => fireEvent.click(screen.getAllByRole("button", { name: "Choose myself" })[0]);
const savedAreas = (text: string) => waitFor(() => expect(document.body).toHaveTextContent(text));

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

describe("campaign list query cache", () => {
  const first = { id: "first", business_id: business.id, name: "First campaign", status: "paused" } as Campaign;
  const second = { id: "second", business_id: business.id, name: "Second campaign", status: "active" } as Campaign;
  const metric = { campaign_id: first.id, impressions: 42 } as CampaignResult;
  function input() {
    return { ownerId: business.owner_id, businessId: business.id, initialCampaigns: [first],
      initialResults: { [first.id]: metric }, initialNextCursor: "page-two" as string | null, onError: vi.fn() };
  }

  it("seeds SSR data without fetching and isolates simultaneous request clients", async () => {
    const firstView = renderHook(useCampaignList, { initialProps: input() });
    const otherView = renderHook(useCampaignList, { initialProps: { ...input(), initialCampaigns: [second], initialResults: {} } });
    expect(firstView.result.current.campaigns).toEqual([first]);
    expect(otherView.result.current.campaigns).toEqual([second]);
    expect(firstView.result.current.results[first.id]).toEqual(metric);
    expect(fetch).not.toHaveBeenCalled();
    firstView.unmount();
    otherView.unmount();
    const newSession = renderHook(useCampaignList, { initialProps: { ...input(), initialCampaigns: [], initialResults: {} } });
    expect(newSession.result.current.campaigns).toEqual([]);
    expect(newSession.result.current.results).toEqual({});
  });

  it.each(["businessId", "ownerId"] as const)("isolates a changed %s and aborts the old request", async field => {
    let finish!: (response: Response) => void;
    let oldSignal!: AbortSignal;
    const props = input();
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => {
      if (!oldSignal) {
        oldSignal = init.signal!;
        return new Promise<Response>(resolve => { finish = resolve; });
      }
      return Promise.resolve(Response.json({ campaigns: [second], results: {}, nextCursor: null }));
    }));
    const view = renderHook(useCampaignList, { initialProps: props });
    act(() => { void view.result.current.loadCampaignPage(true); });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    view.rerender({ ...props, [field]: "another-tenant" });
    expect(view.result.current.campaigns).toEqual([]);
    expect(view.result.current.results).toEqual({});
    await waitFor(() => expect(oldSignal.aborted).toBe(true));
    await waitFor(() => expect(view.result.current.campaigns).toEqual([second]));
    await act(async () => { finish(Response.json({ campaigns: [first], results: { [first.id]: metric }, nextCursor: "old-cursor" })); });
    expect(view.result.current.campaigns).toEqual([second]);
    expect(view.result.current.results).toEqual({});
    expect(view.result.current.nextListCursor).toBeNull();
  });

  it("cancels immediately while a replacement search is debouncing", async () => {
    let finish!: (response: Response) => void;
    let oldSignal!: AbortSignal;
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => {
      if (!oldSignal) {
        oldSignal = init.signal!;
        return new Promise<Response>(resolve => { finish = resolve; });
      }
      return Promise.resolve(Response.json({ campaigns: [second], results: {}, nextCursor: null }));
    }));
    const view = renderHook(useCampaignList, { initialProps: input() });
    act(() => view.result.current.setCampaignQuery("first"));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    act(() => view.result.current.setCampaignQuery("second"));
    expect(oldSignal.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => { finish(Response.json({ campaigns: [first], results: {}, nextCursor: null })); });
    expect(view.result.current.campaigns).toEqual([]);
    await waitFor(() => expect(view.result.current.campaigns).toEqual([second]));
    expect(String(vi.mocked(fetch).mock.lastCall![0])).toContain("query=second");
  });

  it("deduplicates page rows in stable order and starts manual refresh at the first cursor", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(String(url).includes("cursor=")
      ? { campaigns: [{ ...first, name: "Updated first" }, second], results: { [first.id]: { ...metric, impressions: 99 } }, nextCursor: "page-three" }
      : { campaigns: [second], results: {}, nextCursor: "fresh-cursor" })));
    const view = renderHook(useCampaignList, { initialProps: input() });
    await act(async () => { await view.result.current.loadCampaignPage(true); });
    await waitFor(() => expect(view.result.current.campaigns.map(campaign => campaign.id)).toEqual([first.id, second.id]));
    expect(view.result.current.campaigns[0].name).toBe("Updated first");
    expect(view.result.current.results[first.id].impressions).toBe(99);
    await act(async () => { await view.result.current.loadCampaignPage(); });
    await waitFor(() => expect(view.result.current.campaigns).toEqual([second]));
    expect(String(vi.mocked(fetch).mock.lastCall![0])).not.toContain("cursor=");
    expect(view.result.current.nextListCursor).toBe("fresh-cursor");
  });

  it("requests a status change immediately even while search text is debouncing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ campaigns: [second], results: {}, nextCursor: null })));
    const view = renderHook(useCampaignList, { initialProps: input() });
    act(() => view.result.current.setCampaignQuery("second"));
    expect(fetch).not.toHaveBeenCalled();
    act(() => view.result.current.setStatusFilter("active"));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetch).mock.lastCall![0])).toContain("query=second&status=active");
    await waitFor(() => expect(view.result.current.campaigns).toEqual([second]));
  });

  it("does not retry or refetch on focus/reconnect and permits an explicit retry", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ error: "Read unavailable" }, { status: 503 }))
      .mockResolvedValue(Response.json({ campaigns: [second], results: {}, nextCursor: null })));
    const props = input();
    const view = renderHook(useCampaignList, { initialProps: props });
    await act(async () => { await view.result.current.loadCampaignPage(true); });
    await waitFor(() => expect(props.onError).toHaveBeenCalledWith("Read unavailable"));
    expect(view.result.current.campaigns).toEqual([first]);
    act(() => { focusManager.setFocused(false); onlineManager.setOnline(false); });
    act(() => { focusManager.setFocused(true); onlineManager.setOnline(true); });
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => { await view.result.current.loadCampaignPage(true); });
    await waitFor(() => expect(view.result.current.campaigns).toEqual([first, second]));
    expect(fetch).toHaveBeenCalledTimes(2);
    focusManager.setFocused(undefined);
  });

  it("invalidates only this mounted tenant's reads after a confirmed action", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ campaigns: [{ ...first, status: "active" }], results: {}, nextCursor: null })));
    const view = renderHook(useCampaignList, { initialProps: input() });
    const other = renderHook(useCampaignList, { initialProps: { ...input(), businessId: "other-business", initialCampaigns: [second] } });
    act(() => view.result.current.setCampaigns(current => current.map(campaign => ({ ...campaign, status: "active" }))));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(String(vi.mocked(fetch).mock.lastCall![0])).toContain(business.id);
    expect(other.result.current.campaigns).toEqual([second]);
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  });

  it("keeps a filtered key when new unfiltered server data arrives", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ campaigns: [second], results: {}, nextCursor: null })));
    const props = input();
    const view = renderHook(useCampaignList, { initialProps: props });
    act(() => view.result.current.setStatusFilter("active"));
    await waitFor(() => expect(view.result.current.campaigns).toEqual([second]));
    view.rerender({ ...props, initialCampaigns: [{ ...first, name: "New SSR name" }], initialResults: {} });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(view.result.current.campaigns).toEqual([second]);
    expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).includes("status=active"))).toBe(true);
  });

  it("aborts pending reads on unmount without reporting cancellation as failure", async () => {
    let signal!: AbortSignal;
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => { signal = init.signal!; return new Promise<Response>(() => {}); }));
    const props = input();
    const view = renderHook(useCampaignList, { initialProps: props });
    act(() => { void view.result.current.loadCampaignPage(true); });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    view.unmount();
    expect(signal.aborted).toBe(true);
    expect(props.onError).not.toHaveBeenCalled();
  });

  it("sets explicit freshness, retry and refetch options on the tenant/filter key", () => {
    const mounted = vi.spyOn(QueryClient.prototype, "mount");
    try {
      renderHook(useCampaignList, { initialProps: input() });
      const client = mounted.mock.contexts.at(-1);
      if (!(client instanceof QueryClient)) throw new Error("Expected the mounted campaign query client.");
      const cached = client.getQueryCache().findAll();
      expect(cached).toHaveLength(1);
      expect(cached[0].queryKey).toEqual(["campaign-list", business.owner_id, business.id, { query: "", status: "all" }]);
      expect(cached[0].options).toMatchObject({ staleTime: 30_000, gcTime: 60_000, retry: false, retryOnMount: false,
        refetchOnMount: false, refetchOnWindowFocus: false, refetchOnReconnect: false, refetchInterval: false, networkMode: "always" });
    } finally { mounted.mockRestore(); }
  });

  it("keeps initial results usable through a Strict Mode effect remount", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ campaigns: [first], results: { [first.id]: metric }, nextCursor: "page-two" })));
    const view = renderHook(useCampaignList, { initialProps: input(), wrapper: StrictMode });
    await waitFor(() => expect(view.result.current.campaigns).toEqual([first]));
    expect(view.result.current.results[first.id]).toEqual(metric);
    expect(view.result.current.nextListCursor).toBe("page-two");
  });
});
describe("campaign audience workflow", () => {
  it("withholds WhatsApp submission when the Page-linked number is unverified", async () => {
    mocks.preflight.mockImplementation(async () => ({
      draftId: saved.draftId, draftVersion: saved.version, connectionGeneration: 1,
      canCreatePaused: false, blockers: [{ code: "PREFLIGHT_BLOCKED", message: "Connect a WhatsApp Business number to the selected Facebook Page and verify access before reviewing.", action: null }],
      planHash: null, currency: "INR", perAdSetDailyBudgetRupees: 200,
      totalDailyBudgetRupees: 200, adSetCount: 1, resolvedAreaLabel: "Jaipur",
      selected, destination: "whatsapp", whatsappNumber: null,
    }));
    view();
    fireEvent.click(screen.getByRole("radio", { name: "WhatsApp chat" }));
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    fireEvent.click(screen.getByRole("button", { name: "Check my campaign (nothing spends)" }));
    expect(await screen.findByText("Connect a WhatsApp Business number to the selected Facebook Page and verify access before reviewing.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Send to Meta (paused)" })).not.toBeInTheDocument();
    expect(mocks.createCampaign).not.toHaveBeenCalled();
  });

  // jsdom has no layout, so the phone rules are the max-sm classes the tiles carry.
  it("keeps nine ads to two compact rows on a phone, with a Show all button (#305)", () => {
    const ads = Array.from({ length: 9 }, (_, index) => ({ ...creative, id: `22222222-2222-4222-8222-22222222220${index}`, headline: `Ad ${index + 1}` }));
    render(<Campaigns business={business} approved={ads} newCampaign={{ creativeIds: [ads[8].id] }} initialCampaigns={[]} initialResults={{}} leadForms={[{ id: "form-1", name: "Enquiries", status: "ACTIVE" }]} leadFormError={null} metaReady={false} adAccountId="" />);
    const tile = (name: string) => screen.getByRole("button", { name }).parentElement!;
    expect(tile("Ad 1").parentElement).toHaveClass("grid-cols-3");
    expect(screen.getByText("Ad 1", { selector: "p" })).toHaveClass("max-sm:hidden");
    expect(["Ad 1", "Ad 6"].map((name) => tile(name).className)).not.toContain("max-sm:hidden");
    expect(tile("Ad 7")).toHaveClass("max-sm:hidden");
    expect(tile("Ad 9")).not.toHaveClass("max-sm:hidden");
    expect(screen.getByRole("button", { name: "Ad 9" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Show all 9 ads" }));
    expect(tile("Ad 7")).not.toHaveClass("max-sm:hidden");
    expect(screen.queryByRole("button", { name: "Show all 9 ads" })).not.toBeInTheDocument();
  });

  it("asks where ads show once: the area boxes live under Choose myself (#305)", async () => {
    view();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    expect(screen.getAllByText("Where should ads show?")).toHaveLength(1);
    expect(screen.queryByLabelText("Planned areas")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Excluded areas")).not.toBeInTheDocument();
    chooseAreas();
    fireEvent.change(screen.getByLabelText("Planned areas"), { target: { value: "Jaipur" } });
    fireEvent.change(screen.getByLabelText("Excluded areas"), { target: { value: "Ajmer" } });
    expect(screen.getAllByRole("button", { name: "Choose myself" })[0]).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getAllByRole("button", { name: "Let AdBrain decide" })[0]);
    await savedAreas("Saved campaign areas: Jaipur; excluding Ajmer.");
    expect(screen.queryByLabelText("Planned areas")).not.toBeInTheDocument();
  });

  it("shows a close icon, not a plus, while campaign setup is open (#305)", () => {
    view();
    const close = screen.getByRole("button", { name: "Close campaign setup" });
    expect(close.querySelector(".lucide-x")).not.toBeNull();
    expect(close.querySelector(".lucide-plus")).toBeNull();
  });

  it("checks the Meta connection while the audience is still being planned (#366)", async () => {
    let finishPlan!: () => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((resolve) => { finishPlan = () => resolve(Response.json({ ready: true, targeting: recommended })); }));
    view();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    fireEvent.click(screen.getByRole("button", { name: "Check my campaign (nothing spends)" }));
    await waitFor(() => expect(mocks.status).toHaveBeenCalledOnce());
    expect(mocks.saveDraft).not.toHaveBeenCalled();
    finishPlan();
    await screen.findByText("Campaign review");
    expect(mocks.status).toHaveBeenCalledOnce();
    expect(mocks.preflight).toHaveBeenCalledOnce();
    expect(mocks.createCampaign).not.toHaveBeenCalled();
  });

  it("generates detailed targeting even when location and age are manual", async () => {
    view();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    chooseAreas();
    fireEvent.change(screen.getByLabelText("Planned areas"), { target: { value: "Jaipur" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Choose myself" })[1]);
    fireEvent.click(screen.getByRole("button", { name: "Check my campaign (nothing spends)" }));
    await screen.findByText("Campaign review");
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/campaigns/plan")).toHaveLength(1);
    expect(saved.input.targeting.audience?.interestNames).toEqual(["Solar energy"]);
    expect(mocks.createCampaign).not.toHaveBeenCalled();
  });

  it("blocks an empty AI interest response instead of saving a broad audience", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ready: true, targeting: { ...recommended, audience: { ...recommended.audience, interestNames: [] } } }));
    view();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    fireEvent.click(screen.getByRole("button", { name: "Check my campaign (nothing spends)" }));
    await screen.findByText("The detailed targeting recommendation is incomplete. Try again.");
    expect(mocks.saveDraft).not.toHaveBeenCalled();
    expect(mocks.createCampaign).not.toHaveBeenCalled();
  });

  it("continues with default targeting when the AI planner is unavailable", async () => {
    const rationale = "AI audience planning was unavailable, so this plan uses defaults.";
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ready: true, fallback: true, targeting: { ...recommended, audience: { interestNames: [], rationale } } }));
    view();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    fireEvent.click(screen.getByRole("button", { name: "Check my campaign (nothing spends)" }));
    await screen.findByText("Campaign review");
    expect(screen.getAllByText(rationale).length).toBeGreaterThan(0);
    expect(saved.input.targeting.audience).toEqual({ interestNames: [], rationale });
    expect(mocks.createCampaign).not.toHaveBeenCalled();
  });

  it("surfaces failed eligibility checks without offering a Meta submission", async () => {
    mocks.preflight.mockResolvedValueOnce({
      canCreatePaused: false, planHash: null, currency: "INR", selected,
      perAdSetDailyBudgetRupees: 200, totalDailyBudgetRupees: 200,
      blockers: [{ code: "FORM_UNAVAILABLE", message: "Choose an active Page form." }],
    });
    view();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    fireEvent.click(screen.getByRole("button", { name: "Check my campaign (nothing spends)" }));
    await screen.findByText("Choose an active Page form.");
    await waitFor(() => expect(screen.getByRole("region", { name: "Campaign review result" })).toHaveFocus());
    expect(screen.queryByRole("button", { name: "Send to Meta (paused)" })).not.toBeInTheDocument();
    expect(mocks.createCampaign).not.toHaveBeenCalled();
  });

  it("re-decides age using the new mode while retaining chosen locations and campaign settings", async () => {
    view();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    chooseAreas();
    fireEvent.change(screen.getByLabelText("Planned areas"), { target: { value: "Austin, Texas\nRound Rock, Texas" } });
    fireEvent.change(screen.getByLabelText("Excluded areas"), { target: { value: "Dallas, Texas" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Choose myself" })[1]);
    fireEvent.change(screen.getByLabelText("Minimum age"), { target: { value: "40" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Let AdBrain decide" })[1]);
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const input = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).audienceDraft;
    expect(input).toMatchObject({ dailyBudgetRupees: 300, creativeIds: [creative.id], leadFormId: "form-1", abTest: false });
    expect(input.targeting.age.mode).toBe("ai");
    expect(input.targeting.location).toMatchObject({ mode: "manual", includedNames: ["Austin, Texas", "Round Rock, Texas"], excludedNames: ["Dallas, Texas"] });
    await waitFor(() => expect(screen.getByLabelText("Minimum age")).toHaveValue(30));
    expect(mocks.saveDraft).not.toHaveBeenCalled();
  });

  it("releases old areas for a fresh location decision but retains exclusions and manual ages", async () => {
    view();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    chooseAreas();
    fireEvent.change(screen.getByLabelText("Planned areas"), { target: { value: "Delhi" } });
    fireEvent.change(screen.getByLabelText("Excluded areas"), { target: { value: "Ajmer" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Choose myself" })[1]);
    fireEvent.change(screen.getByLabelText("Minimum age"), { target: { value: "40" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Let AdBrain decide" })[0]);
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const input = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).audienceDraft;
    expect(input.targeting.location).toMatchObject({ mode: "ai", included: [], includedNames: [], excludedNames: ["Ajmer"] });
    expect(input.targeting.age).toMatchObject({ mode: "manual", min: 40 });
    await savedAreas("Saved campaign areas: Jaipur; excluding Ajmer.");
  });

  it("preserves comma-containing locations, radius and edited interests through save and reopen", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ready: true, targeting: { ...recommended, location: { ...recommended.location, includedNames: ["Austin, Texas", "Round Rock, Texas"] } } }));
    const first = view();
    expect(screen.getByLabelText("Gender")).toHaveValue("all");
    fireEvent.change(screen.getByLabelText("Gender"), { target: { value: "women" } });
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    fireEvent.click(screen.getByRole("button", { name: "Recommend audience" }));
    await screen.findByLabelText("Minimum age");
    await savedAreas("Saved campaign areas: Austin, Texas, Round Rock, Texas; excluding Ajmer.");
    fireEvent.change(screen.getByRole("slider"), { target: { value: "35" } });
    fireEvent.change(screen.getByLabelText(/Interests \(up to 5/), { target: { value: "Home improvement" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalledOnce());
    expect(saved.input.targeting).toMatchObject({
      gender: "women",
      location: { mode: "manual", includedNames: ["Austin, Texas", "Round Rock, Texas"], radiusKm: 35 },
      audience: { interestNames: ["Home improvement"] },
    });
    first.unmount();
    view();
    await waitFor(() => expect(screen.getByLabelText("Planned areas")).toHaveValue("Austin, Texas\nRound Rock, Texas"));
    expect(screen.getByRole("slider")).toHaveValue("35");
    expect(screen.getByLabelText(/Interests \(up to 5/)).toHaveValue("Home improvement");
    expect(screen.getByLabelText("Gender")).toHaveValue("women");
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/campaigns/plan")).toHaveLength(1);
  });

  it("keeps inputs on recommendation failure and permits an explicit retry", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: "Recommendation unavailable" }, { status: 502 }));
    view();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    chooseAreas();
    fireEvent.change(screen.getByLabelText("Planned areas"), { target: { value: "Delhi" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Let AdBrain decide" })[0]);
    await screen.findByText("Recommendation unavailable");
    expect(screen.getByLabelText("Planned areas")).toHaveValue("Delhi");
    fireEvent.click(screen.getAllByRole("button", { name: "Let AdBrain decide" })[0]);
    await savedAreas("Saved campaign areas: Jaipur; excluding Ajmer.");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(mocks.saveDraft).not.toHaveBeenCalled();
    expect(mocks.createCampaign).not.toHaveBeenCalled();
  });

  it("requests and displays a location decision when the owner clicks decide", async () => {
    view();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    fireEvent.click(screen.getAllByRole("button", { name: "Let AdBrain decide" })[0]);
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/campaigns/plan")).toHaveLength(1));
    await savedAreas("Saved campaign areas: Jaipur; excluding Ajmer.");
    expect(screen.getByLabelText("Minimum age")).toHaveValue(30);
    expect(mocks.saveDraft).not.toHaveBeenCalled();
    expect(mocks.createCampaign).not.toHaveBeenCalled();
  });

  it("requires a lead form before starting AI work for a connected campaign", async () => {
    view(true);
    await waitFor(() => expect(screen.queryByText("Loading lead forms...")).not.toBeInTheDocument());
    fireEvent.change(screen.getByRole("combobox", { name: "Lead form" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    fireEvent.click(screen.getByRole("button", { name: "Check my campaign (nothing spends)" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Check my campaign (nothing spends)" }));
    expect(screen.getByText("Recommending audience...")).toBeInTheDocument();
    const stop = screen.getByRole("button", { name: "Stop preparation" });
    expect(stop).toBeEnabled();
    fireEvent.click(stop);
    expect(pending[0].signal.aborted).toBe(true);
    expect(screen.getByRole("button", { name: "Check my campaign (nothing spends)" })).toBeEnabled();
    expect(screen.getByText(/Campaign preparation stopped/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check my campaign (nothing spends)" }));
    await act(async () => { pending[0].resolve(Response.json({ ready: true, targeting: recommended })); });
    expect(mocks.saveDraft).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Stop preparation" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Check my campaign (nothing spends)" })).toBeDisabled();
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
    fireEvent.click(screen.getByRole("button", { name: "Check my campaign (nothing spends)" }));
    await screen.findByText(stage);
    const signal = mocks[method].mock.calls[0].at(-1) as AbortSignal;
    expect(signal.aborted).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Stop preparation" }));
    expect(signal.aborted).toBe(true);
    await act(async () => { complete({}); });
    expect(screen.getByRole("button", { name: "Check my campaign (nothing spends)" })).toBeEnabled();
    expect(screen.queryByText("Campaign review")).not.toBeInTheDocument();
    expect(mocks.createCampaign).not.toHaveBeenCalled();
    if (method === "saveDraft") {
      // #366: the connection check started with Prepare; stopping aborts it too, and nothing runs after.
      expect((mocks.status.mock.calls[0].at(-1) as AbortSignal).aborted).toBe(true);
      expect(mocks.preflight).not.toHaveBeenCalled();
    }
  });

  it("times out a stalled preparation and preserves editable inputs", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    view();
    await act(async () => {});
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
      fireEvent.click(screen.getByRole("button", { name: "Check my campaign (nothing spends)" }));
      const signal = vi.mocked(fetch).mock.calls[0][1]!.signal as AbortSignal;
      await act(async () => { vi.advanceTimersByTime(60_000); });
      expect(signal.aborted).toBe(true);
      expect(screen.getByText(/Campaign preparation timed out/)).toBeInTheDocument();
      expect(screen.getByLabelText("Campaign name")).toHaveValue("Solar installer — leads");
      expect(screen.getByRole("button", { name: "Check my campaign (nothing spends)" })).toBeEnabled();
      expect(mocks.saveDraft).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("aborts preparation when leaving the view", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    const current = view();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    fireEvent.click(screen.getByRole("button", { name: "Check my campaign (nothing spends)" }));
    const signal = vi.mocked(fetch).mock.calls[0][1]!.signal as AbortSignal;
    current.unmount();
    expect(signal.aborted).toBe(true);
  });

  it("plans once before review and preserves the AI audience through reopen and edit", async () => {
    const first = view();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    fireEvent.click(screen.getByRole("button", { name: "Check my campaign (nothing spends)" }));
    await screen.findByText("Campaign review");
    await waitFor(() => expect(screen.getByRole("region", { name: "Campaign review result" })).toHaveFocus());
    expect(screen.getByRole("button", { name: "Send to Meta (paused)" })).toBeEnabled();
    expect(mocks.saveDraft).toHaveBeenCalledWith(expect.objectContaining({
      creativeIds: [creative.id], dailyBudgetRupees: 300, leadFormId: "form-1", targeting: { ...recommended, gender: "all" },
    }), expect.any(AbortSignal));
    expect(screen.getByText(/Ages: 30-65\+/)).toHaveTextContent("Interests: Solar energy");
    expect(mocks.createCampaign).not.toHaveBeenCalled();
    first.unmount();
    view();
    await waitFor(() => expect(screen.getByLabelText("Minimum age")).toHaveValue(30));
    expect(screen.getByLabelText(/Interests \(up to 5/)).toHaveValue("Solar energy");
    expect(document.body).toHaveTextContent("Saved campaign areas: Jaipur; excluding Ajmer.");
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
    fireEvent.click(screen.getByRole("button", { name: "Check my campaign (nothing spends)" }));
    await screen.findByText("Which city does your business serve?");
    expect(mocks.saveDraft).not.toHaveBeenCalled();
    expect(mocks.createCampaign).not.toHaveBeenCalled();
  });
  it("shows interview handoff without losing editor values or silently saving a campaign", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ready: false, questions: [], handoff: {
      reason: "no_progress", message: "Your answers are saved. Finish the remaining settings in the campaign editor.",
    } }));
    view();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    chooseAreas();
    fireEvent.change(screen.getByLabelText("Planned areas"), { target: { value: "Hisar" } });
    fireEvent.click(screen.getByRole("button", { name: "Check my campaign (nothing spends)" }));
    expect(await screen.findByText("Your answers are saved. Finish the remaining settings in the campaign editor.")).toBeVisible();
    expect(screen.getByLabelText("Planned areas")).toHaveValue("Hisar");
    expect(mocks.saveDraft).not.toHaveBeenCalled();
    expect(mocks.createCampaign).not.toHaveBeenCalled();
  });
});
describe("campaign review walkthrough dead ends (#158)", () => {
  const websiteMessage = "Add your business website on the Your business page. Meta lead ads must link to the advertiser's own website, not Facebook.";

  it("shows the small saved thumbnail in the ad picker and falls back to the original", () => {
    const base = "https://example.supabase.co/storage/v1/object/public/creatives/biz-1/group-1";
    render(<Campaigns business={business} approved={[{ ...creative, image_url: `${base}/originals-v1/value-ad-1.png` }]} initialCampaigns={[]} initialResults={{}} leadForms={[]} leadFormError={null} metaReady={false} adAccountId="" />);
    const image = screen.getByRole("img", { name: creative.headline! });
    expect(image).toHaveAttribute("src", `${base}/thumbnails-v1/value-ad-1.webp`);
    fireEvent.error(image);
    expect(image).toHaveAttribute("src", `${base}/originals-v1/value-ad-1.png`);
  });

  it("links the website blocker to Your business", async () => {
    mocks.preflight.mockImplementation(async () => ({
      draftId: saved.draftId, draftVersion: saved.version, connectionGeneration: 1,
      canCreatePaused: false, blockers: [{ code: "PREFLIGHT_BLOCKED", message: websiteMessage, action: { kind: "open_brand" } }],
      planHash: null, currency: "INR", perAdSetDailyBudgetRupees: 200, totalDailyBudgetRupees: 200, adSetCount: 1,
      resolvedAreaLabel: "Jaipur", selected,
    }));
    view();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    fireEvent.click(screen.getByRole("button", { name: "Check my campaign (nothing spends)" }));
    expect(await screen.findByRole("link", { name: "Open your business details" })).toHaveAttribute("href", "/brand");
    expect(screen.getByText(websiteMessage)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send to Meta (paused)" })).toBeNull();
    // #637: a blocked review is a warning that names what to fix, not a success card.
    const review = screen.getByRole("region", { name: "Campaign review result" });
    expect(within(review).getByText("Fix 1 item before sending to Meta")).toBeInTheDocument();
    expect(within(review).queryByText("Campaign review")).toBeNull();
    expect(review.firstElementChild).toHaveClass("bg-amber-50");
    expect(review.firstElementChild).not.toHaveClass("bg-blue-50");
    expect(within(review).getByText(/Send to Meta \(paused\) appears once this is fixed/)).toBeInTheDocument();
  });

  it("shows the owner's own send as sending, not as a locked previous request", async () => {
    let finish!: (value: unknown) => void;
    mocks.createCampaign.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    view();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    fireEvent.click(screen.getByRole("button", { name: "Check my campaign (nothing spends)" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send to Meta (paused)" }));
    expect(await screen.findByRole("button", { name: "Sending to Meta…" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "WhatsApp chat" })).toBeDisabled();
    expect(screen.queryByText("Destination is locked until the previous campaign request is resolved.")).toBeNull();
    expect(screen.queryByText("The previous campaign request has not been confirmed.")).toBeNull();
    await act(async () => { finish({ operationId: "44444444-4444-4444-8444-444444444444", state: "succeeded", checkpoints: [], externalIds: {}, error: null }); });
    await screen.findByText("Paused campaign created. Review it before activating spend.");
    expect(screen.queryByRole("button", { name: "Sending to Meta…" })).toBeNull();
  });

  it("reports a restored finished launch once without reopening its draft", async () => {
    const draft: DraftDTO = { draftId: "33333333-3333-4333-8333-333333333333", version: 1, expiresAt: "2099-01-01T00:00:00.000Z",
      input: { businessId: business.id, name: "Sent launch", goal: "Leads", mode: "manual", creativeIds: [creative.id], dailyBudgetRupees: 200, leadFormId: "form-1", targeting: {}, abTest: false } };
    const key = recoveryStorageKey(business.owner_id, business.id);
    writeCampaignRecovery(sessionStorage, key, { draft, operationId: null, request: {
      businessId: business.id, draftId: draft.draftId, draftVersion: 1, planHash: "a".repeat(64), connectionGeneration: 1, idempotencyKey: "original-request-identity",
    } });
    mocks.operationForRequest.mockResolvedValue({ operationId: "44444444-4444-4444-8444-444444444444", state: "succeeded", checkpoints: [], externalIds: {}, error: null });
    view();
    await screen.findByText("Paused campaign created. Review it before activating spend.");
    expect(sessionStorage.getItem(key)).toBeNull();
    expect(document.getElementById("campaign-composer")!.hidden).toBe(true);
    expect(screen.getByLabelText("Campaign name")).not.toHaveValue("Sent launch");
    expect(screen.queryByRole("region", { name: "Campaign review result" })).toBeNull();
    expect(mocks.draft).not.toHaveBeenCalled();
    expect(mocks.preflight).not.toHaveBeenCalled();
    expect(mocks.createCampaign).not.toHaveBeenCalled();
  });
});

describe("background audience plan (#366)", () => {
  const planCalls = () => vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/campaigns/plan").length;
  const planned = () => waitFor(() => expect(planCalls()).toBe(1), { timeout: 3000 });

  it("plans once the ads are chosen, and Prepare uses that plan instead of waiting for another", async () => {
    view();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    expect(planCalls()).toBe(0);
    await planned();
    fireEvent.click(screen.getByRole("button", { name: "Check my campaign (nothing spends)" }));
    await screen.findByText("Campaign review");
    expect(planCalls()).toBe(1);
    expect(mocks.saveDraft.mock.calls[0][0].targeting.audience).toEqual(recommended.audience);
  }, 10_000);

  it("plans again at Prepare when the goal changed after the background plan", async () => {
    view();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    await planned();
    fireEvent.change(screen.getByLabelText("Campaign goal"), { target: { value: "Rooftop solar for homes" } });
    fireEvent.click(screen.getByRole("button", { name: "Check my campaign (nothing spends)" }));
    await screen.findByText("Campaign review");
    expect(planCalls()).toBe(2);
    const prepared = vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/campaigns/plan")[1][1] as RequestInit;
    expect(JSON.parse(String(prepared.body)).goal).toBe("Rooftop solar for homes");
  }, 10_000);

  it("reuses the plan when only the campaign name and budget were typed afterwards, as the smoke does (#504)", async () => {
    view();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    await planned();
    fireEvent.change(screen.getByLabelText("Campaign name"), { target: { value: "Smoke campaign" } });
    fireEvent.change(document.querySelector("#budget")!, { target: { value: "350" } });
    fireEvent.click(screen.getByRole("button", { name: "Check my campaign (nothing spends)" }));
    await screen.findByText("Campaign review");
    expect(planCalls()).toBe(1);
  }, 10_000);

  it("quietly stops a stale background plan when Prepare plans for a changed goal (#504)", async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url !== "/api/campaigns/plan") return Promise.resolve(Response.json({ forms: [{ id: "form-1", name: "Enquiries", status: "ACTIVE" }] }));
      signals.push(init!.signal!);
      // The background plan never answers; Prepare's own plan does.
      return signals.length === 1 ? new Promise<Response>(() => {}) : Promise.resolve(Response.json({ ready: true, targeting: recommended }));
    }));
    const consoleError = vi.spyOn(console, "error");
    view();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    await planned();
    fireEvent.change(screen.getByLabelText("Campaign goal"), { target: { value: "Rooftop solar for homes" } });
    fireEvent.click(screen.getByRole("button", { name: "Check my campaign (nothing spends)" }));
    await screen.findByText("Campaign review");
    expect(signals[0].aborted).toBe(true);
    expect(planCalls()).toBe(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalled();
  }, 10_000);

  it("stops an in-flight background plan quietly when the page closes (#504)", async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url !== "/api/campaigns/plan") return Promise.resolve(Response.json({ forms: [{ id: "form-1", name: "Enquiries", status: "ACTIVE" }] }));
      signals.push(init!.signal!);
      return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
    }));
    const consoleError = vi.spyOn(console, "error");
    const { unmount } = view();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    await planned();
    unmount();
    expect(signals[0].aborted).toBe(true);
    await act(async () => {});
    expect(consoleError).not.toHaveBeenCalled();
  }, 10_000);

  it("plans again at Prepare when the background plan failed", async () => {
    let first = true;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url !== "/api/campaigns/plan") return Response.json({ forms: [{ id: "form-1", name: "Enquiries", status: "ACTIVE" }] });
      if (first) { first = false; return Response.json({ error: "Planner unavailable" }, { status: 503 }); }
      return Response.json({ ready: true, targeting: recommended });
    }));
    view();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    await planned();
    fireEvent.click(screen.getByRole("button", { name: "Check my campaign (nothing spends)" }));
    await screen.findByText("Campaign review");
    expect(planCalls()).toBe(2);
    expect(screen.queryByText("Planner unavailable")).not.toBeInTheDocument();
  }, 10_000);
});
