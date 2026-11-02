import { describe, expect, it } from "vitest";
import { runPreflight } from "@/lib/campaign/preflight";
import { REVIEW_WARNINGS } from "@/lib/campaign/plan-check";

// Production launch for Cedar Ridge (no website) on Oct 21, operation d88f0502: Meta
// created the campaign and ad set, then rejected the ad because a lead ad linked to
// facebook.com ("Lead generation ads must link to external content, such as the
// advertiser's website"). The launch was left needing reconciliation.
const businessId = "816aaafb-7ebc-4ad7-bbda-001beff172f8";
const creativeId = "e3d165a9-bbf8-47f7-8c61-e69dbb8ee3d1";
const draft = {
  businessId, name: "TEST AdBrain core loop - delete", goal: "Book new-patient exams", mode: "manual" as const,
  creativeIds: [creativeId], dailyBudgetRupees: 200, leadFormId: "1732372914636573", abTest: false,
  targeting: {
    location: { mode: "ai" as const, cityScope: "city_only" as const, includedNames: ["Austin, Texas"] },
    age: { mode: "manual" as const, min: 25, max: 55 },
    audience: { interestNames: ["Wellness"], rationale: "Adults near the clinic." },
  },
};

function review(website: string | null | undefined, destination: "instant_form" | "whatsapp" = "instant_form",
  extra: { storyReady?: boolean; costPerResultRupees?: number | null; dailyBudgetRupees?: number } = {}) {
  return runPreflight({
    draft: { ...draft, destination, ...(extra.dailyBudgetRupees ? { dailyBudgetRupees: extra.dailyBudgetRupees } : {}) },
    draftId: "90d1d2bb-466c-4889-9af2-edb533e82531",
    draftVersion: 2,
    connection: { generation: 1, canCreatePaused: true, selected: {
      metaBusinessId: null, adAccountId: "act_9000000000000001", accountName: "Solaride 101",
      pageId: "900000000000002", pageName: "Solaride Energy", currency: "INR", timezoneName: "Asia/Kolkata",
    } },
    creatives: [{ id: creativeId, businessId, approved: true, imageUrl: "https://example.com/ad.png", headline: "New-Patient Exam with Posture Scan", storyReady: extra.storyReady }],
    costPerResultRupees: extra.costPerResultRupees,
    form: { id: "1732372914636573", businessId, active: true },
    whatsappNumber: "+919876543210",
    website,
    geo: { resolvedAreaLabel: "Austin, Texas", unresolvedNames: [], explicitlyNationwide: false, audienceInterests: [{ id: "6840321905207", name: "Wellness" }] },
    hash: () => "a".repeat(64),
  });
}

describe("core: launch preflight", () => {
  it.each([null, "", "https://facebook.com", "https://www.facebook.com/cedarridge", "not a url"])(
    "blocks an instant-form launch before Meta when the website is %j", (website) => {
      const result = review(website);
      expect(result.canCreatePaused).toBe(false);
      expect(result.planHash).toBeNull();
      expect(result.blockers.map((item) => item.message).join(" ")).toMatch(/website/);
      expect(result.blockers.find((item) => /website/.test(item.message))?.action).toEqual({ kind: "open_brand" });
    });

  it("allows the launch with the business's own website", () => {
    expect(review("https://cedarridgechiro.com").canCreatePaused).toBe(true);
  });

  // #470: Brand Brain stored "vanshul.com" as typed, and Prepare said no website was set.
  it.each(["vanshul.com", "www.cedarridgechiro.com", "cedarridgechiro.com/new-patients"])(
    "allows the launch when the Brand's website was saved as a bare domain: %j", (website) => {
      const result = review(website);
      expect(result.blockers).toEqual([]);
      expect(result.canCreatePaused).toBe(true);
    });

  it("still blocks a bare Facebook or WhatsApp address", () => {
    for (const website of ["facebook.com/cedarridge", "wa.me/919876543210"]) expect(review(website).canCreatePaused, website).toBe(false);
  });

  it("does not require a website for WhatsApp campaigns", () => {
    expect(review(null, "whatsapp").canCreatePaused).toBe(true);
  });

  // #419 item 2(b), CTO Oct 25: warnings on Review, never a blocker or a change to the reviewed plan.
  it("warns about a missing 9:16 and a budget below Meta's learning threshold without blocking or changing the plan", () => {
    const plain = review(null, "whatsapp", { storyReady: true, costPerResultRupees: 10 });
    expect(plain).not.toHaveProperty("planWarnings");
    const warned = review(null, "whatsapp", { storyReady: false, costPerResultRupees: 69, dailyBudgetRupees: 200 });
    expect(warned.planWarnings).toEqual([REVIEW_WARNINGS.story, REVIEW_WARNINGS.budget]);
    expect(warned.canCreatePaused).toBe(true);
    expect(warned.blockers).toEqual([]);
    expect(warned.planHash).toBe(review(null, "whatsapp", { storyReady: true, costPerResultRupees: 10, dailyBudgetRupees: 200 }).planHash);
    expect(review("https://cedarridgechiro.com").planWarnings).toEqual([REVIEW_WARNINGS.story]);
  });
});


// #739: Review never read the ad wording, so an owner could edit an approved ad to "Cures back pain,
// guaranteed" and send it to Meta. Cedar Ridge's vertical and an approved ad as saved in production (Oct 26).
describe("core: Review checks the saved ad wording (#739)", () => {
  const savedAd = {
    headline: "Posture care for long desk days, Austin",
    primaryText: "Long hours seated can wear on posture over time. At Cedar Ridge Chiropractic in Austin, new patients start with a digital posture scan, then a board-certified chiropractor reviews the results with you and talks through your options. The $49 new-patient exam and consultation is a set price, and same-day appointments are available. Book an appointment or call the clinic.",
    description: null as string | null,
  };
  function reviewCopy(copy: Partial<typeof savedAd>, vertical: string | null = "chiropractic clinic") {
    return runPreflight({
      draft: { ...draft, destination: "instant_form" },
      draftId: "90d1d2bb-466c-4889-9af2-edb533e82531",
      draftVersion: 2,
      connection: { generation: 1, canCreatePaused: true, selected: {
        metaBusinessId: null, adAccountId: "act_9000000000000001", accountName: "Solaride 101",
        pageId: "900000000000002", pageName: "Solaride Energy", currency: "INR", timezoneName: "Asia/Kolkata",
      } },
      creatives: [{ id: creativeId, businessId, approved: true, imageUrl: "https://example.com/ad.png", ...savedAd, ...copy }],
      form: { id: "1732372914636573", businessId, active: true },
      website: "https://cedarridgechiro.com",
      vertical,
      geo: { resolvedAreaLabel: "Austin, Texas", unresolvedNames: [], explicitlyNationwide: false, audienceInterests: [{ id: "6840321905207", name: "Wellness" }] },
      hash: () => "a".repeat(64),
    });
  }

  it("passes the clinic's real saved ad", () => {
    expect(reviewCopy({}).blockers).toEqual([]);
  });

  it("blocks a clinic ad edited to promise a cure, naming the word and the ad", () => {
    const result = reviewCopy({ headline: "Cures back pain, guaranteed" });
    expect(result.canCreatePaused).toBe(false);
    expect(result.blockers.map((item) => item.reason)).toEqual(["REVIEW_AD_POLICY"]);
    expect(result.blockers[0].message).toMatch(/"cures".*"Cures back pain, guaranteed"/i);
    expect(result.blockers[0].message).toMatch(/Edit the ad/);
  });

  it.each([
    ["primaryText", "Our adjustments heal your spine in one visit."],
    ["description", "Pain-free in a week"],
  ] as const)("checks the %s too", (field, text) => {
    expect(reviewCopy({ [field]: text }).blockers.map((item) => item.reason)).toEqual(["REVIEW_AD_POLICY"]);
  });

  it("doesn't read 'secure' or 'healthy' as a health promise", () => {
    expect(reviewCopy({ headline: "Secure your $49 first visit for a healthy back" }).blockers).toEqual([]);
  });

  it("doesn't hold a non-health business to the clinic rules", () => {
    expect(reviewCopy({ headline: "Cures for a high power bill" }, "solar energy").blockers).toEqual([]);
  });

  it("blocks a solar ad promising guaranteed savings as a promise, not a health claim (#2423)", () => {
    const result = reviewCopy({ headline: "Guaranteed savings on your power bill" }, "solar energy");
    expect(result.blockers.map((item) => item.reason)).toEqual(["REVIEW_AD_POLICY"]);
    expect(result.blockers[0].message).toBe('"guaranteed saving" in the ad "Guaranteed savings on your power bill" is a promise Meta rejects. Edit the ad to describe the service instead.');
  });
});
