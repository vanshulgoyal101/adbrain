// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Campaigns } from "@/components/campaigns";
import { SupportLinkProvider } from "@/components/support-link";
import type { DraftDTO, DraftInput } from "@/lib/campaign/connect-contracts";
import type { Business, Creative } from "@/lib/types";

// #667: a composer error renders next to the control that needs fixing, not in the page banner far above it.
const mocks = vi.hoisted(() => ({
  drafts: vi.fn(), draft: vi.fn(), saveDraft: vi.fn(), updateDraft: vi.fn(), status: vi.fn(), preflight: vi.fn(), createCampaign: vi.fn(), operationForRequest: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/meta-connect/meta-connect-dialog", () => ({ MetaConnectDialog: () => null }));
vi.mock("@/components/campaign-chat", () => ({ CampaignChat: () => null }));
vi.mock("@/lib/meta-connect-ui/client", () => ({ createMetaConnectClient: () => mocks, MetaConnectClientError: class extends Error {} }));

const business = { id: "11111111-1111-4111-8111-111111111111", owner_id: "owner-1", name: "Cedar Ridge", locations: ["Jaipur"] } as Business;
const creative = { id: "22222222-2222-4222-8222-222222222222", headline: "Lower electricity bills", image_url: "/icon.png", status: "approved" } as Creative;
const selected = { adAccountId: "act_1", accountName: "Account", pageId: "page_1", pageName: "Page", currency: "INR", timezoneName: "Asia/Kolkata", metaBusinessId: null };
const targeting: DraftInput["targeting"] = {
  age: { mode: "manual", min: 30, max: 65 },
  location: { mode: "ai", includedNames: ["Jaipur"], excludedNames: [], radiusKm: 20 },
  audience: { interestNames: ["Solar energy"], rationale: "Local interest." },
};
const scrollIntoView = vi.fn();
let forms: { id: string; name: string; status: string }[];

// As in production: the composer opens before the Page's forms arrive.
function view(extra: Partial<React.ComponentProps<typeof Campaigns>> = {}) {
  return render(<Campaigns business={business} approved={[creative]} initialCampaigns={[]} initialResults={{}} leadForms={[]} leadFormError={null} metaReady adAccountId="" {...extra} />);
}

// #1171: WhatsApp chat is the default; lead-form behaviour needs Instant form chosen.
async function viewInstantForm() {
  const result = view();
  fireEvent.click(await screen.findByRole("radio", { name: "Instant form" }));
  return result;
}

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  localStorage.setItem(`campaign-sync:${business.owner_id}:${business.id}:`, String(Date.now()));
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
  forms = [{ id: "form-1", name: "Enquiries", status: "ACTIVE" }, { id: "form-2", name: "Callbacks", status: "ACTIVE" }];
  mocks.drafts.mockResolvedValue([]);
  mocks.status.mockResolvedValue({ authorization: "connected", selected, generation: 1 });
  mocks.saveDraft.mockImplementation(async (input: DraftInput): Promise<DraftDTO> => ({ draftId: "33333333-3333-4333-8333-333333333333", version: 1, expiresAt: "2099-01-01T00:00:00.000Z", input }));
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url === "/api/campaigns/plan" ? { ready: true, targeting } : { forms })));
});
afterEach(() => { Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView"); vi.unstubAllGlobals(); });

describe("launch composer defaults and plain words (#761)", () => {
  it("#1307: quotes AdBrain's live pooled runs when the ledger is readable", async () => {
    view({ whatsappLedger: { chats: 9, spendRupees: 1_640 } });
    expect(await screen.findByText(/^What to expect: AdBrain's WhatsApp ads so far got 9 chats for about ₹1,600, about ₹180 each\. That's too few to predict yours\./)).toBeInTheDocument();
  });

  it("starts at ₹300 a day, says what to expect and that the check spends nothing, with no 'pending' age", async () => {
    view();
    expect(await screen.findByLabelText("Daily budget (₹)")).toHaveValue(300);
    expect(screen.getByRole("button", { name: "₹300 a day" })).toBeInTheDocument();
    // #1038, #1171: the default destination is WhatsApp chat, so its cost shows; Instant form has none yet.
    // #1307: the ledger's facts with n (6 chats), not a range it can't support.
    expect(await screen.findByText("What to expect: AdBrain's WhatsApp ads so far got 6 chats for about ₹1,200, about ₹200 each. That's too few to predict yours. Meta reviews new ads first, usually within 24 hours, and nothing spends until you go live.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check my campaign (nothing spends)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Instant form" }));
    expect(await screen.findByText(/What to expect: AdBrain hasn't run enough instant-form campaigns yet to quote a cost per enquiry\. Meta reviews new ads first/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("WhatsApp ads so far got");
    // The WhatsApp line may say its number's verification is pending; the age never does.
    expect(document.body.textContent).not.toContain("pending");
  });
});

describe("help where owners get stuck (#796)", () => {
  it("offers Help on WhatsApp at the Meta connection step while Meta isn't connected for the draft", async () => {
    mocks.status.mockResolvedValue({ authorization: "disconnected", selected: null, generation: 1 });
    render(<SupportLinkProvider url="https://wa.me/917009764842"><Campaigns business={business} approved={[creative]} initialCampaigns={[]} initialResults={{}} leadForms={[]} leadFormError={null} metaReady={false} adAccountId="" /></SupportLinkProvider>);
    expect(await screen.findByRole("link", { name: "Stuck connecting Meta? Help on WhatsApp" })).toHaveAttribute("href", "https://wa.me/917009764842");
  });
});

describe("composer errors sit next to the control (#667)", () => {
  it("Prepare with no lead form chosen focuses the Lead form field and says why beside it", async () => {
    await viewInstantForm();
    const leadForm = screen.getByLabelText("Lead form");
    await within(leadForm).findByRole("option", { name: "Callbacks" });
    expect(leadForm).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    fireEvent.click(screen.getByRole("button", { name: "Check my campaign (nothing spends)" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Choose a lead form before preparing campaign review.");
    expect(document.getElementById("campaign-composer")).toContainElement(alert);
    expect(leadForm).toHaveFocus();
    expect(leadForm).toHaveAttribute("aria-invalid", "true");
    expect(leadForm).toHaveAttribute("aria-describedby", alert.id);
    expect(scrollIntoView.mock.contexts).toContain(leadForm);
    expect(mocks.saveDraft).not.toHaveBeenCalled();

    fireEvent.change(leadForm, { target: { value: "form-2" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(leadForm).not.toHaveAttribute("aria-invalid");
  });

  it("a failed draft save shows beside Prepare and scrolls there", async () => {
    mocks.saveDraft.mockRejectedValue(new Error("Could not save the campaign draft."));
    await viewInstantForm();
    const leadForm = screen.getByLabelText("Lead form");
    await within(leadForm).findByRole("option", { name: "Callbacks" });
    fireEvent.change(leadForm, { target: { value: "form-1" } });
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    fireEvent.click(screen.getByRole("button", { name: "Check my campaign (nothing spends)" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not save the campaign draft.");
    expect(document.getElementById("campaign-composer")).toContainElement(alert);
    await waitFor(() => expect(scrollIntoView.mock.contexts).toContain(alert));
  });

  it("a Send to Meta failure shows in the review, beside the Send button", async () => {
    mocks.preflight.mockResolvedValue({
      draftId: "33333333-3333-4333-8333-333333333333", draftVersion: 1, connectionGeneration: 1,
      canCreatePaused: true, blockers: [], planHash: "a".repeat(64), currency: "INR",
      perAdSetDailyBudgetRupees: 200, totalDailyBudgetRupees: 200, adSetCount: 1,
      resolvedAreaLabel: "Jaipur", selected, audienceInterests: [{ id: "1", name: "Solar energy" }],
    });
    mocks.createCampaign.mockRejectedValue(new Error("Campaign creation could not be started."));
    await viewInstantForm();
    const leadForm = screen.getByLabelText("Lead form");
    await within(leadForm).findByRole("option", { name: "Callbacks" });
    fireEvent.change(leadForm, { target: { value: "form-1" } });
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    fireEvent.click(screen.getByRole("button", { name: "Check my campaign (nothing spends)" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send to Meta (paused)" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Campaign creation could not be started.");
    expect(screen.getByRole("region", { name: "Campaign review result" })).toContainElement(alert);
    await waitFor(() => expect(scrollIntoView.mock.contexts).toContain(alert));
  });

  it("preselects the lead form when the Page has exactly one", async () => {
    forms = [{ id: "form-1", name: "Enquiries", status: "ACTIVE" }];
    await viewInstantForm();
    const leadForm = screen.getByLabelText("Lead form");
    await within(leadForm).findByRole("option", { name: "Enquiries" });
    await waitFor(() => expect(leadForm).toHaveValue("form-1"));
  });
});
