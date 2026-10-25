// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Campaigns } from "@/components/campaigns";
import type { DraftDTO, DraftInput } from "@/lib/campaign/connect-contracts";
import type { Business, Campaign, Creative } from "@/lib/types";
import type { ConnectionDTO } from "@/lib/meta/connect-contracts";

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

describe("campaign Ads Manager links", () => {
  it("unmounts the planner when switching to manual setup or closing the composer", () => {
    view();
    expect(screen.queryByTestId("guided-campaign-chat")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Plan with AdBrain" }));
    expect(screen.getByTestId("guided-campaign-chat")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Choose settings" }));
    expect(screen.queryByTestId("guided-campaign-chat")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Plan with AdBrain" }));
    fireEvent.click(screen.getByRole("button", { name: "Close campaign setup" }));
    expect(screen.queryByTestId("guided-campaign-chat")).toBeNull();
  });

  it("removes the old send action while saving a replacement review and after a save failure", async () => {
    view();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    fireEvent.click(screen.getByRole("button", { name: "Prepare campaign review" }));
    await screen.findByRole("button", { name: "Send to Meta (paused)" });
    let rejectSave!: (reason: Error) => void;
    mocks.updateDraft.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectSave = reject; }));
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mocks.updateDraft).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: "Send to Meta (paused)" })).toBeNull();
    await act(async () => { rejectSave(new Error("Draft save unavailable")); });
    await screen.findByText("Draft save unavailable");
    expect(screen.queryByRole("button", { name: "Send to Meta (paused)" })).toBeNull();
    expect(mocks.createCampaign).not.toHaveBeenCalled();
  });

  it.each(["validation", "save", "reconnect"])("preserves resolved recovery when new preparation fails at %s", async (failure) => {
    mocks.createCampaign.mockResolvedValue({ operationId: "44444444-4444-4444-8444-444444444444", state: "failed", checkpoints: [], externalIds: {}, error: null });
    view();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    fireEvent.click(screen.getByRole("button", { name: "Prepare campaign review" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send to Meta (paused)" }));
    await screen.findByText(/The operation failed before completion/);
    if (failure === "reconnect") {
      mocks.saveDraft.mockRejectedValueOnce(new Error("Draft save unavailable"));
      mocks.updateDraft.mockRejectedValueOnce(new Error("Draft save unavailable"));
      await act(async () => { await expect(mocks.dialog.current!.onBeforeStart!()).rejects.toThrow("Draft save unavailable"); });
      expect(mocks.updateDraft).not.toHaveBeenCalled();
    } else if (failure === "save") {
      mocks.saveDraft.mockRejectedValueOnce(new Error("Draft save unavailable"));
      fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
      await screen.findByText("Draft save unavailable");
    } else {
      fireEvent.change(screen.getByLabelText("Lead form"), { target: { value: "" } });
      fireEvent.click(screen.getByRole("button", { name: "Prepare campaign review" }));
      await screen.findByText("Choose a lead form before preparing campaign review.");
    }
    const destination = screen.getByRole("radio", { name: "WhatsApp chat" });
    fireEvent.click(destination);
    expect(destination).toBeChecked();
    expect(screen.queryByRole("button", { name: "Send to Meta (paused)" })).toBeNull();
    expect(mocks.createCampaign).toHaveBeenCalledTimes(1);
  });

  it.each(["succeeded", "failed", "pending", "running", "needs_reconciliation", "missing", "unavailable"])("uses recovered %s operation state to control destination selection", async (state) => {
    mocks.createCampaign.mockRejectedValue(new Error("Request interrupted"));
    const first = view();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    fireEvent.click(screen.getByRole("button", { name: "Prepare campaign review" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send to Meta (paused)" }, { timeout: 5000 }));
    await screen.findByText("Request interrupted");
    first.unmount();
    if (state === "unavailable") mocks.operationForRequest.mockRejectedValue(new Error("Status unavailable"));
    else mocks.operationForRequest.mockResolvedValue(state === "missing" ? null : {
      operationId: "44444444-4444-4444-8444-444444444444", state, checkpoints: [], externalIds: {}, error: null,
    });
    view();
    if (state === "unavailable") await screen.findByText("Status unavailable");
    else if (state === "succeeded") await screen.findByText("Paused campaign created. Review it before activating spend.");
    else await screen.findByRole("region", { name: "Campaign review result" });
    if (state === "succeeded") {
      expect(screen.queryByRole("region", { name: "Campaign review result" })).toBeNull();
      expect(sessionStorage.length).toBe(0);
      fireEvent.click(screen.getByRole("button", { name: "New campaign" }));
    }
    const destination = screen.getByRole("radio", { name: "WhatsApp chat" });
    if (state === "succeeded" || state === "failed") {
      expect(destination).toBeEnabled();
      fireEvent.click(screen.getByRole("radio", { name: "Plan with AdBrain" }));
      fireEvent.click(destination);
      expect(destination).toBeChecked();
      expect(screen.queryByRole("region", { name: "Campaign review result" })).toBeNull();
    } else {
      expect(destination).toBeDisabled();
      expect(screen.getByText("Destination is locked until the previous campaign request is resolved.")).toBeVisible();
    }
    expect(mocks.createCampaign).toHaveBeenCalledTimes(1);
  });

  it("allows switching to WhatsApp after a confirmed failed creation", async () => {
    mocks.createCampaign.mockResolvedValue({ operationId: "44444444-4444-4444-8444-444444444444", state: "failed", checkpoints: [], externalIds: {}, error: null });
    view();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    fireEvent.click(screen.getByRole("button", { name: "Prepare campaign review" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send to Meta (paused)" }));
    await waitFor(() => expect(mocks.createCampaign).toHaveBeenCalledTimes(1));
    const destination = screen.getByRole("radio", { name: "WhatsApp chat" });
    await waitFor(() => expect(destination).toBeEnabled());
    fireEvent.click(screen.getByRole("radio", { name: "Plan with AdBrain" }));
    fireEvent.click(destination);
    expect(destination).toBeChecked();
    expect(screen.queryByText("WhatsApp drafts only. Publishing is not yet available.")).not.toBeInTheDocument();
    expect(mocks.createCampaign).toHaveBeenCalledTimes(1);
  });

  it("saves and restores city coverage without invoking AI or creating ads", async () => {
    const first = view();
    expect(screen.getByRole("radio", { name: "City only" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "City + radius" }));
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(saved.input.targeting.location).toMatchObject({ cityScope: "radius", radiusKm: 25 }));
    first.unmount();
    view();
    await waitFor(() => expect(screen.getByRole("radio", { name: "City + radius" })).toBeChecked());
    fireEvent.click(screen.getByRole("radio", { name: "City only" }));
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mocks.updateDraft).toHaveBeenCalled());
    const updated = mocks.updateDraft.mock.lastCall![2];
    expect(updated.targeting.location.cityScope).toBe("city_only");
    expect(updated.targeting.location).not.toHaveProperty("radiusKm");
    expect(vi.mocked(fetch).mock.calls.some(([url]) => url === "/api/campaigns/plan")).toBe(false);
    expect(mocks.createCampaign).not.toHaveBeenCalled();
  });

  it("saves the WhatsApp message language chosen for the campaign (#493)", async () => {
    mocks.preflight.mockImplementation(async () => ({
      draftId: saved.draftId, draftVersion: saved.version, connectionGeneration: 1,
      canCreatePaused: true, blockers: [], planHash: "a".repeat(64), currency: "INR",
      perAdSetDailyBudgetRupees: 200, totalDailyBudgetRupees: 200, adSetCount: 1,
      resolvedAreaLabel: "Jaipur", selected, destination: "whatsapp", whatsappNumber: "+919876543210",
    }));
    const first = view();
    fireEvent.click(screen.getByRole("radio", { name: "WhatsApp chat" }));
    const language = screen.getByLabelText("Message language");
    expect(language).toHaveValue("ad");
    fireEvent.change(language, { target: { value: "en" } });
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    fireEvent.click(screen.getByRole("button", { name: "Prepare campaign review" }));
    await screen.findByText(/Destination: WhatsApp chat/);
    expect(saved.input).toMatchObject({ destination: "whatsapp", whatsappLanguage: "en" });
    first.unmount();
    view();
    await waitFor(() => expect(screen.getByLabelText("Message language")).toHaveValue("en"));
  });

  it("saves, restores and submits a reviewed WhatsApp draft without a form", async () => {
    mocks.preflight.mockImplementation(async () => ({
      draftId: saved.draftId, draftVersion: saved.version, connectionGeneration: 1,
      canCreatePaused: true, blockers: [], planHash: "a".repeat(64), currency: "INR",
      perAdSetDailyBudgetRupees: 200, totalDailyBudgetRupees: 200, adSetCount: 1,
      resolvedAreaLabel: "Jaipur", selected, destination: "whatsapp", whatsappNumber: "+919876543210",
    }));
    const first = view();
    fireEvent.click(screen.getByRole("radio", { name: "WhatsApp chat" }));
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    expect(screen.queryByLabelText("Lead form")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Prepare campaign review" }));
    await screen.findByText(/Destination: WhatsApp chat \+919876543210/);
    expect(saved.input).toMatchObject({ destination: "whatsapp", leadFormId: null });
    expect(vi.mocked(fetch).mock.calls.some(([url]) => url === "/api/campaigns/lead-forms")).toBe(false);
    first.unmount();
    view();
    await waitFor(() => expect(screen.getByRole("radio", { name: "WhatsApp chat" })).toBeChecked());
    expect(screen.queryByLabelText("Lead form")).not.toBeInTheDocument();
    expect(mocks.createCampaign).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Prepare campaign review" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send to Meta (paused)" }));
    await waitFor(() => expect(mocks.createCampaign).toHaveBeenCalledTimes(1));
  });

  it.each([
    ["act_2398686420592052", "act_999", "2398686420592052"],
    ["2398686420592052", "act_999", "2398686420592052"],
    [null, "act_999", "999"],
    [null, "", null],
    ["invalid", "act_999", null],
  ])("uses the bound account %s with connection %s", async (boundAccount, connectionAccount, expectedAccount) => {
    const campaign = { id: "campaign-1", name: "Saved campaign", status: "paused", meta_campaign_id: "120252972379040526", meta_ad_account_id: boundAccount } as Campaign;
    render(<Campaigns business={business} approved={[creative]} initialCampaigns={[campaign]} initialResults={{}} leadForms={[]} leadFormError={null} metaReady={false} adAccountId={connectionAccount ?? ""} />);
    // #403 S5: the link lives in the row's More menu.
    const more = await screen.findByRole("button", { name: "More actions for Saved campaign" });
    more.focus();
    fireEvent.keyDown(more, { key: "Enter" });
    const link = await screen.findByRole("menuitem", { name: /Open in Ads Manager/ });
    const url = new URL(link.getAttribute("href")!);
    expect(url.origin).toBe("https://adsmanager.facebook.com");
    expect(url.pathname).toBe("/adsmanager/manage/campaigns/");
    expect(url.searchParams.get("act")).toBe(expectedAccount);
    expect(url.searchParams.get("selected_campaign_ids")).toBe(expectedAccount ? campaign.meta_campaign_id : null);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
