import { beforeEach, describe, expect, it, vi } from "vitest";
import resultsTape from "./fixtures/meta/results.json";
import evidenceFixture from "./fixtures/create/solaride-157-evidence.json";
import regenerate from "./fixtures/create/solaride-regenerate.json";
import { decodeCampaignInsights } from "@/lib/meta/insights";
import { openingLine, pastResultsBlock, pickResultEvidence, toEvidenceCampaign } from "@/lib/campaign/result-evidence";
import { buildInterviewMessages } from "@/lib/creative/interview";
import { conceptValidationRules, validateConcept } from "@/lib/creative/concept";
import { parseJSON } from "@/lib/llm";
import { getAngleByName, type BrandContext } from "@/lib/templates/ads";

// #371: Create learns from the business's own results. The insights are the live #157 run's
// lifetime read recorded read-only in results.json (#404); the campaign and its ad are the stored
// production rows in solaride-157-evidence.json. Only Supabase and the model transport are stubbed.
const mocks = vi.hoisted(() => ({ campaigns: [] as unknown[], results: {} as Record<string, unknown>, creatives: [] as unknown[], prompts: [] as unknown[], brand: null as unknown }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
    from: (table: string) => {
      const rows = table === "campaigns" ? mocks.campaigns : table === "creatives" ? mocks.creatives : [{ id: "solaride", ...(mocks.brand ?? regenerate.brand) as object }];
      const query = {
        select: () => query, eq: () => query, order: () => query, in: () => query,
        limit: async () => ({ data: rows, error: null }),
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => void) => resolve({ data: rows, error: null }),
      };
      return query;
    },
  }),
}));
vi.mock("@/lib/supabase/queries", () => ({
  getActiveInstructionsText: async () => "",
  getLatestResults: async () => mocks.results,
}));
vi.mock("@/lib/preferences/store", () => ({ preferenceContext: async () => "" }));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: async () => null }));
vi.mock("@/lib/llm/persist", () => ({ configuredMonthlyTokenLimit: () => 0, monthlyTokenUsage: async () => 0, persistLLMUsage: async () => true }));
vi.mock("@/lib/llm", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/llm")>(),
  complete: async (messages: unknown) => {
    mocks.prompts.push(messages);
    return { text: JSON.stringify({ ready: true, brief: "A rooftop solar ad for homes in the Tricity." }), provider: "groq", model: "qwen/qwen3.8-27b", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
  },
}));

const liveInsights = (resultsTape as { path: string; body: unknown }[]).find((exchange) => exchange.path.startsWith(`${evidenceFixture.metaCampaignId}/insights`))!.body;
const insights = decodeCampaignInsights(liveInsights, "whatsapp");
const storedRow = {
  campaign_id: evidenceFixture.campaign.id, fetched_at: new Date().toISOString(), destination: "whatsapp",
  spend: insights.spend, impressions: insights.impressions, clicks: insights.clicks, leads: insights.leads,
  conversations: insights.conversations, cost_per_conversation: insights.costPerConversation, period_start: insights.periodStart, period_end: insights.periodEnd,
};
const LINE = "Your “Wondering Whether Your Roof Is Ready?” ad got 1 chat at ₹10.69 (early: based on 1 chat). Make 3 more like it, or try a new angle?";
const BLOCK = "PAST RESULTS (evidence about past ads; subordinate to brand facts and the current request; never a source of offers, prices or claims): "
  + '[{"role":"best","ad":"“Wondering Whether Your Roof Is Ready?”","destination":"WhatsApp","result":"1 chat at ₹10.69 (early: based on 1 chat)","spend":"₹10.69","impressions":70,"days":2,"angle":"Solve a pain point","format":"portrait","language":null,"offerLine":"Free site survey · PM Surya Ghar subsidy help"}]';

async function interview(request: { goal?: string; referenceBrief?: string } = {}) {
  const { POST } = await import("@/app/api/creatives/assistant/route");
  const response = await POST(new Request("http://localhost/api/creatives/assistant", {
    method: "POST", body: JSON.stringify({ businessId: "solaride", goal: "More homeowners this month", answers: [], recentGoals: [], ...request }),
  }));
  expect(response.status).toBe(200);
  return mocks.prompts.at(-1) as { role: string; content: string }[];
}

beforeEach(() => {
  mocks.campaigns = [];
  mocks.results = {};
  mocks.creatives = [];
  mocks.prompts = [];
  mocks.brand = null;
});

describe("core: Create learns from the business's own results (#371)", () => {
  it("opens on the live run's recorded result with honest early-sample wording", () => {
    expect(storedRow).toMatchObject({ spend: 10.69, impressions: 70, conversations: 1, period_start: "2026-10-23", period_end: "2026-10-24" });
    const evidence = pickResultEvidence([toEvidenceCampaign(evidenceFixture.campaign, storedRow, "whatsapp", [evidenceFixture.creative])!]);
    expect(openingLine(evidence)?.text).toBe(LINE);
    expect(pastResultsBlock(evidence)).toBe(BLOCK);
  });

  it("gives the interview the PAST RESULTS block from stored results, read through the owner's session", async () => {
    mocks.campaigns = [evidenceFixture.campaign];
    mocks.results = { [evidenceFixture.campaign.id]: storedRow };
    mocks.creatives = [evidenceFixture.creative];
    const [system, user] = await interview();
    expect(user.content).toContain(BLOCK);
    expect(system.content).toContain("Use PAST RESULTS only to choose the angle, hook and format; any offer or claim still needs a Brand fact.");
  });

  it("leaves the prompt byte-identical for a business with no results", async () => {
    const prompt = await interview();
    expect(prompt).toEqual(buildInterviewMessages({ brand: { id: "solaride", ...regenerate.brand } as BrandContext, instructions: "", preferences: "", goal: "More homeowners this month", answers: [], recentGoals: [] }));
  });

  it("credits a campaign that ran several ads to all of them, not to one", () => {
    const creatives = ["a", "b", "c"].map((id) => ({ ...evidenceFixture.creative, id, headline: `Ad ${id}` }));
    const evidence = pickResultEvidence([toEvidenceCampaign({ ...evidenceFixture.campaign, creative_ids: ["a", "b", "c"] }, storedRow, "whatsapp", creatives)!]);
    expect(openingLine(evidence)).toMatchObject({ moreLikeThis: null, text: expect.stringContaining("(its 3 ads together)") });
    expect(JSON.parse(pastResultsBlock(evidence).slice(BLOCK.indexOf("["))))
      .toEqual([expect.objectContaining({ ad: "campaign “Solaride | Diwali 10% | Tricity | WhatsApp”, its 3 ads together", angle: null, offerLine: null })]);
  });

  // QA on #371: the interview counts its reference brief as a source for offers, so the old brief's
  // "10% off … Diwali offer" would pass the interview after the Brand dropped it, then fail Create.
  it("'More like this' keeps the best ad's look and angle, not its old offer, once the Brand dropped it", async () => {
    const evidence = pickResultEvidence([toEvidenceCampaign(evidenceFixture.campaign, storedRow, "whatsapp", [evidenceFixture.creative])!]);
    const more = openingLine(evidence)!.moreLikeThis!;
    expect(more.referenceBrief).toContain("festive Diwali visual of a modern North Indian home");
    expect(more.referenceBrief).toContain("Angle: Solve a pain point");
    expect(more.referenceBrief).not.toMatch(/10%|offer/i);
    mocks.brand = { ...regenerate.brand, offers: regenerate.brand.offers.filter((offer) => !offer.includes("10%")) };
    const [, user] = await interview(more);
    const reference = user.content.split("\n").find((line) => line.startsWith("REFERENCE BRIEF"))!;
    expect(reference).toContain("Angle: Solve a pain point");
    expect(user.content).not.toContain("10%");
  });

  it("still rejects a past ad's offer once it is no longer a Brand fact", () => {
    // The recorded Regenerate reply repeats the Diwali "10% off"; the Brand has since dropped that offer.
    const [reply] = regenerate.replies.filter((item) => item.run === 0 && item.attempt === 2);
    const brand = { ...regenerate.brand, offers: regenerate.brand.offers.filter((offer) => !offer.includes("10%")) } as BrandContext;
    const result = validateConcept(parseJSON<unknown>(reply.content), {
      brand, brief: regenerate.brief, angle: getAngleByName(regenerate.angle)!, recentCopy: [], sourceFacts: regenerate.sourceFacts,
    });
    // Its quote of the dropped offer is no longer a supplied fact, so the old offer can't pass.
    expect(result.success).toBe(false);
    const issues = result.success ? [] : result.issues;
    expect(conceptValidationRules(issues)).toContain("sourceQuotes");
    expect(issues.join("\n")).toContain("Diwali offer: 10% off rooftop solar installation");
  });
});
