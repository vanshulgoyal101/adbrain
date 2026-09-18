// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Campaigns } from "@/components/campaigns";
import type { DraftDTO, DraftInput } from "@/lib/campaign/connect-contracts";
import type { Business, Campaign, Creative } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  drafts: vi.fn(), draft: vi.fn(), saveDraft: vi.fn(), updateDraft: vi.fn(), status: vi.fn(), preflight: vi.fn(), createCampaign: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/meta-connect/meta-connect-dialog", () => ({ MetaConnectDialog: () => null }));
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
  it("plans once before review and preserves the AI audience through reopen and edit", async () => {
    const first = view();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    fireEvent.click(screen.getByRole("button", { name: "Prepare campaign review" }));
    await screen.findByText("Campaign review");
    expect(mocks.saveDraft).toHaveBeenCalledWith(expect.objectContaining({
      creativeIds: [creative.id], dailyBudgetRupees: 200, leadFormId: "form-1", targeting: recommended,
    }));
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
    })));
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