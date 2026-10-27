import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// #783: GET /api/campaigns/[id]/ads reads stored per-ad rows through RLS; off until AD_RESULTS_ENABLED.
const state = vi.hoisted(() => ({ user: { id: "u1" } as { id: string } | null, campaign: { id: "c1", destination: "whatsapp" } as Record<string, unknown> | null, rows: [] as unknown[], creatives: [] as unknown[], filters: [] as string[] }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { state.filters.push(`${table}.${key}=${value}`); return query; },
        is: (key: string, value: unknown) => { state.filters.push(`${table}.${key} is ${value}`); return query; },
        in: async (key: string, values: unknown[]) => { state.filters.push(`${table}.${key} in ${values.join(",")}`); return { data: state.creatives, error: null }; },
        limit: async () => ({ data: state.rows, error: null }),
        maybeSingle: async () => ({ data: state.campaign, error: null }),
      };
      return query;
    },
  }),
}));

const call = async () => {
  const { GET } = await import("@/app/api/campaigns/[id]/ads/route");
  const response = await GET(new Request("http://localhost/api/campaigns/c1/ads"), { params: Promise.resolve({ id: "c1" }) });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
};

beforeEach(() => {
  Object.assign(state, { user: { id: "u1" }, campaign: { id: "c1", destination: "whatsapp" }, rows: [], creatives: [], filters: [] });
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/campaigns/[id]/ads (#783)", () => {
  it("is not found while the flag is off", async () => {
    expect((await call()).status).toBe(404);
  });

  it("needs a session, an own campaign, and returns the lifetime rows as the card's view", async () => {
    vi.stubEnv("AD_RESULTS_ENABLED", "true");
    state.user = null;
    expect((await call()).status).toBe(401);
    state.user = { id: "u1" };
    state.campaign = null;
    expect((await call()).status).toBe(404);
    state.campaign = { id: "c1", destination: "whatsapp" };
    state.rows = [{ meta_ad_id: "1", ad_name: "Lower bills", effective_status: "ACTIVE", delivered: true, impressions: 900, link_clicks: 9, conversations: 1, leads: 0, spend_paise: 7030, synced_at: "2026-10-26T17:00:00.000Z" }];
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, syncedAt: "2026-10-26T17:00:00.000Z", ads: [{ adId: "1", name: "Lower bills", delivered: true, replaced: false, best: false, creative: null, earlier: false, status: "ACTIVE", impressions: 900, results: 1, spend: 70.3, costPerResult: 70.3 }] });
    expect(state.filters).toEqual(expect.arrayContaining(["ad_results.campaign_id=c1", "ad_results.period_start is null", "ad_results.period_end is null"]));
  });

  // Designer on #783: an AdBrain-launched ad shows its creative's headline and picture, read through RLS.
  it("adds each linked ad's headline and picture", async () => {
    vi.stubEnv("AD_RESULTS_ENABLED", "true");
    state.campaign = {
      id: "c1", destination: "instant_form", creative_ids: ["cr1", "cr2"], meta_campaign_id: "9", meta_adset_id: "8", meta_ad_ids: ["1", "2"],
      raw: { source: "campaign_operation", metaResult: { campaignId: "9", adSetIds: ["8"], adIds: ["1", "2"] } },
    };
    state.rows = [{ meta_ad_id: "2", ad_name: "Meta name", effective_status: "ACTIVE", delivered: true, impressions: 10, link_clicks: 1, conversations: 0, leads: 1, spend_paise: 5000, synced_at: "2026-10-27T17:00:00.000Z" }];
    state.creatives = [{ id: "cr2", headline: "Rooftop solar, planned before install", image_url: "https://x/problem.png" }];
    const { status, body } = await call();
    expect(status).toBe(200);
    expect((body.ads as unknown[])[0]).toMatchObject({ adId: "2", name: "Meta name", creative: { headline: "Rooftop solar, planned before install", imageUrl: "https://x/problem.png" }, earlier: false });
    expect(state.filters).toContain("creatives.id in cr1,cr2");
  });
});
