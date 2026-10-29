// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Campaigns } from "@/components/campaigns";
import { StaleResultsRefresher } from "@/components/stale-results-refresher";
import { resultsStale, staleCampaignIds } from "@/lib/campaign/results-freshness";
import type { Business, Campaign, CampaignResult } from "@/lib/types";
import hi from "../messages/hi.json";

// #1003: stale live results refresh quietly when the card or Home opens, and every card says how old its numbers are.
const mocks = vi.hoisted(() => ({ drafts: vi.fn(), status: vi.fn(), routerRefresh: vi.fn() }));
vi.mock("@/components/ui/confirm-dialog", () => ({ useConfirm: () => [async () => true, null] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.routerRefresh }) }));
vi.mock("@/components/meta-connect/meta-connect-dialog", () => ({ MetaConnectDialog: () => null }));
vi.mock("@/components/campaign-chat", () => ({ CampaignChat: () => null }));
vi.mock("@/lib/meta-connect-ui/client", () => ({ createMetaConnectClient: () => mocks, MetaConnectClientError: class extends Error {} }));

const business = { id: "11111111-1111-4111-8111-111111111111", owner_id: "owner-1", name: "Solar installer", locations: ["Jaipur"] } as Business;
const paused = {
  id: "campaign-1", name: "Rooftop solar", status: "paused", daily_budget: 280, meta_campaign_id: "120252972379040526", meta_ad_account_id: "act_999",
  meta_page_id: "page_1", meta_connection_generation: 1, meta_adset_id: "set-1", meta_ad_ids: ["ad-1"],
  raw: { source: "campaign_operation", metaResult: { campaignId: "120252972379040526", adSetIds: ["set-1"], adIds: ["ad-1"] } },
} as unknown as Campaign;
const active = { ...paused, id: "campaign-2", name: "Solar EMI", status: "active" } as Campaign;
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
const result = (fetched_at: string, impressions = 1200) =>
  ({ campaign_id: "campaign-2", impressions, clicks: 40, leads: 3, cpl: 93, spend: 280, fetched_at }) as CampaignResult;

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
const refreshCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes("/refresh"));
const card = async (name: string) => within((await screen.findByRole("heading", { name })).closest("article") as HTMLElement);
function view(results: Record<string, CampaignResult>) {
  return render(<Campaigns business={business} approved={[]} initialCampaigns={[paused, active]} initialResults={results} leadForms={[]} leadFormError={null} metaReady={false} adAccountId="act_999" />);
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  localStorage.setItem(`campaign-sync:${business.owner_id}:${business.id}:act_999`, String(Date.now()));
  mocks.drafts.mockResolvedValue([]);
  mocks.status.mockResolvedValue({ authorization: "disconnected" });
  fetchMock.mockImplementation(async () => Response.json({}));
  vi.stubGlobal("fetch", fetchMock);
});

describe("results freshness (#1003)", () => {
  it("counts only live, Meta-bound campaigns whose results are over 10 min old or missing", () => {
    const now = Date.now();
    expect(resultsStale(minutesAgo(9), now)).toBe(false);
    expect(resultsStale(minutesAgo(11), now)).toBe(true);
    expect(resultsStale(undefined, now)).toBe(true);
    const unbound = { ...active, id: "campaign-3", meta_page_id: null } as unknown as Campaign;
    expect(staleCampaignIds([paused, active, unbound], {}, now)).toEqual(["campaign-2"]);
    expect(staleCampaignIds([active], { "campaign-2": result(minutesAgo(3)) }, now)).toEqual([]);
  });

  it("refreshes a stale running campaign once on open, says it's updating, then shows the new numbers and their age", async () => {
    let answer: (response: Response) => void = () => {};
    fetchMock.mockImplementation(async (url) => String(url).includes("/refresh")
      ? new Promise<Response>((resolve) => { answer = resolve; })
      : Response.json({}));
    view({ "campaign-1": { ...result(minutesAgo(600)), campaign_id: "campaign-1" }, "campaign-2": result(minutesAgo(40)) });
    const running = await card("Solar EMI");
    expect(await running.findByText("Updating results…")).toBeInTheDocument();
    expect(running.getByRole("button", { name: "Refresh results" })).toBeDisabled();
    expect(refreshCalls()).toEqual([["/api/campaigns/campaign-2/refresh?ifStale=1", { method: "POST" }]]);
    answer(Response.json({ result: result(new Date().toISOString(), 1500) }));
    expect(await running.findByText("Updated just now")).toBeInTheDocument();
    expect(running.getByText("1,500")).toBeInTheDocument();
    // A paused campaign isn't refreshed; its card still says how old its numbers are.
    expect((await card("Rooftop solar")).getByText("Updated 10h ago")).toBeInTheDocument();
    expect(refreshCalls()).toHaveLength(1);
  });

  it("makes no refresh call when the numbers are fresh, and keeps the old age when a refresh fails", async () => {
    const { unmount } = view({ "campaign-2": result(minutesAgo(3)) });
    expect(await (await card("Solar EMI")).findByText("Updated 3m ago")).toBeInTheDocument();
    expect(refreshCalls()).toEqual([]);
    unmount();
    fetchMock.mockImplementation(async () => Response.json({ error: "Meta is down" }, { status: 502 }));
    view({ "campaign-2": result(minutesAgo(40)) });
    const running = await card("Solar EMI");
    await waitFor(() => expect(running.getByText("Updated 40m ago")).toBeInTheDocument());
    expect(refreshCalls()).toHaveLength(1);
    expect(running.queryByRole("alert")).toBeNull();
  });

  it("Home refreshes stale campaigns one at a time and re-renders once, only when Meta gave new numbers", async () => {
    fetchMock.mockImplementation(async (url) => Response.json(String(url).includes("campaign-a") ? { result: result(new Date().toISOString()) } : { fresh: true }));
    const { rerender } = render(<StaleResultsRefresher campaignIds={["campaign-a", "campaign-b"]} />);
    await waitFor(() => expect(mocks.routerRefresh).toHaveBeenCalledTimes(1));
    expect(refreshCalls().map(([url]) => url)).toEqual(["/api/campaigns/campaign-a/refresh?ifStale=1", "/api/campaigns/campaign-b/refresh?ifStale=1"]);
    rerender(<StaleResultsRefresher campaignIds={["campaign-a", "campaign-b"]} />);
    expect(refreshCalls()).toHaveLength(2);
    // Every campaign came back fresh (no Meta call): nothing to re-render.
    fetchMock.mockClear();
    render(<StaleResultsRefresher campaignIds={["campaign-c"]} />);
    await waitFor(() => expect(refreshCalls()).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.routerRefresh).toHaveBeenCalledTimes(1);
  });

  it("#1438: the campaign card's results read in Hindi when the page passes Hindi words", async () => {
    render(<Campaigns business={business} approved={[]} initialCampaigns={[paused, active]} initialResults={{ "campaign-2": { ...result(minutesAgo(2)), conversations: 6, destination: "whatsapp" } as CampaignResult }}
      leadForms={[]} leadFormError={null} metaReady={false} adAccountId="act_999" verdictWords={{ locale: "hi", messages: hi.verdict }} />);
    const live = await card("Solar EMI");
    expect(live.getByRole("group", { name: "कैसा चल रहा है" })).toBeTruthy();
    expect(live.queryByRole("group", { name: "How it's going" })).toBeNull();
    expect(live.getAllByText(/चैट/).length).toBeGreaterThan(0);
    // The figures under Details too.
    expect(live.getByText("कितनी बार दिखा")).toBeTruthy();
    expect(live.getByText("खर्च / चैट")).toBeTruthy();
    expect(live.queryByText("Impressions")).toBeNull();
  });
});
