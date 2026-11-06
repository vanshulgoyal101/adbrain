import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { runPreflight, type PreflightInput } from "@/lib/campaign/preflight";

// The saved clinic ad is the recorded production copy in campaign-preflight.test.ts; these are synthetic IDs.
const businessId = "11111111-1111-4111-8111-111111111111";
const creativeId = "22222222-2222-4222-8222-222222222222";
const clinicAd = {
  id: creativeId, businessId, approved: true, imageUrl: "https://example.com/ad.png", ownMedia: true, ownWords: true,
  headline: "Posture care for long desk days, Austin",
  primaryText: "Long hours seated can wear on posture over time. At Cedar Ridge Chiropractic in Austin, new patients start with a digital posture scan, then a board-certified chiropractor reviews the results with you and talks through your options. The $49 new-patient exam and consultation is a set price, and same-day appointments are available. Book an appointment or call the clinic.",
  description: null,
};

function review(options: {
  ad?: Partial<typeof clinicAd>;
  facts?: string[];
  vertical?: string;
} = {}) {
  const ad = { ...clinicAd, ...options.ad };
  const input: PreflightInput = {
    draft: {
      businessId, name: "Clinic", goal: "Book exams", mode: "manual", creativeIds: [creativeId],
      dailyBudgetRupees: 200, leadFormId: "form-1", abTest: false, destination: "instant_form",
      targeting: {
        location: { mode: "ai", cityScope: "city_only", includedNames: ["Austin, Texas"] },
        age: { mode: "manual", min: 25, max: 55 },
        audience: { interestNames: ["Wellness"], rationale: "Adults near the clinic." },
      },
    },
    draftId: "33333333-3333-4333-8333-333333333333", draftVersion: 1,
    connection: {
      generation: 1, canCreatePaused: true,
      selected: { metaBusinessId: null, adAccountId: "act_test", accountName: "Test", pageId: "page", pageName: "Test", currency: "INR", timezoneName: "Asia/Kolkata" },
    },
    creatives: [ad], form: { id: "form-1", businessId, active: true },
    website: "https://example.com", vertical: options.vertical ?? "chiropractic clinic",
    brandFacts: options.facts ?? ["Cedar Ridge Chiropractic", "$49 new-patient exam and consultation", "same-day appointments"],
    mediaConsent: true,
    geo: { resolvedAreaLabel: "Austin, Texas", unresolvedNames: [], explicitlyNationwide: false, audienceInterests: [{ id: "1", name: "Wellness" }] },
    hash: (value) => createHash("sha256").update(value).digest("hex"),
  };
  return runPreflight(input);
}

describe("owner-written ad launch safety (#780)", () => {
  it("rechecks a saved commercial claim against current Brand facts", () => {
    expect(review().canCreatePaused).toBe(true);
    const changed = review({ facts: ["Cedar Ridge Chiropractic", "same-day appointments"] });
    expect(changed.canCreatePaused).toBe(false);
    expect(changed.planHash).toBeNull();
    expect(changed.blockers.map((item) => item.reason)).toContain("REVIEW_AD_POLICY");
  });

  it("blocks personal-attribute wording even when it contains no banned term", () => {
    const result = review({ ad: { headline: "Care for your smile", primaryText: "Do you have toothache?" }, vertical: "dental clinic" });
    expect(result.canCreatePaused).toBe(false);
    expect(result.blockers.map((item) => item.reason)).toContain("REVIEW_AD_POLICY");
  });

  it("does not apply the new owner-written rule to existing non-owner-written ads", () => {
    const result = review({ ad: { ownWords: false }, facts: ["Cedar Ridge Chiropractic"] });
    expect(result.canCreatePaused).toBe(true);
  });
});
