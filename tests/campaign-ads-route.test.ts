import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// #783: GET /api/campaigns/[id]/ads reads stored per-ad rows through RLS; off until AD_RESULTS_ENABLED.
const state = vi.hoisted(() => ({ user: { id: "u1" } as { id: string } | null, campaign: { id: "c1", destination: "whatsapp" } as Record<string, unknown> | null, rows: [] as unknown[], filters: [] as string[] }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { state.filters.push(`${table}.${key}=${value}`); return query; },
        is: (key: string, value: unknown) => { state.filters.push(`${table}.${key} is ${value}`); return query; },
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
  Object.assign(state, { user: { id: "u1" }, campaign: { id: "c1", destination: "whatsapp" }, rows: [], filters: [] });
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
    expect(body).toEqual({ ok: true, syncedAt: "2026-10-26T17:00:00.000Z", ads: [{ adId: "1", name: "Lower bills", delivered: true, replaced: false, best: false, impressions: 900, results: 1, spend: 70.3, costPerResult: 70.3 }] });
    expect(state.filters).toEqual(expect.arrayContaining(["ad_results.campaign_id=c1", "ad_results.period_start is null", "ad_results.period_end is null"]));
  });
});
