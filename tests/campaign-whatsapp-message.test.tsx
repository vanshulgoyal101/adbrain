// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Campaigns } from "@/components/campaigns";
import { WhenTheyTap, whenTheyTapLine } from "@/components/when-they-tap";
import type { DraftDTO, DraftInput, ReviewDTO } from "@/lib/campaign/connect-contracts";
import type { Business, Creative } from "@/lib/types";

// #840 3c: the composer's "WhatsApp message" line, its "Edit for this campaign" and Review's "When they tap".
const mocks = vi.hoisted(() => ({
  drafts: vi.fn(), draft: vi.fn(), saveDraft: vi.fn(), updateDraft: vi.fn(), status: vi.fn(), preflight: vi.fn(), createCampaign: vi.fn(), operationForRequest: vi.fn(),
  saveTemplate: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/meta-connect/meta-connect-dialog", () => ({ MetaConnectDialog: () => null }));
vi.mock("@/components/campaign-chat", () => ({ CampaignChat: () => null }));
vi.mock("@/lib/meta-connect-ui/client", () => ({ createMetaConnectClient: () => mocks, MetaConnectClientError: class extends Error {} }));
vi.mock("@/app/(app)/brand/whatsapp-template-actions", () => ({ saveWhatsAppTemplate: mocks.saveTemplate }));

const savedTemplate = { greeting: "Hi! Thanks for messaging Solaride. This is your first step in getting free electricity.", opening: { kind: "prefill", prefill: "Can I get more info on this", callButton: true }, language: "en" };
const business = { id: "11111111-1111-4111-8111-111111111111", owner_id: "owner-1", name: "Solaride", phone: "+91 73802 80874", locations: ["Chandigarh"], offers: ["Free solar site survey"], whatsapp_template: savedTemplate } as unknown as Business;
const creative = { id: "22222222-2222-4222-8222-222222222222", headline: "Wondering whether your roof is ready?", primary_text: "Book a free solar site survey.", image_url: "/icon.png", status: "approved", generation: { language: "Hindi (Devanagari)" } } as unknown as Creative;
const recommended: DraftInput["targeting"] = {
  age: { mode: "manual", min: 25, max: 55 },
  location: { mode: "ai", includedNames: ["Chandigarh"] },
  audience: { interestNames: ["Solar energy"], rationale: "Homeowners near the offer." },
};
const selected = { adAccountId: "act_1", accountName: "Solar account", pageId: "page_1", pageName: "Solaride Energy", currency: "INR", timezoneName: "Asia/Kolkata", metaBusinessId: null };
let saved: DraftDTO;
let reviewedMessage: ReviewDTO["whatsappMessage"];

function view(owner: Business = business) {
  return render(<Campaigns business={owner} approved={[creative]} initialCampaigns={[]} initialResults={{}} leadForms={[]} leadFormError={null} metaReady adAccountId="act_1" />);
}

afterEach(() => { Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView"); vi.unstubAllGlobals(); });
beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  sessionStorage.clear();
  localStorage.clear();
  localStorage.setItem(`campaign-sync:${business.owner_id}:${business.id}:act_1`, String(Date.now()));
  reviewedMessage = { source: "saved", language: "en", greeting: savedTemplate.greeting, autofill: "Can I get more info on this", callButton: true };
  mocks.drafts.mockResolvedValue([]);
  mocks.status.mockResolvedValue({ authorization: "connected", selected, generation: 1 });
  mocks.saveTemplate.mockResolvedValue({ ok: true });
  mocks.saveDraft.mockImplementation(async (input: DraftInput) => (saved = { draftId: "33333333-3333-4333-8333-333333333333", version: 1, expiresAt: "2099-01-01T00:00:00.000Z", input }));
  mocks.draft.mockImplementation(async () => saved);
  mocks.updateDraft.mockImplementation(async (_id: string, _version: number, input: DraftInput) => (saved = { ...saved, version: saved.version + 1, input }));
  mocks.preflight.mockImplementation(async () => ({
    draftId: saved.draftId, draftVersion: saved.version, connectionGeneration: 1, canCreatePaused: true, blockers: [], planHash: "a".repeat(64), currency: "INR",
    perAdSetDailyBudgetRupees: 300, totalDailyBudgetRupees: 300, adSetCount: 1, resolvedAreaLabel: "Chandigarh", selected,
    destination: "whatsapp", whatsappNumber: "+919800000874", whatsappMessage: reviewedMessage,
  }));
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.startsWith("/api/meta/whatsapp")
    ? Response.json({ state: "ready", numbers: [{ masked: "+91 ••••• 0874", source: "page" }] })
    : Response.json(url === "/api/campaigns/plan" ? { ready: true, targeting: recommended } : { forms: [] })));
});

async function review() {
  fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
  fireEvent.click(screen.getByRole("button", { name: "Check my campaign (nothing spends)" }));
  return screen.findByRole("region", { name: "When they tap" });
}

describe("composer: WhatsApp message (#840 3c)", () => {
  it("names the saved message, and an edit for this campaign changes only this campaign", async () => {
    view();
    await screen.findByLabelText("WhatsApp button number");
    expect(screen.getByText(/Your saved message/)).toBeInTheDocument();
    // The language picker only steers AdBrain's suggestion; a saved message has its own words.
    expect(screen.queryByLabelText("Message language")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit for this campaign" }));
    const dialog = await screen.findByRole("dialog", { name: "WhatsApp message for this campaign" });
    expect(within(dialog).getByLabelText(/Welcome message/)).toHaveValue(savedTemplate.greeting);
    expect(within(dialog).getByLabelText("Also save as my message")).not.toBeChecked();
    fireEvent.change(within(dialog).getByLabelText(/Welcome message/), { target: { value: "Namaste! Solaride here." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Use for this campaign" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText(/Edited for this campaign/)).toBeInTheDocument();
    expect(mocks.saveTemplate).not.toHaveBeenCalled();
    await review();
    expect(saved.input.whatsappMessage).toEqual({ greeting: "Namaste! Solaride here.", opening: { kind: "prefill", prefill: "Can I get more info on this", callButton: true }, language: "en" });
  });

  it("'Also save as my message' saves it for the business, and this campaign follows the saved one", async () => {
    view();
    await screen.findByLabelText("WhatsApp button number");
    fireEvent.click(screen.getByRole("button", { name: "Edit for this campaign" }));
    const dialog = await screen.findByRole("dialog", { name: "WhatsApp message for this campaign" });
    fireEvent.change(within(dialog).getByLabelText(/Welcome message/), { target: { value: "Namaste! Solaride here." } });
    fireEvent.click(within(dialog).getByLabelText("Also save as my message"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Use for this campaign" }));
    await waitFor(() => expect(mocks.saveTemplate).toHaveBeenCalledWith({ businessId: business.id, template: expect.objectContaining({ greeting: "Namaste! Solaride here." }) }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText(/Your saved message/)).toBeInTheDocument();
    await review();
    expect(saved.input.whatsappMessage).toBeUndefined();
  });

  it("with nothing saved, the suggestion follows the ads as before and the language picker stays", async () => {
    view({ ...business, whatsapp_template: null } as Business);
    await screen.findByLabelText("WhatsApp button number");
    expect(screen.getByText(/Suggested message/)).toBeInTheDocument();
    expect(screen.getByLabelText("Message language")).toHaveValue("ad");
    reviewedMessage = { source: "suggested", language: null, greeting: "नमस्ते! Solaride को मैसेज करने के लिए धन्यवाद।", autofill: "", iceBreakers: ["Free solar site survey में क्या शामिल है?"] };
    await review();
    expect(saved.input.whatsappMessage).toBeUndefined();
    expect(saved.input.whatsappLanguage).toBeUndefined();
  });

  it("Review shows what they see when they tap, and an English message on Hindi ads gets a soft note with Edit", async () => {
    view();
    await screen.findByLabelText("WhatsApp button number");
    const block = await review();
    expect(block).toHaveTextContent("Customers see your welcome, a Call now button, and 'Can I get more info on this' ready to send.");
    expect(block).toHaveTextContent("Your ads are in Hindi; your WhatsApp message is in English.");
    expect(within(block).getByText("Call now")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send to Meta (paused)" })).toBeEnabled();
    fireEvent.click(within(block).getByRole("button", { name: "Edit" }));
    expect(await screen.findByRole("dialog", { name: "WhatsApp message for this campaign" })).toBeInTheDocument();
  });
});

describe("Review blocker on this campaign's message (#840)", () => {
  it("'Edit the WhatsApp message' lands on Edit for this campaign", async () => {
    mocks.preflight.mockImplementation(async () => ({
      draftId: saved.draftId, draftVersion: saved.version, connectionGeneration: 1, canCreatePaused: false, planHash: null, currency: "INR",
      blockers: [{ code: "PREFLIGHT_BLOCKED", reason: "REVIEW_WHATSAPP_MESSAGE", message: "Your WhatsApp message: \"guaranteed\" isn't in your business details.", action: null }],
      perAdSetDailyBudgetRupees: 300, totalDailyBudgetRupees: 300, adSetCount: 1, resolvedAreaLabel: "Chandigarh", selected, destination: "whatsapp", whatsappNumber: "+919800000874",
    }));
    view();
    await screen.findByLabelText("WhatsApp button number");
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    fireEvent.click(screen.getByRole("button", { name: "Check my campaign (nothing spends)" }));
    const region = await screen.findByRole("region", { name: "Campaign review result" });
    fireEvent.click(await within(region).findByRole("button", { name: "Edit the WhatsApp message" }));
    expect(screen.getByRole("button", { name: "Edit for this campaign" })).toHaveFocus();
  });
});

describe("When they tap (#840)", () => {
  it("says it in one plain line for each kind of opening", () => {
    expect(whenTheyTapLine({ source: "edited", language: "en", greeting: "Hi", autofill: "", iceBreakers: ["Price?", "Visit?"] })).toBe("Customers see your welcome and 2 questions to tap: 'Price?', 'Visit?'.");
    expect(whenTheyTapLine({ source: "saved", language: "en", greeting: "Hi", autofill: "Tell me more" })).toBe("Customers see your welcome and 'Tell me more' ready to send.");
  });

  it("has no note when the message follows the ads", () => {
    render(<WhenTheyTap message={{ source: "suggested", language: null, greeting: "Hi", autofill: "Tell me more" }} businessName="Solaride" adsLanguage="hi" onEdit={vi.fn()} />);
    expect(screen.queryByText(/Your ads are in/)).toBeNull();
  });
});
