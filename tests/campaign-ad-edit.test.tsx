// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Campaigns } from "@/components/campaigns";
import type { DraftDTO, DraftInput } from "@/lib/campaign/connect-contracts";
import type { Business, Campaign, CampaignResult, Creative } from "@/lib/types";

// #280: edit an ad's text or the words on its picture from the campaign's ad picker.
const mocks = vi.hoisted(() => ({
  drafts: vi.fn(), draft: vi.fn(), saveDraft: vi.fn(), updateDraft: vi.fn(), status: vi.fn(), preflight: vi.fn(), createCampaign: vi.fn(), operationForRequest: vi.fn(),
}));
const actions = vi.hoisted(() => ({ setCreativeStatus: vi.fn(), updateCreativeCopy: vi.fn() }));
vi.mock("@/app/(app)/studio/actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/meta-connect/meta-connect-dialog", () => ({ MetaConnectDialog: () => null }));
vi.mock("@/components/campaign-chat", () => ({ CampaignChat: () => null }));
vi.mock("@/lib/meta-connect-ui/client", () => ({ createMetaConnectClient: () => mocks, MetaConnectClientError: class extends Error {} }));

const business = { id: "11111111-1111-4111-8111-111111111111", owner_id: "owner-1", name: "Solaride", phone: "+91 73802 80874", locations: ["Chandigarh"] } as Business;
const creative = { id: "22222222-2222-4222-8222-222222222222", headline: "Wondering whether your roof is ready?", image_url: "/icon.png", status: "approved" } as Creative;
const recommended: DraftInput["targeting"] = {
  age: { mode: "manual", min: 25, max: 55 },
  location: { mode: "ai", includedNames: ["Chandigarh"] },
  audience: { interestNames: ["Solar energy"], rationale: "Homeowners near the offer." },
};
const selected = { adAccountId: "act_1", accountName: "Solar account", pageId: "page_1", pageName: "Solaride Energy", currency: "INR", timezoneName: "Asia/Kolkata", metaBusinessId: null };
let saved: DraftDTO;
let whatsapp: () => Promise<Response>;

function view(owner: Business = business) {
  return render(<Campaigns business={owner} approved={[creative]} initialCampaigns={[]} initialResults={{}} leadForms={[{ id: "form-1", name: "Enquiries", status: "ACTIVE" }]} leadFormError={null} metaReady adAccountId="act_1" />);
}

/** Lets the status read's promise chain land. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));
const statusRead = () => waitFor(() => expect(fetch).toHaveBeenCalledWith(`/api/meta/whatsapp?businessId=${business.id}`, expect.objectContaining({ cache: "no-store" })));

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  localStorage.setItem(`campaign-sync:${business.owner_id}:${business.id}:act_1`, String(Date.now()));
  mocks.drafts.mockResolvedValue([]);
  mocks.status.mockResolvedValue({ authorization: "connected", selected, generation: 1 });
  mocks.saveDraft.mockImplementation(async (input: DraftInput) => {
    saved = { draftId: "33333333-3333-4333-8333-333333333333", version: 1, expiresAt: "2099-01-01T00:00:00.000Z", input };
    return saved;
  });
  mocks.draft.mockImplementation(async () => saved);
  mocks.updateDraft.mockImplementation(async (_id: string, _version: number, input: DraftInput) => (saved = { ...saved, version: saved.version + 1, input }));
  mocks.preflight.mockImplementation(async () => ({
    draftId: saved.draftId, draftVersion: saved.version, connectionGeneration: 1,
    canCreatePaused: true, blockers: [], planHash: "a".repeat(64), currency: "INR",
    perAdSetDailyBudgetRupees: 200, totalDailyBudgetRupees: 200, adSetCount: 1, resolvedAreaLabel: "Chandigarh", selected,
    // The server resolves the masked choice to the full number (core: whatsapp-number.test.ts).
    destination: saved.input.destination, whatsappNumber: saved.input.whatsappNumber === "+91 ••••• 4842" ? "+919800004842" : null,
  }));
  whatsapp = async () => Response.json({ state: "ready", numbers: [{ masked: "+91 ••••• 0874", source: "page" }, { masked: "+91 ••••• 4842", source: "business" }] });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.startsWith("/api/meta/whatsapp") ? whatsapp() : url.endsWith("/picture")
    ? Response.json({ creative: { ...creative, image_url: "/redrawn.png" }, liveNotice: "This ad is live on Meta; your edit applies to new campaigns." })
    : Response.json(url === "/api/campaigns/plan"
    ? { ready: true, targeting: recommended }
    : { forms: [{ id: "form-1", name: "Enquiries", status: "ACTIVE" }] })));
});

describe("campaign ad picker: Edit (#280)", () => {
  it("edits an approved ad's text in place without changing what is selected", async () => {
    actions.updateCreativeCopy.mockResolvedValue({ ok: true, warnings: [], creative: { headline: "Is your roof solar-ready?", primary_text: "Free check.", cta: "Get Quote", generation: null } });
    view();
    await statusRead();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    expect(screen.getByRole("button", { name: creative.headline! })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: `Edit ${creative.headline}` }));
    const panel = screen.getByRole("region", { name: "Edit ad" });
    fireEvent.change(within(panel).getByLabelText("Headline"), { target: { value: "Is your roof solar-ready?" } });
    await act(async () => { fireEvent.click(within(panel).getByRole("button", { name: "Save" })); });

    expect(actions.updateCreativeCopy).toHaveBeenCalledWith(creative.id, expect.objectContaining({ headline: "Is your roof solar-ready?" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Edit ad" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Is your roof solar-ready?" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Saved.")).toBeInTheDocument();
    expect(mocks.createCampaign).not.toHaveBeenCalled();
  });

  it("previews the unsaved headline on the tile while typing, and Cancel restores it (#387)", async () => {
    view();
    await statusRead();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: `Edit ${creative.headline}` }));
    const panel = screen.getByRole("region", { name: "Edit ad" });
    fireEvent.change(within(panel).getByLabelText("Headline"), { target: { value: "Roof ready in a week?" } });
    expect(screen.getByRole("button", { name: "Roof ready in a week?" })).toBeInTheDocument();
    expect(within(panel).getByText("Preview · unsaved changes")).toBeInTheDocument();
    expect(actions.updateCreativeCopy).not.toHaveBeenCalled();
    fireEvent.click(within(panel).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: creative.headline! })).toBeInTheDocument();
  });

  it("redraws the words on the picture and shows the live-on-Meta note", async () => {
    view();
    await statusRead();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: `Edit ${creative.headline}` }));
    const panel = screen.getByRole("region", { name: "Edit ad" });
    fireEvent.click(within(panel).getByRole("tab", { name: "Words on picture" }));
    await act(async () => { fireEvent.click(within(panel).getByRole("button", { name: "Save" })); });
    expect(await screen.findByText("This ad is live on Meta; your edit applies to new campaigns.")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(`/api/creatives/${creative.id}/picture`, expect.objectContaining({ method: "POST" }));
    expect(document.querySelector('img[src*="redrawn"]')).not.toBeNull();
  });

  it("drops a review prepared before the edit so it can't show the old words", async () => {
    actions.updateCreativeCopy.mockResolvedValue({ ok: true, warnings: [], creative: { headline: "Is your roof solar-ready?", primary_text: "Free check.", cta: "Get Quote", generation: null } });
    view();
    await statusRead();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    fireEvent.click(screen.getByRole("button", { name: "Prepare campaign review" }));
    await screen.findByText(/Destination: WhatsApp chat/);
    fireEvent.click(screen.getByRole("button", { name: `Edit ${creative.headline}` }));
    await act(async () => { fireEvent.click(within(screen.getByRole("region", { name: "Edit ad" })).getByRole("button", { name: "Save" })); });
    await waitFor(() => expect(screen.queryByText(/Destination: WhatsApp chat/)).not.toBeInTheDocument());
    expect(mocks.createCampaign).not.toHaveBeenCalled();
  });
});

describe("campaign results: Share on WhatsApp (#372)", () => {
  it("opens WhatsApp with the stored results as a plain summary", async () => {
    const live = { id: "44444444-4444-4444-8444-444444444444", business_id: business.id, name: "Solaride Tricity", objective: "OUTCOME_ENGAGEMENT", destination: "whatsapp",
      status: "active", daily_budget: 280, meta_campaign_id: "120", creative_ids: [], meta_ad_ids: [], raw: {}, created_at: "2026-10-23T00:00:00Z" } as unknown as Campaign;
    const result = { campaign_id: live.id, impressions: 900, clicks: 40, leads: 0, spend: 412, cpl: null, conversations: 6, cost_per_conversation: 68.7,
      destination: "whatsapp", fetched_at: "2026-10-24T09:00:00Z" } as unknown as CampaignResult;
    render(<Campaigns business={business} approved={[creative]} initialCampaigns={[live]} initialResults={{ [live.id]: result }} leadForms={[]} leadFormError={null} metaReady adAccountId="act_1" />);
    const link = await screen.findByRole("link", { name: "Share results on WhatsApp" });
    const text = decodeURIComponent(link.getAttribute("href")!.replace("https://wa.me/?text=", ""));
    expect(text).toBe("Solaride Tricity\nSpent ₹412 (₹280 a day)\n6 WhatsApp chats\n₹68.70 per chat\nNext: running fine, nothing to do.");
    expect(link).toHaveAttribute("target", "_blank");
  });
});
