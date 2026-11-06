// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Campaigns } from "@/components/campaigns";
import type { DraftDTO, DraftInput } from "@/lib/campaign/connect-contracts";
import type { Business, Creative } from "@/lib/types";

// #235: the campaign form picks the WhatsApp button number; #1171: every new campaign opens on WhatsApp.
const mocks = vi.hoisted(() => ({
  drafts: vi.fn(), draft: vi.fn(), saveDraft: vi.fn(), updateDraft: vi.fn(), status: vi.fn(), preflight: vi.fn(), createCampaign: vi.fn(), operationForRequest: vi.fn(), campaignChat: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/meta-connect/meta-connect-dialog", () => ({ MetaConnectDialog: () => null }));
vi.mock("@/components/campaign-chat", () => ({ CampaignChat: (props: unknown) => { mocks.campaignChat(props); return null; } }));
vi.mock("@/lib/meta-connect-ui/client", () => ({ createMetaConnectClient: () => mocks, MetaConnectClientError: class extends Error {} }));

const business = { id: "11111111-1111-4111-8111-111111111111", owner_id: "owner-1", name: "Solaride", phone: "+91 73802 80874", locations: ["Chandigarh"] } as Business;
const creative = { id: "22222222-2222-4222-8222-222222222222", headline: "Wondering whether your roof is ready?", image_url: "/icon.png", status: "approved" } as Creative;
const recommended: DraftInput["targeting"] = {
  age: { mode: "manual", min: 25, max: 55 },
  location: { mode: "ai", includedNames: ["Chandigarh"] },
  audience: { interestNames: ["Solar energy"], rationale: "Homeowners near the offer." },
};
const selected = { adAccountId: "act_1", accountName: "Solar account", pageId: "page_1", pageName: "Solaride Energy", currency: "INR", timezoneName: "Asia/Kolkata", metaBusinessId: null };
const PAGE_CHOICE = "a".repeat(64);
const BUSINESS_CHOICE = "b".repeat(64);
const OLD_CHOICE = "c".repeat(64);
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
  whatsapp = async () => Response.json({ state: "ready", numbers: [
    { masked: "+91 ••••• 0874", source: "page", choiceId: PAGE_CHOICE },
    { masked: "+91 ••••• 4842", source: "business", choiceId: BUSINESS_CHOICE },
  ] });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.startsWith("/api/meta/whatsapp") ? whatsapp() : Response.json(url === "/api/campaigns/plan"
    ? { ready: true, targeting: recommended }
    : { forms: [{ id: "form-1", name: "Enquiries", status: "ACTIVE" }] })));
});

describe("campaign WhatsApp button number (#235)", () => {
  it("opens an India business's new campaign on WhatsApp and sends the chosen number", async () => {
    view();
    const picker = await screen.findByLabelText("WhatsApp button number");
    expect(screen.getByRole("radio", { name: "WhatsApp chat (recommended)" })).toBeChecked();
    expect(screen.queryByLabelText("Lead form")).not.toBeInTheDocument();
    expect([...picker.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "+91 ••••• 0874 (linked to your Page)",
      "+91 ••••• 4842 (your WhatsApp Business account)",
    ]);
    expect(screen.getByText("WhatsApp chat +91 ••••• 0874")).toBeInTheDocument();
    fireEvent.change(picker, { target: { value: BUSINESS_CHOICE } });
    expect(screen.getByText("WhatsApp chat +91 ••••• 4842")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    fireEvent.click(screen.getByRole("button", { name: "Check my campaign (nothing spends)" }));
    await screen.findByText("WhatsApp chat +919800004842");
    expect(saved.input).toMatchObject({ destination: "whatsapp", whatsappNumber: "+91 ••••• 4842", whatsappNumberSource: "business", whatsappNumberChoiceId: BUSINESS_CHOICE, leadFormId: null });
    expect(mocks.createCampaign).not.toHaveBeenCalled();
  });

  it("passes the selected WhatsApp choice to guided planning", async () => {
    view();
    fireEvent.change(await screen.findByLabelText("WhatsApp button number"), { target: { value: BUSINESS_CHOICE } });
    fireEvent.click(screen.getByRole("radio", { name: "Plan with AdBrain" }));
    await waitFor(() => expect(mocks.campaignChat).toHaveBeenLastCalledWith(expect.objectContaining({
      whatsappNumber: "+91 ••••• 4842",
      whatsappNumberSource: "business",
      whatsappNumberChoiceId: BUSINESS_CHOICE,
    })));
  });

  it("opens on WhatsApp even while no number is linked and points to the Your business guide", async () => {
    whatsapp = async () => Response.json({ state: "not_linked" });
    view();
    await statusRead();
    await settle();
    expect(screen.getByRole("radio", { name: "WhatsApp chat (recommended)" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Instant form" })).not.toBeChecked();
    expect(screen.getByText(/No WhatsApp number is linked yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Your business" })).toHaveAttribute("href", "/brand");
    expect(screen.queryByLabelText("WhatsApp button number")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalledTimes(1));
    expect(saved.input).toMatchObject({ destination: "whatsapp", leadFormId: null });
    expect(saved.input).not.toHaveProperty("whatsappNumber");
  });

  // #1171 (QA): without a linked number, one tap moves to the Instant form; with a ready number it isn't offered.
  it("offers Instant form for now only while no WhatsApp number is ready", async () => {
    whatsapp = async () => Response.json({ state: "not_linked" });
    const { unmount } = view();
    await statusRead();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "No WhatsApp number yet? Use an Instant form for now" }));
    expect(screen.getByRole("radio", { name: "Instant form" })).toBeChecked();
    expect(screen.queryByRole("button", { name: /Use an Instant form for now/ })).toBeNull();
    unmount();
    whatsapp = async () => Response.json({ state: "ready", numbers: [{ masked: "+91 ••••• 4842", source: "page", choiceId: PAGE_CHOICE }] });
    view();
    await statusRead();
    await settle();
    expect(screen.getByRole("radio", { name: "WhatsApp chat (recommended)" })).toBeChecked();
    expect(screen.queryByRole("button", { name: /Use an Instant form for now/ })).toBeNull();
  });

  it("keeps a destination the owner chose before the status arrived", async () => {
    let answer!: (response: Response) => void;
    whatsapp = () => new Promise((resolve) => { answer = resolve; });
    view();
    await statusRead();
    fireEvent.click(screen.getByRole("radio", { name: "Instant form" }));
    answer(Response.json({ state: "ready", numbers: [{ masked: "+91 ••••• 0874", source: "page", choiceId: PAGE_CHOICE }] }));
    await settle();
    expect(screen.getByRole("radio", { name: "Instant form" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "WhatsApp chat (recommended)" }));
    expect(screen.getByLabelText("WhatsApp button number")).toHaveValue(PAGE_CHOICE);
  });

  it("keeps a restored lead-form draft on the lead form", async () => {
    const first = view();
    await screen.findByLabelText("WhatsApp button number");
    fireEvent.click(screen.getByRole("radio", { name: "Instant form" }));
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(sessionStorage.length).toBe(1));
    expect(saved.input.destination).toBe("instant_form");
    first.unmount();
    view();
    await waitFor(() => expect(mocks.draft).toHaveBeenCalled());
    await settle();
    expect(screen.getByRole("radio", { name: "Instant form" })).toBeChecked();
    expect(screen.getByLabelText("Lead form")).toBeInTheDocument();
  });

  it("shows an older draft's full number by its mask and keeps that choice", async () => {
    const older: DraftDTO = { draftId: "44444444-4444-4444-8444-444444444444", version: 3, expiresAt: "2099-01-01T00:00:00.000Z", input: {
      businessId: business.id, name: "Diwali WhatsApp", goal: "Diwali enquiries", mode: "manual", creativeIds: [creative.id], dailyBudgetRupees: 280,
      leadFormId: null, destination: "whatsapp", whatsappNumber: "+919800004842", targeting: recommended, abTest: false,
    } };
    saved = older;
    mocks.drafts.mockResolvedValue([older]);
    mocks.draft.mockResolvedValue(older);
    view();
    fireEvent.click(await screen.findByRole("button", { name: /^Diwali WhatsApp/ }));
    await waitFor(() => expect(screen.getByLabelText("WhatsApp button number")).toHaveDisplayValue("+91 ••••• 4842 (previously selected; check this number)"));
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mocks.updateDraft).toHaveBeenCalledTimes(1));
    expect(mocks.updateDraft.mock.lastCall![2]).toMatchObject({ destination: "whatsapp", whatsappNumber: "+919800004842" });
  });

  it.each([
    { name: "a different Page mask", mask: "+91 ••••• 4842", source: "business" as const },
    { name: "the same Page mask", mask: "+91 ••••• 0874", source: "business" as const },
    { name: "a legacy choice with the same Page mask", mask: "+91 ••••• 0874", source: undefined },
  ])("preserves $name when Meta cannot read business numbers", async ({ mask, source }) => {
    const previous: DraftDTO = { draftId: "44444444-4444-4444-8444-444444444444", version: 3, expiresAt: "2099-01-01T00:00:00.000Z", input: {
      businessId: business.id, name: "Saved WhatsApp", goal: "Enquiries", mode: "manual", creativeIds: [creative.id], dailyBudgetRupees: 280,
      leadFormId: null, destination: "whatsapp", whatsappNumber: mask,
      ...(source ? { whatsappNumberSource: source, whatsappNumberChoiceId: OLD_CHOICE } : {}), targeting: recommended, abTest: false,
    } };
    saved = previous;
    mocks.drafts.mockResolvedValue([previous]);
    mocks.draft.mockResolvedValue(previous);
    whatsapp = async () => Response.json({
      state: "ready", numbers: [{ masked: "+91 ••••• 0874", source: "page", choiceId: PAGE_CHOICE }], businessUnavailable: true,
    });
    view();
    fireEvent.click(await screen.findByRole("button", { name: /^Saved WhatsApp/ }));
    const picker = await screen.findByLabelText("WhatsApp button number");
    await waitFor(() => expect(picker).toHaveDisplayValue(`${mask} (previously selected; check this number)`));
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mocks.updateDraft).toHaveBeenCalledTimes(1));
    expect(mocks.updateDraft.mock.lastCall![2]).toMatchObject({
      destination: "whatsapp", whatsappNumber: mask, ...(source ? { whatsappNumberSource: source, whatsappNumberChoiceId: OLD_CHOICE } : {}),
    });
    if (!source) expect(mocks.updateDraft.mock.lastCall![2]).not.toHaveProperty("whatsappNumberSource");
    expect(mocks.createCampaign).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Use Page number +91 ••••• 0874" }));
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mocks.updateDraft).toHaveBeenCalledTimes(2));
    expect(mocks.updateDraft.mock.lastCall![2]).toMatchObject({
      whatsappNumber: "+91 ••••• 0874", whatsappNumberSource: "page", whatsappNumberChoiceId: PAGE_CHOICE,
    });
  });

  it("distinguishes Page and business choices with the same mask", async () => {
    whatsapp = async () => Response.json({ state: "ready", numbers: [
      { masked: "+91 ••••• 0874", source: "page", choiceId: PAGE_CHOICE }, { masked: "+91 ••••• 0874", source: "business", choiceId: BUSINESS_CHOICE },
    ] });
    view();
    const picker = await screen.findByLabelText("WhatsApp button number");
    expect(picker).toHaveDisplayValue("Choose your WhatsApp number");
    fireEvent.change(picker, { target: { value: BUSINESS_CHOICE } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalledTimes(1));
    expect(saved.input).toMatchObject({ whatsappNumber: "+91 ••••• 0874", whatsappNumberSource: "business", whatsappNumberChoiceId: BUSINESS_CHOICE });
  });

  it("does not replace a saved business choice with a new number that has the same mask", async () => {
    const previous: DraftDTO = { draftId: "44444444-4444-4444-8444-444444444444", version: 3, expiresAt: "2099-01-01T00:00:00.000Z", input: {
      businessId: business.id, name: "Saved WhatsApp", goal: "Enquiries", mode: "manual", creativeIds: [creative.id], dailyBudgetRupees: 280,
      leadFormId: null, destination: "whatsapp", whatsappNumber: "+91 ••••• 4842", whatsappNumberSource: "business",
      whatsappNumberChoiceId: OLD_CHOICE, targeting: recommended, abTest: false,
    } };
    saved = previous;
    mocks.drafts.mockResolvedValue([previous]);
    mocks.draft.mockResolvedValue(previous);
    view();
    fireEvent.click(await screen.findByRole("button", { name: /^Saved WhatsApp/ }));
    const picker = await screen.findByLabelText("WhatsApp button number");
    await waitFor(() => expect(picker).toHaveDisplayValue("+91 ••••• 4842 (previously selected; check this number)"));
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mocks.updateDraft).toHaveBeenCalledTimes(1));
    expect(mocks.updateDraft.mock.lastCall![2]).toMatchObject({ whatsappNumber: "+91 ••••• 4842", whatsappNumberSource: "business", whatsappNumberChoiceId: OLD_CHOICE });
    fireEvent.change(picker, { target: { value: BUSINESS_CHOICE } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mocks.updateDraft).toHaveBeenCalledTimes(2));
    expect(mocks.updateDraft.mock.lastCall![2]).toMatchObject({ whatsappNumber: "+91 ••••• 4842", whatsappNumberSource: "business", whatsappNumberChoiceId: BUSINESS_CHOICE });
  });

  it("opens a business outside India on WhatsApp too, listed first and recommended; Instant form stays selectable", async () => {
    view({ ...business, phone: "+1 512 555 0100" });
    await statusRead();
    await settle();
    const [first, second] = screen.getAllByRole("radio", { name: /^(WhatsApp chat|Instant form)/ });
    expect(first).toHaveAccessibleName("WhatsApp chat (recommended)");
    expect(second).toHaveAccessibleName("Instant form");
    expect(first).toBeChecked();
    expect(screen.getByLabelText("WhatsApp button number")).toHaveValue(PAGE_CHOICE);
    fireEvent.click(second);
    expect(second).toBeChecked();
    expect(screen.getByLabelText("Lead form")).toBeInTheDocument();
  });
});
