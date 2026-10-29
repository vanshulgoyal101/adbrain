import { describe, expect, it } from "vitest";
import { runPreflight, type PreflightInput } from "@/lib/campaign/preflight";
import { productEventSchema } from "@/lib/observability/events";

// #688: every Review blocker has its own stable reason, so production can rank which fix owners need.
const businessId = "816aaafb-7ebc-4ad7-bbda-001beff172f8";
const creativeId = "e3d165a9-bbf8-47f7-8c61-e69dbb8ee3d1";

function input(): PreflightInput {
  return {
    draft: {
      businessId, name: "Cedar Ridge exams", goal: "Book new-patient exams", mode: "manual", destination: "instant_form",
      creativeIds: [creativeId], dailyBudgetRupees: 200, leadFormId: "form-1", abTest: false,
      targeting: {
        location: { mode: "ai", cityScope: "city_only", includedNames: ["Austin, Texas"] },
        age: { mode: "manual", min: 25, max: 55 },
        audience: { interestNames: ["Wellness"], rationale: "Adults near the clinic." },
      },
    },
    draftId: "90d1d2bb-466c-4889-9af2-edb533e82531",
    draftVersion: 2,
    connection: { generation: 1, canCreatePaused: true, selected: {
      metaBusinessId: null, adAccountId: "act_1", accountName: "Account", pageId: "page_1", pageName: "Page", currency: "INR", timezoneName: "Asia/Kolkata",
    } },
    creatives: [{ id: creativeId, businessId, approved: true, imageUrl: "https://example.com/ad.png", headline: "New-Patient Exam" }],
    form: { id: "form-1", businessId, active: true },
    whatsappNumber: "+919876543210",
    website: "https://cedarridgechiro.com",
    geo: { resolvedAreaLabel: "Austin, Texas", unresolvedNames: [], explicitlyNationwide: false, audienceInterests: [{ id: "6840321905207", name: "Wellness" }] },
    hash: () => "a".repeat(64),
  };
}

const cases: [string, (value: PreflightInput) => void][] = [
  ["REVIEW_NO_META_CONNECTION", (v) => { v.connection = null; }],
  ["REVIEW_CURRENCY", (v) => { v.connection!.selected!.currency = "USD"; }],
  ["REVIEW_META_ACCESS", (v) => { v.connection!.canCreatePaused = false; }],
  ["REVIEW_CREATIVES", (v) => { v.creatives[0].approved = false; }],
  ["REVIEW_WHATSAPP_NOT_LINKED", (v) => { v.draft.destination = "whatsapp"; v.whatsappNumber = null; }],
  ["REVIEW_NO_LEAD_FORM", (v) => { v.form = null; }],
  ["REVIEW_NO_WEBSITE", (v) => { v.website = null; }],
  ["REVIEW_BUDGET", (v) => { v.draft.dailyBudgetRupees = 0; }],
  ["REVIEW_NO_AGE_RANGE", (v) => { v.draft.targeting.age = { mode: "ai" }; }],
  ["REVIEW_RADIUS", (v) => { v.draft.targeting.location = { mode: "ai", includedNames: ["Austin, Texas"], radiusKm: 5 }; }],
  ["REVIEW_CITY_RADIUS", (v) => { v.geo.location = { cities: [{ key: "1", radius: 10, distance_unit: "kilometer" }] } as never; }],
  ["REVIEW_AREAS_UNRESOLVED", (v) => { v.geo.unresolvedNames = ["Atlantis"]; }],
  ["REVIEW_NO_AUDIENCE", (v) => { v.draft.targeting.audience = undefined; }],
  ["REVIEW_INTERESTS_UNRESOLVED", (v) => { v.geo.unresolvedInterests = ["Wellness"]; }],
  ["REVIEW_AD_POLICY", (v) => { v.vertical = "chiropractic clinic"; v.creatives[0].headline = "Cures back pain"; }],
];

describe("Review blockers carry their own reason (#688)", () => {
  it("a complete draft has no blockers", () => {
    expect(runPreflight(input()).blockers).toEqual([]);
  });

  it.each(cases)("%s", (reason, change) => {
    const value = input();
    change(value);
    const { blockers } = runPreflight(value);
    expect(blockers.map((item) => item.reason)).toEqual([reason]);
    // The fix in plain words: no internal jargon such as "explicit", "resolve" or "preparation".
    expect(blockers[0].message).not.toMatch(/\b(explicit|resolve|preparation|unexpectedly)\b/i);
  });

  // #1799 (Analyst): Meta's INR minimum is ₹95.46 a day per ad set; under ₹96 Review says so instead of Meta refusing.
  it("refuses a daily budget under Meta's ₹96 minimum, and accepts ₹96", () => {
    const low = input();
    low.draft.dailyBudgetRupees = 95;
    expect(runPreflight(low).blockers).toMatchObject([{ reason: "REVIEW_BUDGET", message: "Meta needs at least ₹96 a day. Set a daily budget of ₹96 or more." }]);
    const floor = input();
    floor.draft.dailyBudgetRupees = 96;
    expect(runPreflight(floor).blockers).toEqual([]);
  });

  // #681: the ads blocker names the ad and the one thing to do, not one sentence for every fault.
  it.each([
    ["no ads chosen", (v: PreflightInput) => { v.draft.creativeIds = []; v.creatives = []; }, "Choose at least one ad to send to Meta."],
    ["a chosen ad was deleted", (v: PreflightInput) => { v.creatives = []; }, "One of the ads you chose isn't available any more. Choose your ads again."],
    ["an ad from another business", (v: PreflightInput) => { v.creatives[0].businessId = "11111111-1111-4111-8111-111111111111"; }, "One of the ads you chose isn't available any more. Choose your ads again."],
    ["not approved", (v: PreflightInput) => { v.creatives[0].approved = false; }, 'The ad "New-Patient Exam" isn\'t approved yet. Approve it on the Review page, or take it out of this campaign.'],
    ["no picture", (v: PreflightInput) => { v.creatives[0].imageUrl = null; }, 'The ad "New-Patient Exam" has no picture yet. Take it out of this campaign and choose another ad.'],
    ["no headline", (v: PreflightInput) => { v.creatives[0].headline = null; }, "An ad you chose has no headline. Take it out of this campaign and choose another ad."],
  ])("ads blocker: %s", (_name, change, message) => {
    const value = input();
    change(value);
    expect(runPreflight(value).blockers).toEqual([expect.objectContaining({ reason: "REVIEW_CREATIVES", message })]);
  });

  it("ads blocker: counts the other ads that need fixing and shortens a long headline", () => {
    const value = input();
    const second = "0b3c8f7e-3c0e-4f7a-9a51-6d2f1c0e9b11";
    value.draft.creativeIds = [creativeId, second];
    value.creatives = [
      { ...value.creatives[0], approved: false, headline: "Same-day sciatica relief with a 45-minute adjustment" },
      { ...value.creatives[0], id: second, approved: false },
    ];
    expect(runPreflight(value).blockers[0].message).toBe('The ad "Same-day sciatica relief with a…" isn\'t approved yet. Approve it on the Review page, or take it out of this campaign. 1 more ad needs fixing too.');
  });

  // QA on #2191: a Hindi headline is 48 UTF-16 units but 24 letters, so it fits whole instead of losing half a conjunct.
  it("ads blocker: counts a Hindi headline in letters, not code units", () => {
    const value = input();
    value.creatives[0].approved = false;
    value.creatives[0].headline = "नमस्तेनमस्तेनमस्तेनमस्तेनमस्तेनमस्तेनमस्तेनमस्ते";
    expect(runPreflight(value).blockers[0].message).toBe('The ad "नमस्तेनमस्तेनमस्तेनमस्तेनमस्तेनमस्तेनमस्तेनमस्ते" isn\'t approved yet. Approve it on the Review page, or take it out of this campaign.');
  });

  it("the reasons are distinct and fit the campaign.review event", () => {
    const reasons = cases.map(([reason]) => reason);
    expect(new Set(reasons).size).toBe(reasons.length);
    expect(productEventSchema.shape.attributes.safeParse({ blockerCodes: reasons }).data?.blockerCodes).toEqual(reasons);
  });
});
