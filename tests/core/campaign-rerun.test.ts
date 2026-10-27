import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bestCreativeId, rerunPrefill } from "@/lib/campaign/rerun";
import type { DraftInput } from "@/lib/campaign/connect-contracts";
import type { StoredAdResult } from "@/lib/campaign/ad-results-store";

// #1050 "Run this again": a campaign that worked is copied into New campaign, Best ad first. Nothing is
// created and nothing goes to Meta; the owner still reviews and sends it paused.
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const draft: DraftInput = {
  businessId: "44444444-4444-4444-8444-444444444444", name: "Solaride — leads", goal: "Free site surveys in Mohali",
  mode: "manual", creativeIds: [A, B, C], dailyBudgetRupees: 300, leadFormId: null, destination: "whatsapp",
  whatsappLanguage: "hinglish", whatsappMessage: { greeting: "Namaste!", opening: { kind: "prefill", prefill: "Free site survey", callButton: false }, language: "hinglish" },
  targeting: { location: { includedNames: ["Mohali", "Panchkula"], excludedNames: ["Shimla"] } } as DraftInput["targeting"], abTest: false,
};
const campaign = { name: "Solaride — leads", creative_ids: [A, B, C], daily_budget: 300, destination: "whatsapp" };
const row = (id: string, conversations: number, spendRupees: number): StoredAdResult => ({
  meta_ad_id: id, ad_name: `Ad ${id}`, effective_status: "ACTIVE", delivered: true, impressions: 1000, link_clicks: 20,
  conversations, leads: 0, spend_paise: spendRupees * 100, synced_at: "2026-10-27T10:00:00.000Z",
});

describe("core: Run this again (#1050)", () => {
  it("copies the launch draft (destination, WhatsApp message, areas, exclusions, budget) with the Best ad first", () => {
    const prefill = rerunPrefill({ campaign, draft, approvedIds: [A, B, C], bestCreativeId: C });
    expect(prefill).toEqual({
      name: "Solaride — leads (again)", goal: "Free site surveys in Mohali", creativeIds: [C, A, B], dailyBudgetRupees: 300,
      destination: "whatsapp", leadFormId: null, whatsappNumber: undefined, whatsappLanguage: "hinglish",
      whatsappMessage: draft.whatsappMessage, targeting: draft.targeting, abTest: false, dropped: 0, source: "draft",
    });
    // A copy of a copy doesn't pile up "(again)".
    expect(rerunPrefill({ campaign, draft: { ...draft, name: "Solaride — leads (again)" }, approvedIds: [A], bestCreativeId: null })).toMatchObject({ name: "Solaride — leads (again)" });
    expect(rerunPrefill({ campaign, draft: { ...draft, name: "x".repeat(120) }, approvedIds: [A], bestCreativeId: null })).toMatchObject({ name: expect.stringMatching(/^x{112} \(again\)$/) });
  });

  it("leaves out ads that are no longer approved, and says how many", () => {
    expect(rerunPrefill({ campaign, draft, approvedIds: [A, C], bestCreativeId: B })).toMatchObject({ creativeIds: [A, C], dropped: 1 });
    expect(rerunPrefill({ campaign, draft, approvedIds: [], bestCreativeId: A })).toEqual({ error: expect.stringMatching(/None of this campaign's ads is approved anymore/) });
    expect(rerunPrefill({ campaign: { ...campaign, creative_ids: [] }, draft: null, approvedIds: [], bestCreativeId: null })).toEqual({ error: expect.stringMatching(/no AdBrain ads to copy/) });
  });

  it("an ended or synced campaign without its draft falls back to its own ads, budget and destination", () => {
    expect(rerunPrefill({ campaign: { name: null, creative_ids: [B, A], daily_budget: 450, destination: "instant_form" }, draft: null, approvedIds: [A, B], bestCreativeId: A }))
      .toEqual({ name: "Campaign (again)", goal: "", creativeIds: [A, B], dailyBudgetRupees: 450, destination: "instant_form", leadFormId: null, abTest: false, dropped: 0, source: "campaign" });
    expect(rerunPrefill({ campaign: { name: "Old", creative_ids: [A], daily_budget: null, destination: "mixed" }, draft: null, approvedIds: [A], bestCreativeId: null }))
      .toMatchObject({ dailyBudgetRupees: 300, destination: undefined });
  });

  it("finds the Best ad's creative through the launch's ad links (#783's rule: 5+ results, 30% cheaper)", () => {
    const rows = [row("901", 8, 400), row("902", 3, 450), row("903", 0, 120)];
    const links = [{ meta_ad_id: "901", creative_id: B }, { meta_ad_id: "902", creative_id: A }, { meta_ad_id: "903", creative_id: null }];
    expect(bestCreativeId(rows, links, true)).toBe(B);
    expect(bestCreativeId(rows, links, false)).toBeNull();
    expect(bestCreativeId(rows, [], true)).toBeNull();
  });
});

const state = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  tables: {} as Record<string, unknown>,
  filters: [] as string[],
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: (table: string) => {
      const result = () => ({ data: state.tables[table] ?? null, error: null });
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { state.filters.push(`${table}.${key}=${value}`); return query; },
        in: (key: string) => { state.filters.push(`${table}.${key} in`); return query; },
        is: () => query,
        order: () => query,
        limit: () => Object.assign(Promise.resolve(result()), query),
        maybeSingle: async () => result(),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return query;
    },
  }),
}));

const call = async () => {
  const { GET } = await import("@/app/api/campaigns/[id]/rerun/route");
  const response = await GET(new Request("http://localhost/api/campaigns/c1/rerun"), { params: Promise.resolve({ id: "c1" }) });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
};

beforeEach(() => {
  state.user = { id: "u1" };
  state.filters = [];
  state.tables = {
    campaigns: { id: "c1", business_id: "b1", ...campaign },
    campaign_operations: { draft_id: "d1" },
    campaign_drafts: { input: draft },
    creatives: [{ id: A }, { id: B }, { id: C }],
    ad_results: [row("901", 8, 400), row("902", 3, 450)],
    campaign_ads: [{ meta_ad_id: "901", creative_id: B }, { meta_ad_id: "902", creative_id: A }],
  };
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/campaigns/[id]/rerun (#1050)", () => {
  it("needs a session and the owner's own campaign", async () => {
    state.user = null;
    expect((await call()).status).toBe(401);
    state.user = { id: "u1" };
    state.tables.campaigns = null;
    expect((await call()).status).toBe(404);
  });

  it("returns the draft's prefill, Best first once per-ad results are on, reading only approved ads of this business", async () => {
    expect((await call()).body).toMatchObject({ ok: true, prefill: { creativeIds: [A, B, C], source: "draft", destination: "whatsapp" } });
    vi.stubEnv("AD_RESULTS_ENABLED", "true");
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body).toMatchObject({ prefill: { creativeIds: [B, A, C], name: "Solaride — leads (again)" } });
    expect(state.filters).toEqual(expect.arrayContaining(["campaign_operations.campaign_id=c1", "campaign_operations.state=succeeded", "campaign_drafts.id=d1", "creatives.business_id=b1", "creatives.status=approved"]));
  });

  it("falls back to the campaign row without a launch draft, and refuses when no ad is approved", async () => {
    state.tables.campaign_operations = null;
    expect((await call()).body).toMatchObject({ prefill: { source: "campaign", creativeIds: [A, B, C] } });
    state.tables.creatives = [];
    const { status, body } = await call();
    expect(status).toBe(409);
    expect(body).toMatchObject({ error: expect.stringMatching(/approved anymore/) });
  });
});
