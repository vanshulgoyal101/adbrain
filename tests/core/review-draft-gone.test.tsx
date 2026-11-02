// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Campaigns } from "@/components/campaigns";
import { writeCampaignRecovery, recoveryStorageKey } from "@/lib/meta-connect-ui/recovery";
import type { DraftDTO, DraftInput } from "@/lib/campaign/connect-contracts";
import type { Business, Creative } from "@/lib/types";

// #681: a draft expires after 7 days (or is removed in another tab). Review must not keep failing "Draft not found." on it.
const mocks = vi.hoisted(() => ({ drafts: vi.fn(), draft: vi.fn(), status: vi.fn(), operationForRequest: vi.fn(), saveDraft: vi.fn(), updateDraft: vi.fn(), preflight: vi.fn() }));
const ClientError = vi.hoisted(() => class extends Error {
  constructor(message: string, readonly code: string) { super(message); }
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/meta-connect/meta-connect-dialog", () => ({ MetaConnectDialog: () => null }));
vi.mock("@/components/campaign-chat", () => ({ CampaignChat: () => null }));
vi.mock("@/lib/meta-connect-ui/client", () => ({ createMetaConnectClient: () => mocks, MetaConnectClientError: ClientError }));
vi.mock("@/app/(app)/studio/actions", () => ({ setCreativeStatus: vi.fn(), deleteCreative: vi.fn() }));

const business = { id: "11111111-1111-4111-8111-111111111111", owner_id: "owner-1", name: "Cedar Ridge", locations: ["Austin"] } as Business;
const approved = { id: "33333333-3333-4333-8333-333333333333", business_id: business.id, headline: "Back pain relief", primary_text: "Text",
  cta: "Book Now", image_url: "/icon.png", status: "approved" } as Creative;
const FORM = "1732372914636573";
const NEW_DRAFT = "90d1d2bb-466c-4889-9af2-edb533e82531";
const old = { draftId: "55555555-5555-4555-8555-555555555555", version: 3, expiresAt: new Date(Date.now() + 60_000).toISOString(),
  input: { businessId: business.id, name: "Spine week", goal: "Leads", mode: "manual", creativeIds: [approved.id], dailyBudgetRupees: 300,
    leadFormId: FORM, destination: "instant_form", targeting: { age: { mode: "manual", min: 25, max: 55 },
      location: { mode: "manual", includedNames: ["Austin, Texas"], excludedNames: [], radiusKm: 25 }, audience: { interestNames: ["Wellness"], rationale: "Adults." } },
    abTest: false } } as unknown as DraftDTO;
const gone = () => new ClientError("Draft not found.", "NOT_FOUND");
const recoveryKey = recoveryStorageKey(business.owner_id, business.id);

function open() {
  return render(<Campaigns business={business} approved={[approved]} initialCampaigns={[]} initialResults={{}}
    leadForms={[]} leadFormError={null} metaReady adAccountId="act_1" />);
}

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  localStorage.setItem(`campaign-sync:${business.owner_id}:${business.id}:`, String(Date.now()));
  mocks.drafts.mockResolvedValue([]);
  mocks.status.mockResolvedValue({ authorization: "connected", generation: 1, selected: { pageId: "1", adAccountId: "act_1" } });
  mocks.saveDraft.mockImplementation(async (input: DraftInput): Promise<DraftDTO> => ({ draftId: NEW_DRAFT, version: 1, expiresAt: "2099-01-01T00:00:00.000Z", input }));
  mocks.preflight.mockReturnValue(new Promise(() => {}));
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(String(url).startsWith("/api/meta/whatsapp")
    ? { state: "unavailable" }
    : String(url).startsWith("/api/campaigns/plan") ? { ready: false } : { forms: [{ id: FORM, name: "Enquiries", status: "ACTIVE" }] })));
  writeCampaignRecovery(sessionStorage, recoveryKey, { draft: old, request: null, operationId: null });
});

describe("Review on a draft that's gone (#681)", () => {
  it("drops a recovered draft that expired, without an error, so the tab isn't stuck on it", async () => {
    mocks.draft.mockRejectedValue(gone());
    open();
    await waitFor(() => expect(mocks.draft).toHaveBeenCalledWith(old.draftId, expect.anything()));
    await waitFor(() => expect(sessionStorage.getItem(recoveryKey)).toBeNull());
    expect(screen.queryByText("Draft not found.")).toBeNull();
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it("keeps the error when a launch was in flight for that draft", async () => {
    writeCampaignRecovery(sessionStorage, recoveryKey, { draft: old, request: { businessId: business.id, draftId: old.draftId, draftVersion: old.version,
      planHash: "a".repeat(64), connectionGeneration: 1, idempotencyKey: "66666666-6666-4666-8666-666666666666" }, operationId: null });
    mocks.operationForRequest.mockResolvedValue(null);
    mocks.draft.mockRejectedValue(gone());
    open();
    expect(await screen.findByText("Draft not found.")).toBeTruthy();
    expect(sessionStorage.getItem(recoveryKey)).not.toBeNull();
  });

  it("Check my campaign saves a new draft when the one it was updating has expired, and reviews that", async () => {
    mocks.draft.mockResolvedValue(old);
    mocks.updateDraft.mockRejectedValue(gone());
    open();
    await waitFor(() => expect(mocks.status).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Check my campaign/, hidden: true }));
    await waitFor(() => expect(mocks.updateDraft).toHaveBeenCalledWith(old.draftId, old.version, expect.anything(), expect.anything()));
    await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalledTimes(1));
    expect(mocks.saveDraft.mock.calls[0][0]).toMatchObject({ creativeIds: [approved.id], leadFormId: FORM });
    await waitFor(() => expect(mocks.preflight).toHaveBeenCalledWith(business.id, NEW_DRAFT, 1, expect.anything()));
    expect(screen.queryByText("Draft not found.")).toBeNull();
  });

  it("still stops on a draft changed in another tab (no silent overwrite)", async () => {
    mocks.draft.mockResolvedValue(old);
    mocks.updateDraft.mockRejectedValue(new ClientError("Draft changed in another tab. Reload before saving.", "CONFLICT"));
    open();
    await waitFor(() => expect(mocks.status).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Check my campaign/, hidden: true }));
    expect(await screen.findByText("Draft changed in another tab. Reload before saving.")).toBeTruthy();
    expect(mocks.saveDraft).not.toHaveBeenCalled();
  });
});
