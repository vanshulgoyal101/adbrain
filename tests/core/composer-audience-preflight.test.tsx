// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import groqAudience from "./fixtures/planner/groq-audience-city-only.json";
import { Campaigns } from "@/components/campaigns";
import type { DraftDTO, DraftInput } from "@/lib/campaign/connect-contracts";
import { plannerPlanToDraftInput } from "@/lib/campaign/planner-draft";
import { runPreflight } from "@/lib/campaign/preflight";
import type { Business, Campaign, CampaignResult, Creative } from "@/lib/types";

// #2299 (#2292, #2257's siblings): every way the composer makes a draft must plan the audience before Review.
// Review here is the real runPreflight over the draft the composer actually saved (as setup-go-live-flow.test.ts
// does for Go live), and the plan route answers with the recorded Groq plan through plannerPlanToDraftInput, as
// the route does. A stubbed Review would pass even if the composer stopped planning.
const mocks = vi.hoisted(() => ({
  drafts: vi.fn(), draft: vi.fn(), saveDraft: vi.fn(), updateDraft: vi.fn(), status: vi.fn(), preflight: vi.fn(), createCampaign: vi.fn(), operationForRequest: vi.fn(),
  guidedDraft: { current: null as DraftDTO | null },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/meta-connect/meta-connect-dialog", () => ({
  MetaConnectDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Connect Facebook" /> : null),
}));
// The guided chat itself is planner-route UI; this hands the composer the draft the route returns.
vi.mock("@/components/campaign-chat", () => ({
  CampaignChat: ({ onDraftReady }: { onDraftReady?: (draft: DraftDTO) => void }) => (
    <button type="button" onClick={() => onDraftReady?.(mocks.guidedDraft.current!)}>Planned draft ready</button>
  ),
}));
// The verdict's wording rules are covered elsewhere; this exposes the card's real Run this again.
vi.mock("@/components/campaign-verdict", () => ({
  CampaignVerdict: ({ onRunAgain }: { onRunAgain?: () => void }) => <button type="button" onClick={onRunAgain}>Run this again</button>,
}));
vi.mock("@/lib/meta-connect-ui/client", () => ({ createMetaConnectClient: () => mocks, MetaConnectClientError: class extends Error {} }));

const businessId = "816aaafb-7ebc-4ad7-bbda-001beff172f8";
const creativeId = "e3d165a9-bbf8-47f7-8c61-e69dbb8ee3d1";
const whatsappNumber = "+919876543210";
const selected = {
  metaBusinessId: null, adAccountId: "act_9000000000000001", accountName: "Solaride 101",
  pageId: "900000000000002", pageName: "Solaride Energy", currency: "INR", timezoneName: "Asia/Kolkata",
};
const business = { id: businessId, owner_id: "owner-1", name: "Cedar Ridge Chiropractic", vertical: "chiropractic clinic", locations: ["Austin, Texas"], phone: whatsappNumber } as Business;
const creative = { id: creativeId, headline: "New-Patient Exam with Posture Scan", image_url: "/icon.png", status: "approved" } as Creative;
const recordedPlan: Record<string, unknown> = { ...groqAudience.plan };
// The planner drops the recorded radius_km 0 (planner.ts), as Groq sent it for a city-only plan.
delete recordedPlan.radius_km;

const saved = new Map<string, DraftInput>();
let planned = 0;
let reviewed: string[][] = [];

/** POST /api/campaigns/plan's audience-only answer, built as the route builds it. */
function planAnswer(body: { goal: string; audienceDraft: DraftInput }) {
  const draft = body.audienceDraft;
  const result = plannerPlanToDraftInput({
    businessId, goal: body.goal, approvedCreativeIds: [creativeId], leadFormIds: [],
    plan: { ...recordedPlan, name: draft.name, daily_budget_rupees: draft.dailyBudgetRupees, creative_ids: draft.creativeIds, lead_form_id: null, destination: draft.destination, city_scope: draft.targeting.location?.cityScope ?? "radius", ...(draft.targeting.location?.radiusKm ? { radius_km: draft.targeting.location.radiusKm } : {}) },
  });
  if (!result.ok) throw new Error(result.error);
  const targeting = {
    ...result.draft.targeting,
    gender: draft.targeting.gender ?? "all",
    ...(draft.targeting.age?.mode === "manual" ? { age: draft.targeting.age } : {}),
  };
  return { ready: true, targeting };
}

/** The real Review of a saved draft; Meta resolves its areas and interests. */
function review(draftId: string, version: number) {
  const draft = saved.get(draftId);
  if (!draft) throw new Error(`No saved draft ${draftId}`);
  const result = runPreflight({
    draft, draftId, draftVersion: version,
    connection: { generation: 1, canCreatePaused: true, selected: { ...selected } },
    creatives: [{ id: creativeId, businessId, approved: true, imageUrl: "https://example.com/ad.png", headline: creative.headline! }],
    form: null, whatsappNumber, website: "https://cedarridgechiro.com",
    geo: { resolvedAreaLabel: "Austin, Texas", unresolvedNames: [], explicitlyNationwide: false,
      audienceInterests: (draft.targeting.audience?.interestNames ?? []).map((name, index) => ({ id: `600000000000${index}`, name })) },
    hash: (payload) => createHash("sha256").update(payload).digest("hex"),
  });
  reviewed.push(result.blockers.map((blocker) => blocker.reason ?? blocker.code));
  return result;
}

const pastCampaign = {
  id: "c0402b05-86b9-4b51-b9b3-381996eee7cd", business_id: businessId, name: "Solaride WhatsApp", status: "completed", objective: "leads",
  daily_budget: 300, creative_ids: [creativeId], destination: "whatsapp", meta_campaign_id: "120000000000000001",
  created_at: "2026-10-20T00:00:00.000Z", raw: {},
} as unknown as Campaign;
const pastResult = {
  campaign_id: pastCampaign.id, impressions: 9220, clicks: 59, spend: 444.12, leads: 0, conversations: 2, whatsapp_opens: 52,
  fetched_at: "2026-10-29T15:54:00.000Z",
} as unknown as CampaignResult;

function renderComposer(campaigns: Campaign[] = []) {
  render(<Campaigns business={business} approved={[creative]} initialCampaigns={campaigns}
    initialResults={campaigns.length ? { [pastCampaign.id]: pastResult } : {}} leadForms={[]} leadFormError={null} metaReady adAccountId="" />);
}

async function expectReadyReview() {
  const region = await screen.findByRole("region", { name: "Campaign review result" });
  expect(await within(region).findByRole("button", { name: "Send to Meta (paused)" })).toBeInTheDocument();
  const reasons = reviewed.at(-1)!;
  expect(reasons).not.toContain("REVIEW_NO_AGE_RANGE");
  expect(reasons).not.toContain("REVIEW_NO_AUDIENCE");
  expect(reasons).toEqual([]);
}

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  localStorage.setItem(`campaign-sync:${business.owner_id}:${business.id}:`, String(Date.now()));
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  saved.clear();
  planned = 0;
  reviewed = [];
  mocks.guidedDraft.current = null;
  mocks.drafts.mockResolvedValue([]);
  mocks.status.mockResolvedValue({ authorization: "connected", selected, generation: 1 });
  mocks.saveDraft.mockImplementation(async (input: DraftInput): Promise<DraftDTO> => {
    const draftId = "90d1d2bb-466c-4889-9af2-edb533e82531";
    saved.set(draftId, input);
    return { draftId, version: 1, expiresAt: "2099-01-01T00:00:00.000Z", input };
  });
  mocks.updateDraft.mockImplementation(async (draftId: string, version: number, input: DraftInput): Promise<DraftDTO> => {
    saved.set(draftId, input);
    return { draftId, version: version + 1, expiresAt: "2099-01-01T00:00:00.000Z", input };
  });
  mocks.preflight.mockImplementation(async (_business: string, draftId: string, version: number) => review(draftId, version));
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/campaigns/plan") {
      planned += 1;
      return Response.json(planAnswer(JSON.parse(String(init!.body))));
    }
    if (url === `/api/campaigns/${pastCampaign.id}/rerun`) {
      // A campaign without its launch draft: the copy carries no targeting, so the composer's defaults apply.
      return Response.json({ prefill: {
        name: "Solaride WhatsApp (again)", goal: "Get WhatsApp enquiries", creativeIds: [creativeId], dailyBudgetRupees: 300,
        destination: "whatsapp", leadFormId: null, whatsappNumber, targeting: null, abTest: false, dropped: 0, source: "campaign",
      } });
    }
    if (url.startsWith("/api/meta/whatsapp")) return Response.json({ state: "ready", numbers: [{ masked: whatsappNumber, source: "business" }] });
    return Response.json({ forms: [] });
  }));
});
afterEach(() => { Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView"); vi.unstubAllGlobals(); });

describe("every composer draft is audience-planned before Review (#2299)", () => {
  it("Check my campaign with AdBrain's age and no audience plans first, so Review has an age and an audience", async () => {
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    fireEvent.click(screen.getByRole("button", { name: "Check my campaign (nothing spends)" }));
    await expectReadyReview();
    expect(planned).toBe(1);
    const draft = [...saved.values()].at(-1)!;
    expect(draft.targeting.age).toMatchObject({ mode: "manual", min: 30, max: 60 });
    expect(draft.targeting.audience?.interestNames.length).toBeGreaterThan(0);
  });

  it("Run this again with no copied targeting plans first, so Review has an age and an audience", async () => {
    renderComposer([pastCampaign]);
    fireEvent.click(await screen.findByRole("button", { name: "Run this again" }));
    fireEvent.click(await screen.findByRole("button", { name: "Check my campaign (nothing spends)" }));
    await expectReadyReview();
    expect(planned).toBe(1);
  });

  it("Plan with AdBrain's planned draft reaches Review with an age and an audience", async () => {
    const result = plannerPlanToDraftInput({
      businessId, goal: "Get WhatsApp enquiries", business: { vertical: business.vertical, offers: [] },
      plan: { ...recordedPlan, destination: "whatsapp", lead_form_id: null },
      approvedCreativeIds: [creativeId], leadFormIds: [],
    });
    if (!result.ok) throw new Error(result.error);
    const draft: DraftDTO = { draftId: "a1b2c3d4-0000-4000-8000-000000000001", version: 1, expiresAt: "2099-01-01T00:00:00.000Z", input: { ...result.draft, whatsappNumber } };
    saved.set(draft.draftId, draft.input);
    mocks.guidedDraft.current = draft;
    renderComposer();
    fireEvent.click(screen.getByRole("radio", { name: "Plan with AdBrain" }));
    fireEvent.click(await screen.findByRole("button", { name: "Planned draft ready" }));
    await expectReadyReview();
  });
});
