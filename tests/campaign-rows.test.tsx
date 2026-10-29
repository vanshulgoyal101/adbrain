// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Campaigns } from "@/components/campaigns";
import type { Business, Campaign, CampaignResult } from "@/lib/types";
// #403 S6: the confirm dialog has its own tests (confirm-dialog.test.tsx); here window.confirm stands in for the owner's answer.
vi.mock("@/components/ui/confirm-dialog", () => ({
  useConfirm: () => [async (options: { title: string; description?: string }) => window.confirm([options.title, options.description].filter(Boolean).join(" ")), null],
}));

// #403 S5: a Campaigns row at 390 px: 44 px actions, one "More" menu, and results (or why not) on every row.
const mocks = vi.hoisted(() => ({ drafts: vi.fn(), status: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/meta-connect/meta-connect-dialog", () => ({ MetaConnectDialog: () => null }));
vi.mock("@/components/campaign-chat", () => ({ CampaignChat: () => null }));
vi.mock("@/lib/meta-connect-ui/client", () => ({ createMetaConnectClient: () => mocks, MetaConnectClientError: class extends Error {} }));

const business = { id: "11111111-1111-4111-8111-111111111111", owner_id: "owner-1", name: "Solar installer", locations: ["Jaipur"] } as Business;
// Launched by AdBrain: its ad sets and ads on record, so it can be resumed here (#662).
const paused = {
  id: "campaign-1", name: "Rooftop solar", status: "paused", daily_budget: 280, meta_campaign_id: "120252972379040526", meta_ad_account_id: "act_999",
  meta_page_id: "page_1", meta_connection_generation: 1, meta_adset_id: "set-1", meta_ad_ids: ["ad-1"],
  raw: { source: "campaign_operation", metaResult: { campaignId: "120252972379040526", adSetIds: ["set-1"], adIds: ["ad-1"] } },
} as unknown as Campaign;
const active = { ...paused, id: "campaign-2", name: "Solar EMI", status: "active" } as Campaign;
const result = { impressions: 1200, clicks: 40, leads: 3, cpl: 93, spend: 280 } as CampaignResult;

function view(results: Record<string, CampaignResult> = {}) {
  return render(<Campaigns business={business} approved={[]} initialCampaigns={[paused, active]} initialResults={results} leadForms={[]} leadFormError={null} metaReady={false} adAccountId="act_999" />);
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  localStorage.setItem(`campaign-sync:${business.owner_id}:${business.id}:act_999`, String(Date.now()));
  mocks.drafts.mockResolvedValue([]);
  mocks.status.mockResolvedValue({ authorization: "disconnected" });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
});

describe("Campaigns rows (#403 S5)", () => {
  // #1150: campaigns deleted in Meta fold under "Deleted (n)" after the live list, with one status word.
  it("folds campaigns deleted in Meta under Deleted (n) after the live one", async () => {
    const deleted = (id: string, metaStatus: string) => ({ ...paused, id, name: "Rooftop solar old", status: "completed", raw: { ...paused.raw as object, metaStatus } }) as unknown as Campaign;
    render(<Campaigns business={business} approved={[]} initialCampaigns={[deleted("campaign-8", "DELETED"), deleted("campaign-9", "ARCHIVED"), active]} initialResults={{}} leadForms={[]} leadFormError={null} metaReady={false} adAccountId="act_999" />);
    const live = await screen.findByRole("heading", { name: "Solar EMI" });
    expect(screen.getByRole("heading", { name: /Your campaigns/ })).toHaveTextContent("(1)");
    const fold = screen.getByText("Deleted (2)").closest("details")!;
    expect(fold).not.toHaveAttribute("open");
    expect(within(fold).getAllByRole("heading", { name: "Rooftop solar old" })).toHaveLength(2);
    expect(within(fold).getByText("Deleted in Meta")).toBeInTheDocument();
    expect(within(fold).getByText("Archived in Meta")).toBeInTheDocument();
    expect(fold.contains(live)).toBe(false);
    expect(live.compareDocumentPosition(fold) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(live.closest("article")!).getByText("Running")).toBeInTheDocument();
  });

  // #1171: no nudge toward WhatsApp's AI reply (owner rule: no extra automated WhatsApp messages to customers).
  it("never shows a WhatsApp AI reply nudge, even with a launched WhatsApp campaign", async () => {
    render(<Campaigns business={business} approved={[]} initialCampaigns={[{ ...paused, destination: "whatsapp" } as Campaign]} initialResults={{}} leadForms={[]} leadFormError={null} metaReady={false} adAccountId="act_999" />);
    await screen.findByRole("heading", { name: paused.name! });
    expect(screen.queryByText(/WhatsApp's AI|Business AI/)).toBeNull();
  });

  // #773: a paused AdBrain campaign's audience is edited from its More menu; a running one is paused first.
  // #765 (a): a running AdBrain campaign's audience is editable too (patched in place, or refused before any write).
  it("offers Edit audience on running and paused campaigns, opening the edit dialog", async () => {
    const user = userEvent.setup();
    view();
    const card = async (name: string) => within((await screen.findByRole("heading", { name })).closest("article") as HTMLElement);
    (await card("Solar EMI")).getByRole("button", { name: "More actions for Solar EMI" }).focus();
    await user.keyboard("{Enter}");
    expect(within(await screen.findByRole("menu")).getByRole("menuitem", { name: /Edit audience/ })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    (await card("Rooftop solar")).getByRole("button", { name: "More actions for Rooftop solar" }).focus();
    await user.keyboard("{Enter}");
    await user.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: /Edit audience/ }));
    const dialog = await screen.findByRole("dialog", { name: "Edit audience" });
    expect(within(dialog).getByRole("button", { name: /Check with Meta/ }).className).toMatch(/\bh-11\b/);
  });

  // #775: an AdBrain campaign's ad words are editable while it runs too (a new creative, back to review).
  it("offers Edit ad words on a running AdBrain campaign, opening the ad editor with the review notice", async () => {
    const user = userEvent.setup();
    view();
    const card = within((await screen.findByRole("heading", { name: "Solar EMI" })).closest("article") as HTMLElement);
    card.getByRole("button", { name: "More actions for Solar EMI" }).focus();
    await user.keyboard("{Enter}");
    await user.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: /Edit ad words/ }));
    const dialog = await screen.findByRole("dialog", { name: "Edit ad words" });
    expect(within(dialog).getByRole("note")).toHaveTextContent("goes back to Meta review");
  });

  // #1761 (DPDP erasure): delete every enquiry a campaign brought in, from its More menu, after a confirm.
  it("deletes a campaign's enquiries from its More menu after confirming", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => init?.method === "DELETE" ? Response.json({ ok: true, deleted: 3 }) : Response.json({ campaigns: [], nextCursor: null }));
    vi.stubGlobal("fetch", fetchMock);
    view();
    const card = within((await screen.findByRole("heading", { name: "Solar EMI" })).closest("article") as HTMLElement);
    card.getByRole("button", { name: "More actions for Solar EMI" }).focus();
    await user.keyboard("{Enter}");
    // This file's confirm is window.confirm (mocked above), so the sheet's words reach it as one string.
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await user.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: /Delete its enquiries/ }));
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/^Delete this campaign's enquiries\? .*Your ads aren't affected\.$/));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/leads?campaignId=campaign-2", expect.objectContaining({ method: "DELETE" })));
    expect(await screen.findByText("Deleted 3 enquiries from this campaign.")).toBeInTheDocument();
  });

  it("keeps Pause/Resume and Refresh visible at 44 px and folds the rest into one More menu", async () => {
    const user = userEvent.setup();
    view();
    const row = (await screen.findByRole("heading", { name: "Rooftop solar" })).closest("article")!;
    const inRow = within(row as HTMLElement);
    for (const name of ["Resume", "Refresh results"]) expect(inRow.getByRole("button", { name }).className).toMatch(/\bh-11\b/);
    expect(inRow.queryByRole("link", { name: /Ads Manager/ })).toBeNull();
    expect(inRow.queryByRole("button", { name: "Delete campaign" })).toBeNull();

    const more = inRow.getByRole("button", { name: "More actions for Rooftop solar" });
    expect(more.className).toMatch(/\bsize-11\b/);
    more.focus();
    await user.keyboard("{Enter}");
    const menu = await screen.findByRole("menu");
    const ads = within(menu).getByRole("menuitem", { name: /Open in Ads Manager/ });
    expect(ads).toHaveAttribute("href", expect.stringContaining("selected_campaign_ids=120252972379040526"));
    expect(ads).toHaveAttribute("target", "_blank");

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await user.click(within(menu).getByRole("menuitem", { name: "Delete campaign" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Rooftop solar"));
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("shows saved drafts from the server in the first render, before any fetch answers (#847 CLS)", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const draft = { draftId: "90d1d2bb-466c-4889-9af2-edb533e82531", version: 1, expiresAt: "2026-11-01T00:00:00.000Z",
      input: { businessId: business.id, name: "Diwali leads", mode: "manual", creativeIds: [], dailyBudgetRupees: 300, abTest: false, destination: "instant_form", targeting: {} } };
    render(<Campaigns business={business} approved={[]} initialCampaigns={[paused]} initialResults={{}} initialDrafts={[draft] as never}
      leadForms={[]} leadFormError={null} metaReady={false} adAccountId="act_999" />);
    expect(screen.getByText("Diwali leads")).toBeInTheDocument();
    // #1154: with no setup open, the campaigns come first and the drafts follow them, folded.
    const drafts = screen.getByRole("group", { name: "Saved drafts" });
    expect(drafts).not.toHaveAttribute("open");
    const firstCampaign = screen.getByRole("heading", { name: "Rooftop solar" });
    expect(firstCampaign.compareDocumentPosition(drafts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("says when a row has no results yet inside that card, and shows them when it has (#1588)", async () => {
    view({ [active.id]: result });
    const pausedRow = (await screen.findByRole("heading", { name: "Rooftop solar" })).closest("article") as HTMLElement;
    const activeRow = screen.getByRole("heading", { name: "Solar EMI" }).closest("article") as HTMLElement;
    // Designer (#1588): the line belongs to its card, not under the list or 'Deleted (n)'.
    expect(within(pausedRow).getByText("No results yet. Refresh to get Meta's latest numbers.")).toBeInTheDocument();
    expect(screen.queryByText(/No results yet for/)).toBeNull();
    expect(within(activeRow).queryByText(/No results yet/)).toBeNull();
    expect(within(activeRow).getByText("1,200")).toBeInTheDocument();
  });

  // #1588 (Designer, 390): for a short list the cards come first; search and filter appear at 6+ campaigns and the
  // list's Export sits in its ⋯ menu.
  it("hides search and the status filter below 6 campaigns, and keeps Export in the list's menu", async () => {
    const { unmount } = render(<Campaigns business={business} approved={[]} initialCampaigns={[paused, active]} initialResults={{}} leadForms={[]} leadFormError={null} metaReady adAccountId="act_999" />);
    await screen.findByRole("heading", { name: "Rooftop solar" });
    expect(screen.queryByRole("searchbox", { name: "Search campaigns" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Campaign status" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Export report" })).toBeNull();
    expect(screen.getByRole("button", { name: "More list actions" })).toBeInTheDocument();
    unmount();
    const many = Array.from({ length: 6 }, (_, index) => ({ ...paused, id: `campaign-${index}`, name: `Campaign ${index}` }) as Campaign);
    render(<Campaigns business={business} approved={[]} initialCampaigns={many} initialResults={{}} leadForms={[]} leadFormError={null} metaReady adAccountId="act_999" />);
    expect(await screen.findByRole("searchbox", { name: "Search campaigns" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Campaign status" })).toBeInTheDocument();
  });

  it("shows the empty pattern with one New campaign when there are no campaigns (#1588, #1463)", async () => {
    render(<Campaigns business={business} approved={[]} initialCampaigns={[]} initialResults={{}} leadForms={[]} leadFormError={null} metaReady={false} adAccountId="act_999" />);
    fireEvent.click(screen.getByRole("button", { name: "Close campaign setup" }));
    expect(screen.getByRole("heading", { name: "No campaigns yet" })).toBeInTheDocument();
    expect(screen.getByText("Pick your approved ads and a daily budget. Nothing spends until you go live.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "New campaign" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "New campaign" }));
    expect(screen.getByRole("button", { name: "Close campaign setup" })).toBeInTheDocument();
  });

  // #1926 (Designer, QA's #1656 walk): 0 live with deleted ones or drafts said 'Your campaigns (0)' over nothing.
  describe("none running (#1926)", () => {
    const deleted = (id: string) => ({ ...paused, id, name: "Rooftop solar old", status: "completed", raw: { ...paused.raw as object, metaStatus: "DELETED" } }) as unknown as Campaign;
    const draft = (id: string) => ({ draftId: id, version: 1, expiresAt: "2026-11-01T00:00:00.000Z",
      input: { businessId: business.id, name: `Draft ${id.slice(0, 4)}`, mode: "manual", creativeIds: [], dailyBudgetRupees: 300, abTest: false, destination: "instant_form", targeting: {} } });
    const drafts = ["90d1d2bb-466c-4889-9af2-edb533e82531", "a0d1d2bb-466c-4889-9af2-edb533e82531"].map(draft);

    it("says none running, points to the saved drafts, keeps one New campaign and no lone ⋯", async () => {
      mocks.drafts.mockResolvedValue(drafts);
      render(<Campaigns business={business} approved={[]} initialCampaigns={[deleted("campaign-8"), deleted("campaign-9")]} initialResults={{}}
        initialDrafts={drafts as never} leadForms={[]} leadFormError={null} metaReady adAccountId="act_999" />);
      expect(await screen.findByRole("heading", { name: "None running" })).toBeInTheDocument();
      expect(screen.getByText("Your 2 saved drafts are below.")).toBeInTheDocument();
      // #1934: the header's New campaign is the guided flow (a link); the composer is the quiet More options.
      expect(screen.getAllByRole("link", { name: "New campaign" }).map((link) => link.getAttribute("href"))).toEqual(["/brand?again=1"]);
      expect(screen.queryByRole("button", { name: "New campaign" })).toBeNull();
      expect(screen.getByRole("button", { name: "More options" })).toHaveAttribute("aria-controls", "campaign-composer");
      expect(screen.queryByRole("button", { name: "More list actions" })).toBeNull();
      expect(screen.getByText("Deleted (2)").closest("details")).not.toBeNull();
    });

    it("without drafts, says what to do next", async () => {
      render(<Campaigns business={business} approved={[]} initialCampaigns={[deleted("campaign-8")]} initialResults={{}}
        leadForms={[]} leadFormError={null} metaReady adAccountId="act_999" />);
      expect(await screen.findByRole("heading", { name: "None running" })).toBeInTheDocument();
      expect(screen.getByText("Pick your approved ads and a daily budget. Nothing spends until you go live.")).toBeInTheDocument();
    });

    it("gives Deleted (n) the same chevron as Saved drafts", async () => {
      render(<Campaigns business={business} approved={[]} initialCampaigns={[deleted("campaign-8"), active]} initialResults={{}}
        leadForms={[]} leadFormError={null} metaReady adAccountId="act_999" />);
      const summary = (await screen.findByText("Deleted (1)")).closest("summary")!;
      expect(summary).toHaveClass("list-none");
      expect(summary.querySelector("svg")).not.toBeNull();
    });
  });

  it("shows how many opened WhatsApp and how many messaged (#493)", async () => {
    const whatsapp = { ...active, id: "campaign-3", name: "Solar WhatsApp", raw: { destination: "whatsapp" } } as unknown as Campaign;
    render(<Campaigns business={business} approved={[]} initialCampaigns={[whatsapp]} leadForms={[]} leadFormError={null} metaReady={false} adAccountId="act_999"
      initialResults={{ [whatsapp.id]: { ...result, destination: "whatsapp", leads: 0, cpl: null, conversations: 1, cost_per_conversation: 162, whatsapp_opens: 12 } as CampaignResult }} />);
    const row = (await screen.findByRole("heading", { name: "Solar WhatsApp" })).closest("article") as HTMLElement;
    expect(within(row).getByText("12 opened WhatsApp, 1 messaged you")).toBeInTheDocument();
    // #783: the card's figures and 'Which ad worked' both call them chats.
    expect(within(row).getByText("WhatsApp chats")).toBeInTheDocument();
    expect(within(row).getByText("Cost / chat")).toBeInTheDocument();
  });
});
