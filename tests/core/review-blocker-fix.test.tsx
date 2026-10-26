// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Campaigns } from "@/components/campaigns";
import type { DraftDTO, DraftInput } from "@/lib/campaign/connect-contracts";
import { runPreflight, type PreflightInput } from "@/lib/campaign/preflight";
import { reviewBlockerAlternative, reviewBlockerFix } from "@/lib/campaign/review-fix";
import { reviewBlockerReasons, type ReviewBlockerReason } from "@/lib/meta/connect-contracts";
import type { Business, Creative } from "@/lib/types";

// #723: every Review blocker gives the owner a one-tap fix: it opens the page that fixes it,
// opens Connect Facebook, or jumps to and focuses the composer control that fixes it.
// Reviews are the real runPreflight on the production Cedar Ridge draft (Oct 21, see
// campaign-preflight.test.ts), changed one way per blocker.
const mocks = vi.hoisted(() => ({
  drafts: vi.fn(), draft: vi.fn(), saveDraft: vi.fn(), updateDraft: vi.fn(), status: vi.fn(), preflight: vi.fn(), createCampaign: vi.fn(), operationForRequest: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/meta-connect/meta-connect-dialog", () => ({
  MetaConnectDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Connect Facebook" /> : null),
}));
vi.mock("@/components/campaign-chat", () => ({ CampaignChat: () => null }));
vi.mock("@/lib/meta-connect-ui/client", () => ({ createMetaConnectClient: () => mocks, MetaConnectClientError: class extends Error {} }));

const businessId = "816aaafb-7ebc-4ad7-bbda-001beff172f8";
const creativeId = "e3d165a9-bbf8-47f7-8c61-e69dbb8ee3d1";
const selected = {
  metaBusinessId: null, adAccountId: "act_2398686420592052", accountName: "Solaride 101",
  pageId: "885223068001054", pageName: "Solaride Energy", currency: "INR", timezoneName: "Asia/Kolkata",
};
const productionDraft = {
  businessId, name: "TEST AdBrain core loop - delete", goal: "Book new-patient exams", mode: "manual" as const,
  creativeIds: [creativeId], dailyBudgetRupees: 200, leadFormId: "1732372914636573", abTest: false, destination: "instant_form" as const,
  targeting: {
    location: { mode: "ai" as const, cityScope: "radius" as const, radiusKm: 25, includedNames: ["Austin, Texas"] },
    age: { mode: "manual" as const, min: 25, max: 55 },
    audience: { interestNames: ["Wellness"], rationale: "Adults near the clinic." },
  },
};
function productionInput(): PreflightInput {
  return {
    draft: structuredClone(productionDraft), draftId: "90d1d2bb-466c-4889-9af2-edb533e82531", draftVersion: 2,
    connection: { generation: 1, canCreatePaused: true, selected: { ...selected } },
    creatives: [{ id: creativeId, businessId, approved: true, imageUrl: "https://example.com/ad.png", headline: "New-Patient Exam with Posture Scan" }],
    form: { id: "1732372914636573", businessId, active: true },
    whatsappNumber: "+919876543210",
    website: "https://cedarridgechiro.com",
    geo: { resolvedAreaLabel: "Austin, Texas", unresolvedNames: [], explicitlyNationwide: false, audienceInterests: [{ id: "6840321905207", name: "Wellness" }] },
    hash: () => "a".repeat(64),
  };
}
const breaks: Record<ReviewBlockerReason, (input: PreflightInput) => void> = {
  REVIEW_NO_META_CONNECTION: (input) => { input.connection = null; },
  REVIEW_CURRENCY: (input) => { input.connection!.selected!.currency = "USD"; },
  REVIEW_META_ACCESS: (input) => { input.connection!.canCreatePaused = false; },
  REVIEW_CREATIVES: (input) => { input.creatives[0].approved = false; },
  REVIEW_WHATSAPP_NOT_LINKED: (input) => { input.draft.destination = "whatsapp"; input.whatsappNumber = null; },
  REVIEW_NO_LEAD_FORM: (input) => { input.form = null; },
  REVIEW_NO_WEBSITE: (input) => { input.website = "https://www.facebook.com/cedarridge"; },
  REVIEW_BUDGET: (input) => { input.draft.dailyBudgetRupees = 0; },
  REVIEW_NO_AGE_RANGE: (input) => { input.draft.targeting.age = { mode: "ai" }; },
  REVIEW_RADIUS: (input) => { input.draft.targeting.location = { ...input.draft.targeting.location!, radiusKm: 10 }; },
  REVIEW_CITY_RADIUS: (input) => {
    input.draft.targeting.location = { ...input.draft.targeting.location!, cityScope: "city_only" };
    input.geo.location = { cities: [{ key: "2420379", radius: 25, distance_unit: "kilometer" }] } as PreflightInput["geo"]["location"];
  },
  REVIEW_AREAS_UNRESOLVED: (input) => { input.geo.unresolvedNames = ["Austin, Texas"]; input.geo.resolvedAreaLabel = null; },
  REVIEW_NO_AUDIENCE: (input) => { delete input.draft.targeting.audience; },
  REVIEW_INTERESTS_UNRESOLVED: (input) => { input.geo.audienceInterests = []; input.geo.unresolvedInterests = ["Wellness"]; },
  REVIEW_AD_POLICY: (input) => { input.vertical = "chiropractic clinic"; input.creatives[0].headline = "Cures back pain, guaranteed"; },
};
function reviewBlockedOn(reason: ReviewBlockerReason) {
  const input = productionInput();
  breaks[reason](input);
  const review = runPreflight(input);
  expect(review.blockers.map((item) => item.reason)).toEqual([reason]);
  return review;
}

const business = { id: businessId, owner_id: "owner-1", name: "Cedar Ridge Chiropractic", locations: ["Austin, Texas"] } as Business;
const creative = { id: creativeId, headline: "New-Patient Exam with Posture Scan", image_url: "/icon.png", status: "approved" } as Creative;
let composerTargeting: DraftInput["targeting"];
const aiAreas: DraftInput["targeting"] = {
  age: { mode: "manual", min: 25, max: 55 },
  location: { mode: "ai", includedNames: ["Austin, Texas"], excludedNames: [], radiusKm: 25 },
  audience: { interestNames: ["Wellness"], rationale: "Adults near the clinic." },
};
const scrollIntoView = vi.fn();

async function prepareBlockedOn(reason: ReviewBlockerReason) {
  mocks.preflight.mockResolvedValue(reviewBlockedOn(reason));
  render(<Campaigns business={business} approved={[creative]} initialCampaigns={[]} initialResults={{}} leadForms={[]} leadFormError={null} metaReady adAccountId="" />);
  const leadForm = screen.getByLabelText("Lead form");
  await within(leadForm).findByRole("option", { name: "Enquiries" });
  fireEvent.change(leadForm, { target: { value: "1732372914636573" } });
  fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
  fireEvent.click(screen.getByRole("button", { name: "Check my campaign (nothing spends)" }));
  const region = await screen.findByRole("region", { name: "Campaign review result" });
  await within(region).findByText(/Fix 1 item before sending to Meta/);
  return region;
}

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  localStorage.setItem(`campaign-sync:${business.owner_id}:${business.id}:`, String(Date.now()));
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
  composerTargeting = aiAreas;
  mocks.drafts.mockResolvedValue([]);
  mocks.status.mockResolvedValue({ authorization: "connected", selected, generation: 1 });
  mocks.saveDraft.mockImplementation(async (input: DraftInput): Promise<DraftDTO> => ({ draftId: "90d1d2bb-466c-4889-9af2-edb533e82531", version: 2, expiresAt: "2099-01-01T00:00:00.000Z", input }));
  mocks.updateDraft.mockImplementation(async (draftId: string, version: number, input: DraftInput): Promise<DraftDTO> => ({ draftId, version: version + 1, expiresAt: "2099-01-01T00:00:00.000Z", input }));
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url === "/api/campaigns/plan"
    ? { ready: true, targeting: composerTargeting }
    : { forms: [{ id: "1732372914636573", name: "Enquiries", status: "ACTIVE" }] })));
});
afterEach(() => { Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView"); vi.unstubAllGlobals(); });

describe("core: every Review blocker has a one-tap fix (#723)", () => {
  it.each(reviewBlockerReasons)("%s names a fix", (reason) => {
    expect(reviewBlockerFix(reason)?.label).toMatch(/\w/);
  });

  // The control each fix lands on, as the owner finds it in the composer.
  const fields: [ReviewBlockerReason, () => HTMLElement][] = [
    ["REVIEW_CREATIVES", () => screen.getByRole("button", { name: creative.headline! })],
    ["REVIEW_AD_POLICY", () => screen.getByRole("button", { name: creative.headline! })],
    ["REVIEW_NO_LEAD_FORM", () => screen.getByLabelText("Lead form")],
    ["REVIEW_BUDGET", () => screen.getByLabelText("Daily budget (₹)")],
    ["REVIEW_NO_AGE_RANGE", () => screen.getByLabelText("Minimum age")],
    ["REVIEW_RADIUS", () => screen.getByLabelText("City radius in kilometers")],
    // AdBrain chose the areas, so the place to change them is the locations' "Choose myself" (the first one).
    ["REVIEW_CITY_RADIUS", () => screen.getAllByRole("button", { name: "Choose myself" })[0]],
    ["REVIEW_AREAS_UNRESOLVED", () => screen.getAllByRole("button", { name: "Choose myself" })[0]],
    ["REVIEW_NO_AUDIENCE", () => screen.getAllByRole("button", { name: "Recommend audience" }).at(-1)!],
    ["REVIEW_INTERESTS_UNRESOLVED", () => screen.getByLabelText("Interests (up to 5, one per line)")],
  ];
  it.each(fields)("%s: the fix focuses the control that fixes it", async (reason, control) => {
    const region = await prepareBlockedOn(reason);
    fireEvent.click(within(region).getByRole("button", { name: reviewBlockerFix(reason)!.label }));
    expect(control()).toHaveFocus();
    expect(scrollIntoView.mock.contexts).toContain(control());
  });

  // With areas chosen by hand: Meta's own city picks go through the search; typed names (#740) sit in Planned areas.
  it.each([
    ["REVIEW_CITY_RADIUS", "Search locations to include"],
    ["REVIEW_AREAS_UNRESOLVED", "Planned areas"],
  ] as const)("%s: with areas chosen by hand, the fix focuses %s", async (reason, field) => {
    composerTargeting = { ...aiAreas, location: { mode: "manual", included: [{ key: "2420379", name: "Austin", type: "city", radiusKm: 25 }], excluded: [], radiusKm: 25 } } as DraftInput["targeting"];
    const region = await prepareBlockedOn(reason);
    fireEvent.click(within(region).getByRole("button", { name: reviewBlockerFix(reason)!.label }));
    expect(screen.getByLabelText(field)).toHaveFocus();
  });

  it.each(["REVIEW_NO_WEBSITE", "REVIEW_WHATSAPP_NOT_LINKED"] as const)("%s: the fix opens Brand Brain", async (reason) => {
    const region = await prepareBlockedOn(reason);
    expect(within(region).getByRole("link", { name: reviewBlockerFix(reason)!.label })).toHaveAttribute("href", "/brand");
  });

  // #742: QA's 390 px walk: a site-less owner on Instant form was only told to add a website.
  it("REVIEW_NO_WEBSITE also offers WhatsApp chat, which the same draft passes without a website", async () => {
    const input = productionInput();
    breaks.REVIEW_NO_WEBSITE(input);
    input.draft.destination = "whatsapp";
    expect(runPreflight(input).blockers).toEqual([]);

    const region = await prepareBlockedOn("REVIEW_NO_WEBSITE");
    fireEvent.click(within(region).getByRole("button", { name: reviewBlockerAlternative("REVIEW_NO_WEBSITE")!.label }));
    const whatsapp = screen.getByRole("radio", { name: "WhatsApp chat" });
    expect(whatsapp).toBeChecked();
    expect(whatsapp).toHaveFocus();
  });

  // #756: the blocked review said "prepare the review again" with no button there; Prepare was far below.
  it("after a fix, Check again in the review re-runs Review in place", async () => {
    const region = await prepareBlockedOn("REVIEW_BUDGET");
    mocks.preflight.mockResolvedValue(runPreflight(productionInput()));
    fireEvent.click(within(region).getByRole("button", { name: reviewBlockerFix("REVIEW_BUDGET")!.label }));
    fireEvent.change(screen.getByLabelText("Daily budget (₹)"), { target: { value: "300" } });
    fireEvent.click(within(screen.getByRole("region", { name: "Campaign review result" })).getByRole("button", { name: "Check again" }));
    expect(await screen.findByRole("button", { name: "Send to Meta (paused)" })).toBeInTheDocument();
    expect(mocks.preflight).toHaveBeenCalledTimes(2);
  });

  it.each(["REVIEW_NO_META_CONNECTION", "REVIEW_CURRENCY", "REVIEW_META_ACCESS"] as const)("%s: the fix opens Connect Facebook", async (reason) => {
    const region = await prepareBlockedOn(reason);
    fireEvent.click(within(region).getByRole("button", { name: reviewBlockerFix(reason)!.label }));
    expect(await screen.findByRole("dialog", { name: "Connect Facebook" })).toBeInTheDocument();
  });

  // #772: Prepare was silently disabled until an ad and a budget were set; a tap did nothing.
  async function openComposer() {
    render(<Campaigns business={business} approved={[creative]} initialCampaigns={[]} initialResults={{}} leadForms={[]} leadFormError={null} metaReady adAccountId="" />);
    const leadForm = screen.getByLabelText("Lead form");
    await within(leadForm).findByRole("option", { name: "Enquiries" });
    fireEvent.change(leadForm, { target: { value: "1732372914636573" } });
  }

  it("Prepare with no ad says so beside the ads and focuses the first one", async () => {
    await openComposer();
    const prepare = screen.getByRole("button", { name: "Check my campaign (nothing spends)" });
    expect(prepare).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(prepare);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Choose at least one ad to send to Meta.");
    // #724 walk at 1440 px: below 11 ads the message sat ~440 px under the fold; it now leads the picker.
    expect(alert.compareDocumentPosition(document.getElementById("campaign-ad-picker")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const firstAd = screen.getByRole("button", { name: creative.headline! });
    expect(firstAd).toHaveFocus();
    expect(firstAd).toHaveAttribute("aria-describedby", alert.id);
    expect(mocks.saveDraft).not.toHaveBeenCalled();
  });

  it("Prepare with no budget says so beside Budget and focuses it", async () => {
    await openComposer();
    fireEvent.click(screen.getByRole("button", { name: creative.headline! }));
    const budget = screen.getByLabelText("Daily budget (₹)");
    fireEvent.change(budget, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Check my campaign (nothing spends)" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Set a daily budget above ₹0.");
    expect(budget).toHaveFocus();
    expect(budget).toHaveAttribute("aria-describedby", alert.id);
    expect(mocks.saveDraft).not.toHaveBeenCalled();
  });
});
