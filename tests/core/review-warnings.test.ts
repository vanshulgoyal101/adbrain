import { describe, expect, it, vi } from "vitest";
import resultsTape from "./fixtures/meta/results.json";
import launchTape from "./fixtures/meta/launch-validate.json";
import evidenceFixture from "./fixtures/create/solaride-157-evidence.json";
import { decodeCampaignInsights } from "@/lib/meta/insights";
import { REVIEW_WARNINGS } from "@/lib/campaign/plan-check";
import { runPreflight } from "@/lib/campaign/preflight";
import { hasStoryDesign } from "@/lib/creative/picture-words";

// #419 item 2(b), CTO Oct 25: Review warns, never blocks. The cost per chat is the live #157 run's
// lifetime read (results.json, recorded read-only, #404) stored for its campaign row
// (solaride-157-evidence.json), read back through the same store Create uses (#371). The plan is
// the launch gate's recorded WhatsApp campaign (launch-validate.json). Only Supabase is stubbed.
const mocks = vi.hoisted(() => ({ campaigns: [] as unknown[], results: {} as Record<string, unknown> }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const query = { select: () => query, eq: () => query, order: () => query, limit: async () => ({ data: mocks.campaigns, error: null }) };
      return query;
    },
  }),
}));
vi.mock("@/lib/supabase/queries", () => ({ getLatestResults: async () => mocks.results }));

const liveInsights = (resultsTape as { path: string; body: unknown }[]).find((exchange) => exchange.path.startsWith(`${evidenceFixture.metaCampaignId}/insights`))!.body;
const insights = decodeCampaignInsights(liveInsights, "whatsapp");
mocks.campaigns = [evidenceFixture.campaign];
mocks.results = { [evidenceFixture.campaign.id]: {
  campaign_id: evidenceFixture.campaign.id, fetched_at: new Date().toISOString(), destination: "whatsapp",
  spend: insights.spend, impressions: insights.impressions, leads: insights.leads, conversations: insights.conversations,
  period_start: insights.periodStart, period_end: insights.periodEnd,
} };

function review(dailyBudgetRupees: number, costPerResultRupees: number | null) {
  const businessId = "b1d2c3e4-0000-4000-8000-000000000157";
  return runPreflight({
    draft: { businessId, name: launchTape.inputs.name, goal: "WhatsApp chats", mode: "manual", destination: "whatsapp", creativeIds: [evidenceFixture.creative.id],
      dailyBudgetRupees, leadFormId: null, abTest: false, whatsappNumber: launchTape.inputs.phone,
      targeting: { location: { mode: "manual", cityScope: "city_only", includedNames: ["Chandigarh"] }, age: { mode: "manual", min: 25, max: 55 },
        audience: { interestNames: [], rationale: "Homeowners in the Tricity." } } },
    draftId: "5d0a4c2e-1b7f-4c3d-9e8f-0a1b2c3d4e5f", draftVersion: 1,
    connection: { generation: 1, canCreatePaused: true, selected: { metaBusinessId: null, adAccountId: "act_2398686420592052", accountName: "Solaride 101",
      pageId: "885223068001054", pageName: "Solaride Energy", currency: "INR", timezoneName: "Asia/Kolkata" } },
    creatives: [{ id: evidenceFixture.creative.id, businessId, approved: true, imageUrl: "https://example.com/ad.png", headline: evidenceFixture.creative.headline,
      storyReady: hasStoryDesign(evidenceFixture.creative.generation) }],
    form: null, whatsappNumber: launchTape.inputs.phone, geo: { resolvedAreaLabel: "Chandigarh", unresolvedNames: [], explicitlyNationwide: false },
    hash: () => "a".repeat(64), costPerResultRupees,
  });
}

describe("core: Review warns from Meta's new-advertiser guidance, never blocks (#419 2b)", () => {
  it("prices the business's chats from its own recorded #157 result", async () => {
    const { getCostPerResult } = await import("@/lib/campaign/result-evidence-store");
    expect(await getCostPerResult("solaride", "whatsapp")).toBeCloseTo(10.69, 2);
    expect(await getCostPerResult("solaride", "instant_form")).toBeNull();
  });

  it("on the recorded ₹280 WhatsApp plan, warns only that its ad has no 9:16; at ₹50 a day, also that Meta can't learn", async () => {
    const { getCostPerResult } = await import("@/lib/campaign/result-evidence-store");
    const cost = await getCostPerResult("solaride", "whatsapp");
    expect(launchTape.inputs.dailyBudgetRupees).toBe(280);
    const recorded = review(launchTape.inputs.dailyBudgetRupees, cost);
    expect(recorded.planWarnings).toEqual([REVIEW_WARNINGS.story]);
    // ₹50 a day at ₹10.69 a chat is about 32 chats a week, under Meta's ~50.
    const small = review(50, cost);
    expect(small.planWarnings).toEqual([REVIEW_WARNINGS.story, REVIEW_WARNINGS.budget]);
    for (const result of [recorded, small]) expect(result).toMatchObject({ canCreatePaused: true, blockers: [] });
  });
});
