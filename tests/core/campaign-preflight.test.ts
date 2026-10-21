import { describe, expect, it } from "vitest";
import { runPreflight } from "@/lib/campaign/preflight";

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

function review(website: string | null | undefined, destination: "instant_form" | "whatsapp" = "instant_form") {
  return runPreflight({
    draft: { ...draft, destination },
    draftId: "90d1d2bb-466c-4889-9af2-edb533e82531",
    draftVersion: 2,
    connection: { generation: 1, canCreatePaused: true, selected: {
      metaBusinessId: null, adAccountId: "act_2398686420592052", accountName: "Solaride 101",
      pageId: "885223068001054", pageName: "Solaride Energy", currency: "INR", timezoneName: "Asia/Kolkata",
    } },
    creatives: [{ id: creativeId, businessId, approved: true, imageUrl: "https://example.com/ad.png", headline: "New-Patient Exam with Posture Scan" }],
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
    });

  it("allows the launch with the business's own website", () => {
    expect(review("https://cedarridgechiro.com").canCreatePaused).toBe(true);
  });

  it("does not require a website for WhatsApp campaigns", () => {
    expect(review(null, "whatsapp").canCreatePaused).toBe(true);
  });
});
