import { describe, expect, it } from "vitest";
import { runPreflight, type PreflightInput } from "@/lib/campaign/preflight";

// QA (#714): on the 390 px Review walk (production 0966d3d+, demo Cedar Ridge, Oct 26) an unknown place
// typed in Planned areas and an unknown interest each blocked Review with "Meta didn't recognise some
// of your areas/audience interests", without saying which. The field to fix sits ~3,000-4,000 px
// below the message on a phone, so the owner has to find the bad line by guessing. Preflight already
// has the names (geo.unresolvedNames / geo.unresolvedInterests); the message must name them.
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

const only = (value: PreflightInput) => {
  const { blockers } = runPreflight(value);
  expect(blockers).toHaveLength(1);
  return blockers[0];
};

describe("Review names what Meta didn't recognise (QA, #714)", () => {
  it("an unrecognised area is named in the blocker", () => {
    const value = input();
    value.geo.unresolvedNames = ["Zzqx Nowhereville"];
    const blocker = only(value);
    expect(blocker.reason).toBe("REVIEW_AREAS_UNRESOLVED");
    expect(blocker.message).toContain("Zzqx Nowhereville");
  });

  it("an unrecognised interest is named in the blocker", () => {
    const value = input();
    value.draft.targeting.audience = { interestNames: ["Wellness", "Zzqx Imaginary Hobby"], rationale: "Adults near the clinic." };
    value.geo.unresolvedInterests = ["Zzqx Imaginary Hobby"];
    const blocker = only(value);
    expect(blocker.reason).toBe("REVIEW_INTERESTS_UNRESOLVED");
    expect(blocker.message).toContain("Zzqx Imaginary Hobby");
  });

  it("several unrecognised areas are all named", () => {
    const value = input();
    value.geo.unresolvedNames = ["Atlantis", "Zzqx Nowhereville"];
    const { message } = only(value);
    expect(message).toContain("Atlantis");
    expect(message).toContain("Zzqx Nowhereville");
  });
});
