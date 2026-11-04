// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Campaigns } from "@/components/campaigns";
import { draftDtoSchema, type DraftDTO, type DraftInput } from "@/lib/campaign/connect-contracts";
import { prepareCampaignReview, type PreflightLoaders } from "@/lib/campaign/preflight-service";
import { MetaConnectClientError } from "@/lib/meta-connect-ui/client";
import { readCampaignRecovery, recoveryStorageKey } from "@/lib/meta-connect-ui/recovery";
import type { Business, Creative } from "@/lib/types";
import type { WebsiteGoal } from "@/lib/types/campaign";

const mocks = vi.hoisted(() => ({
  drafts: vi.fn(), draft: vi.fn(), saveDraft: vi.fn(), updateDraft: vi.fn(),
  status: vi.fn(), preflight: vi.fn(), createCampaign: vi.fn(), operationForRequest: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/meta-connect/meta-connect-dialog", () => ({ MetaConnectDialog: () => null }));
vi.mock("@/components/campaign-chat", () => ({ CampaignChat: () => null }));
vi.mock("@/app/(app)/studio/actions", () => ({ setCreativeStatus: vi.fn(), deleteCreative: vi.fn() }));
vi.mock("@/lib/meta-connect-ui/client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/meta-connect-ui/client")>(),
  createMetaConnectClient: () => mocks,
}));

const business = {
  id: "11111111-1111-4111-8111-111111111111",
  owner_id: "owner-1",
  name: "Website shop",
  locations: ["Jaipur"],
  website: "https://shop.example.com",
} as Business;
const creative = {
  id: "22222222-2222-4222-8222-222222222222",
  business_id: business.id,
  headline: "Local offer",
  primary_text: "See our offer",
  image_url: "/icon.png",
  status: "approved",
} as Creative;
const newDraftId = "44444444-4444-4444-8444-444444444444";
const recoveryKey = recoveryStorageKey(business.owner_id, business.id);
let saved: DraftDTO;

function websiteDraft(websiteGoal: WebsiteGoal): DraftDTO {
  return draftDtoSchema.parse({
    draftId: "33333333-3333-4333-8333-333333333333",
    version: 3,
    expiresAt: "2099-01-01T00:00:00.000Z",
    input: {
      businessId: business.id, name: "Website conversions", goal: "Local enquiries", mode: "manual",
      creativeIds: [creative.id], dailyBudgetRupees: 300, leadFormId: null, destination: "website", websiteGoal,
      targeting: {
        age: { mode: "manual", min: 25, max: 55 },
        location: { mode: "manual", includedNames: ["Jaipur"], excludedNames: [], radiusKm: 25 },
        audience: { interestNames: ["Home improvement"], rationale: "People near the offer." },
      },
      abTest: false,
    },
  });
}

async function reopen(goal: WebsiteGoal) {
  saved = websiteDraft(goal);
  mocks.drafts.mockResolvedValue([saved]);
  render(<Campaigns business={business} approved={[creative]} initialCampaigns={[]} initialDrafts={[saved]}
    initialResults={{}} leadForms={[]} leadFormError={null} metaReady adAccountId="act_1" internal />);
  fireEvent.click(screen.getByText("Saved drafts"));
  fireEvent.click(screen.getByRole("button", { name: /^Website conversions/ }));
  await waitFor(() => expect(screen.getByRole("radio", { name: "Website" })).toBeChecked());
}

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  localStorage.setItem(`campaign-sync:${business.owner_id}:${business.id}:act_1`, String(Date.now()));
  mocks.drafts.mockResolvedValue([]);
  mocks.draft.mockImplementation(async () => saved);
  mocks.status.mockResolvedValue({ authorization: "connected", generation: 1, selected: { pageId: "1", adAccountId: "act_1" } });
  mocks.updateDraft.mockImplementation(async (_id: string, version: number, input: DraftInput) =>
    (saved = { ...saved, version: version + 1, input }));
  mocks.saveDraft.mockImplementation(async (input: DraftInput) =>
    (saved = { draftId: newDraftId, version: 1, expiresAt: "2099-01-01T00:00:00.000Z", input }));
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(String(url).startsWith("/api/meta/whatsapp")
    ? { state: "unavailable" } : { forms: [] })));
});

describe("website conversion draft recovery", () => {
  it.each(["leads", "sales"] as const)("keeps %s when an existing draft is reopened and saved", async (goal) => {
    await reopen(goal);
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await screen.findByText("Campaign draft saved.");
    expect(saved.input).toMatchObject({ destination: "website", websiteGoal: goal });
    expect(readCampaignRecovery(sessionStorage, recoveryKey, business.id)?.draft.input.websiteGoal).toBe(goal);
  });

  it("keeps the conversion goal in both attempts when a save is retried", async () => {
    const attempts: DraftInput[] = [];
    mocks.updateDraft.mockImplementation(async (_id: string, version: number, input: DraftInput) => {
      attempts.push(input);
      if (attempts.length === 1) throw new Error("Save unavailable. Try again.");
      return (saved = { ...saved, version: version + 1, input });
    });
    await reopen("sales");
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await screen.findByText("Save unavailable. Try again.");
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await screen.findByText("Campaign draft saved.");
    expect(attempts.map((input) => input.websiteGoal)).toEqual(["sales", "sales"]);
    expect(saved.input.websiteGoal).toBe("sales");
  });

  it("keeps the conversion goal if an expired draft must be saved as a new one", async () => {
    mocks.updateDraft.mockRejectedValue(new MetaConnectClientError("Draft not found.", { code: "NOT_FOUND" }));
    await reopen("leads");
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await screen.findByText("Campaign draft saved.");
    expect(saved.draftId).toBe(newDraftId);
    expect(saved.input).toMatchObject({ destination: "website", websiteGoal: "leads" });
    expect(readCampaignRecovery(sessionStorage, recoveryKey, business.id)?.draft.input.websiteGoal).toBe("leads");
  });

  it("changes a restored conversion draft to visits only after the owner selects visits", async () => {
    await reopen("leads");
    expect(screen.getByRole("radio", { name: "Website leads" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Visits" }));
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await screen.findByText("Campaign draft saved.");
    expect(saved.input.destination).toBe("website");
    expect(saved.input).not.toHaveProperty("websiteGoal");
  });

  it("keeps the real conversion Review gate closed after reopening and checking", async () => {
    const unexpected = async () => { throw new Error("Review proceeded beyond the conversion gate."); };
    const loaders: PreflightLoaders = {
      findDraft: async () => ({
        id: saved.draftId, businessId: business.id, ownerId: business.owner_id,
        version: saved.version, input: saved.input, expiresAt: saved.expiresAt,
        createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z",
      }),
      findCreatives: unexpected, findForm: unexpected, getConnection: unexpected, resolveGeo: unexpected, hash: () => "unused",
    };
    mocks.preflight.mockImplementation(async (_businessId: string, draftId: string, version: number) => {
      const result = await prepareCampaignReview(loaders, {
        actor: { businessId: business.id, userId: business.owner_id }, draftId, requestedDraftVersion: version,
        now: "2026-11-04T00:00:00.000Z", websiteOpen: () => true,
      });
      if (result.kind === "website_closed") throw new MetaConnectClientError("Website conversions are not open yet.", { code: "FORBIDDEN" });
      throw new Error(`Unexpected Review result: ${result.kind}`);
    });
    await reopen("sales");
    fireEvent.click(screen.getByRole("button", { name: /Check my campaign/ }));
    expect(await screen.findByText(/Website conversions are not open yet/)).toBeInTheDocument();
    expect(saved.input.websiteGoal).toBe("sales");
    expect(screen.queryByRole("button", { name: "Send to Meta (paused)" })).not.toBeInTheDocument();
    expect(mocks.createCampaign).not.toHaveBeenCalled();
  });
});
