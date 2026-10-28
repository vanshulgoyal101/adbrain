import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// #1138: a Meta campaign held by two AdBrain businesses (rows from before #1062, concurrent syncs, a sync during a
// launch) belongs to one of them (#1057's rule). Every route that writes to Meta refuses the other business's row
// before any Meta call; deleting that row removes only the AdBrain copy, never the owner's Meta campaign.
type Row = Record<string, unknown>;

const store = vi.hoisted(() => {
  const state = { tables: {} as Record<string, Row[]>, user: null as { id: string } | null };
  function from(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let remove = false;
    const settle = () => {
      const rows = state.tables[table] ??= [];
      const matched = rows.filter(row => filters.every(test => test(row)));
      if (remove) state.tables[table] = rows.filter(row => !matched.includes(row));
      return { data: matched.map(row => ({ ...row })), error: null };
    };
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; },
      in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return query; },
      order: () => query, limit: () => query,
      insert: async () => ({ data: null, error: null }),
      delete: () => { remove = true; return query; },
      maybeSingle: async () => ({ data: settle().data[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(settle).then(resolve, reject),
    };
    return query;
  }
  return { state, client: () => ({ auth: { getUser: async () => ({ data: { user: state.user }, error: null }) }, from }) };
});
const meta = vi.hoisted(() => ({ calls: 0, deleted: [] as string[] }));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => store.client() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => store.client() }));
vi.mock("@/lib/audit", () => ({ logEvent: async () => undefined }));
vi.mock("@/lib/meta/connection-access", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/meta/connection-access")>(),
  requireOwnedBusiness: async (businessId: string) => ({ businessId, userId: OWNER }),
  withMetaConnection: async () => { meta.calls++; throw new Error("Meta call on a duplicate row."); },
}));
vi.mock("@/lib/campaign/trusted-write", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/campaign/trusted-write")>(),
  deleteVerifiedCampaign: async (_context: unknown, id: string) => {
    meta.deleted.push(id);
    store.state.tables.campaigns = store.state.tables.campaigns.filter(row => row.id !== id);
    return { error: null };
  },
}));

const OWNER = "00000000-0000-4000-8000-000000000001";
const OWNING = "00000000-0000-4000-8000-000000001138", DEMO = "00000000-0000-4000-8000-000000002138";
const LAUNCHED = "00000000-0000-4000-8000-00000000a138", DUPLICATE = "00000000-0000-4000-8000-00000000b138";
const META_CAMPAIGN = "120253730000000526";
const binding = { meta_ad_account_id: "act_9000000000000001", meta_page_id: "900000000000002", meta_connection_generation: 3, meta_campaign_id: META_CAMPAIGN };

function call(path: string, method: string, body?: unknown) {
  return new Request(`https://adbrain.test${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
}

beforeEach(() => {
  vi.stubEnv("AD_RESULTS_ENABLED", "true");
  meta.calls = 0;
  meta.deleted = [];
  store.state.user = { id: OWNER };
  store.state.tables = {
    campaigns: [
      // The demo business imported the campaign *before* the owning business launched it (case 3), and its row
      // is older, so only the launch marks ownership.
      { id: DUPLICATE, business_id: DEMO, status: "active", created_at: "2026-10-01T00:00:00Z", raw: { source: "sync" }, ...binding },
      { id: LAUNCHED, business_id: OWNING, status: "active", created_at: "2026-10-02T00:00:00Z", raw: { source: "campaign_operation" }, ...binding },
    ],
  };
});
afterEach(() => vi.unstubAllEnvs());

describe("#1138: a duplicate row of another business's Meta campaign", () => {
  const params = (id: string) => ({ params: Promise.resolve({ id }) });
  const adParams = (id: string, adId: string) => ({ params: Promise.resolve({ id, adId }) });
  const key = "owner-1138-key";

  it.each([
    ["pause", async () => (await import("@/app/api/campaigns/[id]/route")).PATCH(call(`/api/campaigns/${DUPLICATE}`, "PATCH", { status: "paused" }), params(DUPLICATE))],
    ["refresh", async () => (await import("@/app/api/campaigns/[id]/refresh/route")).POST(call(`/api/campaigns/${DUPLICATE}/refresh`, "POST"), params(DUPLICATE))],
    ["audience", async () => (await import("@/app/api/campaigns/[id]/audience/route")).POST(call(`/api/campaigns/${DUPLICATE}/audience`, "POST", { change: { gender: "women" }, idempotencyKey: key }), params(DUPLICATE))],
    ["switch", async () => (await import("@/app/api/campaigns/[id]/audience/switch/route")).POST(call(`/api/campaigns/${DUPLICATE}/audience/switch`, "POST", { operationId: "00000000-0000-4000-8000-000000000765", action: "switch" }), params(DUPLICATE))],
    ["budget", async () => (await import("@/app/api/campaigns/[id]/budget/route")).POST(call(`/api/campaigns/${DUPLICATE}/budget`, "POST", { change: { dailyRupees: 500 }, idempotencyKey: key }), params(DUPLICATE))],
    ["ad copy", async () => (await import("@/app/api/campaigns/[id]/ads/[adId]/route")).PATCH(call(`/api/campaigns/${DUPLICATE}/ads/120253730000000999`, "PATCH", { change: { headline: "New" }, idempotencyKey: key }), adParams(DUPLICATE, "120253730000000999"))],
    ["ad pause", async () => (await import("@/app/api/campaigns/[id]/ads/[adId]/status/route")).POST(call(`/api/campaigns/${DUPLICATE}/ads/120253730000000999/status`, "POST", { action: "pause" }), adParams(DUPLICATE, "120253730000000999"))],
  ])("refuses %s before any Meta call", async (_name, run) => {
    const response = await run();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/belongs to another of your AdBrain businesses/);
    expect(meta.calls).toBe(0);
  });

  it("delete removes only the AdBrain copy and leaves the owner's Meta campaign alone", async () => {
    const { DELETE } = await import("@/app/api/campaigns/[id]/route");
    const response = await DELETE(call(`/api/campaigns/${DUPLICATE}`, "DELETE"), params(DUPLICATE));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, metaDeleted: false });
    expect(meta.calls).toBe(0);
    expect(meta.deleted).toEqual([DUPLICATE]);
    expect(store.state.tables.campaigns.map(row => row.id)).toEqual([LAUNCHED]);
  });

  it("the owning business's own row still reaches Meta", async () => {
    const { PATCH } = await import("@/app/api/campaigns/[id]/route");
    await PATCH(call(`/api/campaigns/${LAUNCHED}`, "PATCH", { status: "paused" }), params(LAUNCHED));
    expect(meta.calls).toBeGreaterThan(0);
  });

  it("fails closed when ownership can't be read", async () => {
    const { campaignOwnedElsewhere, ownerRefusal } = await import("@/lib/campaign/campaign-owner");
    store.state.tables.campaigns = [];
    await expect(campaignOwnedElsewhere(DEMO, META_CAMPAIGN)).resolves.toBe(false);
    const broken = vi.spyOn(store, "client").mockReturnValueOnce({ ...store.client(), from: () => ({ select: () => ({ eq: async () => ({ data: null, error: { message: "down" } }) }) }) } as never);
    expect((await ownerRefusal(DEMO, META_CAMPAIGN))?.status).toBe(503);
    broken.mockRestore();
  });
});
