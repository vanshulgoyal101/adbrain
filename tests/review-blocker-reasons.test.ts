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

  it("the reasons are distinct and fit the campaign.review event", () => {
    const reasons = cases.map(([reason]) => reason);
    expect(new Set(reasons).size).toBe(reasons.length);
    expect(productEventSchema.shape.attributes.safeParse({ blockerCodes: reasons }).data?.blockerCodes).toEqual(reasons);
  });
});
