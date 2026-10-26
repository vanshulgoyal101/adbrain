// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Campaigns } from "@/components/campaigns";
import type { DraftDTO, DraftInput } from "@/lib/campaign/connect-contracts";
import type { Business, Creative } from "@/lib/types";

// #235: the campaign form picks the WhatsApp button number and opens on WhatsApp once one is ready.
const mocks = vi.hoisted(() => ({
  drafts: vi.fn(), draft: vi.fn(), saveDraft: vi.fn(), updateDraft: vi.fn(), status: vi.fn(), preflight: vi.fn(), createCampaign: vi.fn(), operationForRequest: vi.fn(),
}));
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
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.startsWith("/api/meta/whatsapp") ? whatsapp() : Response.json(url === "/api/campaigns/plan"
    ? { ready: true, targeting: recommended }
    : { forms: [{ id: "form-1", name: "Enquiries", status: "ACTIVE" }] })));
});

describe("campaign WhatsApp button number (#235)", () => {
  it("opens an India business's new campaign on WhatsApp and sends the chosen number", async () => {
    view();
    const picker = await screen.findByLabelText("WhatsApp button number");
    expect(screen.getByRole("radio", { name: "WhatsApp chat" })).toBeChecked();
    expect(screen.queryByLabelText("Lead form")).not.toBeInTheDocument();
    expect([...picker.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "+91 ••••• 0874 (linked to your Page)",
      "+91 ••••• 4842 (your WhatsApp Business account)",
    ]);
    expect(screen.getByText("WhatsApp chat +91 ••••• 0874")).toBeInTheDocument();
    fireEvent.change(picker, { target: { value: "+91 ••••• 4842" } });
    expect(screen.getByText("WhatsApp chat +91 ••••• 4842")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    fireEvent.click(screen.getByRole("button", { name: "Check my campaign (nothing spends)" }));
    await screen.findByText(/Destination: WhatsApp chat \+919800004842/);
    expect(saved.input).toMatchObject({ destination: "whatsapp", whatsappNumber: "+91 ••••• 4842", leadFormId: null });
    expect(mocks.createCampaign).not.toHaveBeenCalled();
  });

  it("keeps the lead form while no number is linked and points to the Your business guide", async () => {
    whatsapp = async () => Response.json({ state: "not_linked" });
    view();
    await statusRead();
    await settle();
    expect(screen.getByRole("radio", { name: "Instant form" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "WhatsApp chat" }));
    expect(screen.getByText(/No WhatsApp number is linked yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Your business" })).toHaveAttribute("href", "/brand");
    expect(screen.queryByLabelText("WhatsApp button number")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalledTimes(1));
    expect(saved.input).toMatchObject({ destination: "whatsapp", leadFormId: null });
    expect(saved.input).not.toHaveProperty("whatsappNumber");
  });

  it("keeps a destination the owner chose before the status arrived", async () => {
    let answer!: (response: Response) => void;
    whatsapp = () => new Promise((resolve) => { answer = resolve; });
    view();
    await statusRead();
    fireEvent.click(screen.getByRole("radio", { name: "WhatsApp chat" }));
    fireEvent.click(screen.getByRole("radio", { name: "Instant form" }));
    answer(Response.json({ state: "ready", numbers: [{ masked: "+91 ••••• 0874", source: "page" }] }));
    await settle();
    expect(screen.getByRole("radio", { name: "Instant form" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "WhatsApp chat" }));
    expect(screen.getByLabelText("WhatsApp button number")).toHaveValue("+91 ••••• 0874");
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
    await waitFor(() => expect(screen.getByLabelText("WhatsApp button number")).toHaveValue("+91 ••••• 4842"));
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mocks.updateDraft).toHaveBeenCalledTimes(1));
    expect(mocks.updateDraft.mock.lastCall![2]).toMatchObject({ destination: "whatsapp", whatsappNumber: "+91 ••••• 4842" });
  });

  it("leaves a business outside India on the lead form", async () => {
    view({ ...business, phone: "+1 512 555 0100" });
    await statusRead();
    await settle();
    expect(screen.getByRole("radio", { name: "Instant form" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "WhatsApp chat" }));
    expect(screen.getByLabelText("WhatsApp button number")).toHaveValue("+91 ••••• 0874");
  });
});
