// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Campaigns } from "@/components/campaigns";
import { Studio } from "@/components/studio";
import { writeCampaignRecovery, recoveryStorageKey } from "@/lib/meta-connect-ui/recovery";
import type { DraftDTO, DraftInput } from "@/lib/campaign/connect-contracts";
import type { Business, Campaign, Creative } from "@/lib/types";

const mocks = vi.hoisted(() => ({ drafts: vi.fn(), draft: vi.fn(), status: vi.fn(), operationForRequest: vi.fn(), saveDraft: vi.fn(), updateDraft: vi.fn(), preflight: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/meta-connect/meta-connect-dialog", () => ({ MetaConnectDialog: () => null }));
vi.mock("@/components/campaign-chat", () => ({ CampaignChat: () => null }));
vi.mock("@/lib/meta-connect-ui/client", () => ({ createMetaConnectClient: () => mocks, MetaConnectClientError: class extends Error {} }));
vi.mock("@/app/(app)/studio/actions", () => ({ setCreativeStatus: vi.fn(), deleteCreative: vi.fn() }));

const business = { id: "11111111-1111-4111-8111-111111111111", owner_id: "owner-1", name: "Cedar Ridge", locations: ["Austin"] } as Business;
const ad = (id: string, status: Creative["status"], headline: string) =>
  ({ id, business_id: business.id, headline, primary_text: "Text", cta: "Book Now", image_url: "/icon.png", status }) as Creative;
const approvedA = ad("22222222-2222-4222-8222-222222222222", "approved", "Posture scan");
const approvedB = ad("33333333-3333-4333-8333-333333333333", "approved", "Back pain relief");
const draft = ad("44444444-4444-4444-8444-444444444444", "draft", "Still in review");
const existing = { id: "c1", business_id: business.id, name: "Running campaign", status: "paused" } as Campaign;

function campaigns(creativeIds: string[] | undefined) {
  return render(<Campaigns business={business} approved={[approvedA, approvedB]} initialCampaigns={[existing]} initialResults={{}}
    leadForms={[]} leadFormError={null} metaReady={false} adAccountId="" newCampaign={creativeIds ? { creativeIds } : undefined} />);
}

const pressed = (headline: string) => screen.getByRole("button", { name: headline, hidden: true }).getAttribute("aria-pressed");

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  localStorage.setItem(`campaign-sync:${business.owner_id}:${business.id}:`, String(Date.now()));
  mocks.drafts.mockResolvedValue([]);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ creatives: [], campaigns: [], results: {}, nextCursor: null })));
});

describe("Review to campaign (#134)", () => {
  it("Review links to a new campaign carrying exactly the approved ad IDs", () => {
    render(<Studio business={business} initialCreatives={[approvedA, draft, approvedB]} />);
    const link = screen.getByRole("link", { name: "Create campaign (2)" });
    const url = new URL(link.getAttribute("href")!, "https://adbrain.test");
    expect(url.pathname).toBe("/campaigns");
    expect(url.searchParams.get("new")).toBe("1");
    expect(url.searchParams.get("creatives")!.split(",")).toEqual([approvedA.id, approvedB.id]);
    expect(within(screen.getByRole("list", { name: "Steps to an ad" })).getByText("Launch")).toBeTruthy();
  });

  it("disables Create campaign until an ad is approved", () => {
    render(<Studio business={business} initialCreatives={[draft]} />);
    expect(screen.queryByRole("link", { name: /Create campaign/ })).toBeNull();
    expect((screen.getByRole("button", { name: "Create campaign (0)" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("opens the composer with exactly the linked approved ads selected and ignores other IDs", async () => {
    campaigns([approvedB.id, draft.id, "not-a-real-id"]);
    expect(document.getElementById("campaign-composer")!.hidden).toBe(false);
    expect(pressed("Back pain relief")).toBe("true");
    expect(pressed("Posture scan")).toBe("false");
    expect(screen.queryByRole("button", { name: "Still in review", hidden: true })).toBeNull();
    await waitFor(() => expect(mocks.drafts).toHaveBeenCalled());
  });

  it("keeps the composer closed and nothing selected without the link", () => {
    campaigns(undefined);
    expect(document.getElementById("campaign-composer")!.hidden).toBe(true);
    expect(pressed("Back pain relief")).toBe("false");
  });

  it("does not let a stale saved draft replace the ads chosen on Review", async () => {
    const saved = { draftId: "55555555-5555-4555-8555-555555555555", version: 1, expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      input: { businessId: business.id, name: "Old draft", goal: "Old goal", mode: "manual", creativeIds: [approvedA.id], dailyBudgetRupees: 300,
        leadFormId: null, targeting: {}, abTest: false } } as DraftDTO;
    writeCampaignRecovery(sessionStorage, recoveryStorageKey(business.owner_id, business.id), { draft: saved, request: null, operationId: null });
    mocks.draft.mockResolvedValue(saved);
    campaigns([approvedB.id]);
    await waitFor(() => expect(mocks.drafts).toHaveBeenCalled());
    expect(mocks.draft).not.toHaveBeenCalled();
    expect(pressed("Back pain relief")).toBe("true");
    expect(pressed("Posture scan")).toBe("false");
  });

  // #1004: Create's one button lands on Review: the composer prepares it once it has settled, with no extra tap.
  describe("from Create with review=1", () => {
    const FORM = "1732372914636573";
    let forms: Array<{ id: string; name: string; status: string }> = [];
    const open = (review: boolean) => render(<Campaigns business={business} approved={[approvedA, approvedB]} initialCampaigns={[existing]} initialResults={{}}
      leadForms={[]} leadFormError={null} metaReady adAccountId="act_1" newCampaign={{ creativeIds: [approvedB.id], review }} />);
    beforeEach(() => {
      forms = [{ id: FORM, name: "Enquiries", status: "ACTIVE" }];
      mocks.status.mockResolvedValue({ authorization: "connected", generation: 1 });
      mocks.saveDraft.mockImplementation(async (input: DraftInput): Promise<DraftDTO> => ({ draftId: "90d1d2bb-466c-4889-9af2-edb533e82531", version: 1, expiresAt: "2099-01-01T00:00:00.000Z", input }));
      vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(String(url).startsWith("/api/meta/whatsapp")
        ? { state: "unavailable" }
        : String(url) === "/api/campaigns/plan" ? { ready: true, targeting: {
          age: { mode: "manual", min: 25, max: 55 },
          location: { mode: "ai", includedNames: ["Austin, Texas"], excludedNames: [], radiusKm: 25 },
          audience: { interestNames: ["Wellness"], rationale: "Adults near the clinic." },
        } } : { forms })));
    });

    it("prepares Review once with exactly the chosen ad, after the lead form has loaded", async () => {
      open(true);
      await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalledTimes(1));
      expect(mocks.saveDraft.mock.calls[0][0]).toMatchObject({ creativeIds: [approvedB.id], leadFormId: FORM, dailyBudgetRupees: 300 });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(mocks.saveDraft).toHaveBeenCalledTimes(1);
    });

    it("waits on the composer, without saving anything, while a form campaign has no lead form", async () => {
      forms = [];
      open(true);
      await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith("/api/meta/whatsapp"))).toBe(true));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mocks.saveDraft).not.toHaveBeenCalled();
      expect(document.getElementById("campaign-composer")!.hidden).toBe(false);
    });

    // QA 2 on #1004: several forms and none chosen left the owner on the composer with no hint.
    it("with several forms, says choosing one opens Review, and choosing it does (no Check tap); the choice is remembered", async () => {
      forms = [{ id: FORM, name: "Enquiries", status: "ACTIVE" }, { id: "1732372914636574", name: "Callbacks", status: "ACTIVE" }];
      open(true);
      expect(await screen.findByText("Choose the form for these enquiries, and Review opens.")).toBeTruthy();
      expect(mocks.saveDraft).not.toHaveBeenCalled();
      fireEvent.change(screen.getByLabelText("Lead form"), { target: { value: "1732372914636574" } });
      await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalledTimes(1));
      expect(mocks.saveDraft.mock.calls[0][0]).toMatchObject({ creativeIds: [approvedB.id], leadFormId: "1732372914636574" });
      await waitFor(() => expect(localStorage.getItem(`campaign-lead-form:${business.owner_id}:${business.id}`)).toBe("1732372914636574"));
      expect(screen.queryByText("Choose the form for these enquiries, and Review opens.")).toBeNull();
    });

    it("preselects the lead form used last time when the Page still has it, so Review opens by itself", async () => {
      forms = [{ id: FORM, name: "Enquiries", status: "ACTIVE" }, { id: "1732372914636574", name: "Callbacks", status: "ACTIVE" }];
      localStorage.setItem(`campaign-lead-form:${business.owner_id}:${business.id}`, "1732372914636574");
      open(true);
      await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalledTimes(1));
      expect(mocks.saveDraft.mock.calls[0][0]).toMatchObject({ leadFormId: "1732372914636574" });
    });

    it("never prepares on its own without the flag", async () => {
      open(false);
      await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith("/api/meta/whatsapp"))).toBe(true));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mocks.saveDraft).not.toHaveBeenCalled();
    });
  });
});
