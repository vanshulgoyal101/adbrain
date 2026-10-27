import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import resultsTape from "./fixtures/meta/results.json";

// Graph insights and ad review reads recorded read-only by scripts/record-meta-results-fixtures.ts
// from the live #157 run (120253678786150526; lifetime 70 impressions, ₹10.69, 1 chat on Oct 24) and a paused Solaride
// campaign (120253164673180526) (#258). The DISAPPROVED ad below is a synthetic edit of the
// recorded ads response; Solaride has no rejected ad to record.
type Exchange = { method: string; path: string; status: number; body: unknown };
type Row = Record<string, unknown> & { id: string; status: string; raw: Record<string, unknown> };

const SECRET = "cron-secret-value";
const creds = { adAccountId: "act_2398686420592052", pageId: "885223068001054", accessToken: "test-token" };
const live = "120253678786150526", paused = "120253164673180526";

const db = vi.hoisted(() => ({
  campaigns: [] as Row[],
  results: [] as Array<{ campaign_id: string; fetched_at: string; impressions?: number }>,
}));

vi.mock("@/lib/env", () => ({ getEnv: () => ({ CRON_SECRET: "cron-secret-value" }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const filters = new Map<string, unknown>();
      let after: string | null = null;
      const query = {
        select: () => query, order: () => query, limit: () => query,
        eq: (key: string, value: unknown) => { filters.set(key, value); return query; },
        gt: (_key: string, value: string) => { after = value; return query; },
        maybeSingle: async () => {
          const latest = db.results.filter(row => row.campaign_id === filters.get("campaign_id"))
            .sort((left, right) => right.fetched_at.localeCompare(left.fetched_at))[0];
          return { data: latest ?? null, error: null };
        },
        then: (resolve: (value: unknown) => unknown) => {
          expect(table).toBe("campaigns");
          return resolve({ data: db.campaigns.filter(row => row.status === filters.get("status") && (after === null || row.id > after)), error: null });
        },
      };
      return query;
    },
  }),
}));
vi.mock("@/lib/campaign/trusted-write", () => ({
  saveCampaignResult: async (_actor: unknown, values: { campaign_id: string; impressions: number }) => {
    db.results.push({ ...values, fetched_at: new Date().toISOString() });
    return { data: values, error: null };
  },
  saveCampaignHealth: async (_actor: unknown, id: string, health: unknown) => {
    const row = db.campaigns.find(campaign => campaign.id === id)!;
    row.raw = { ...row.raw, health };
    return { data: { id }, error: null };
  },
}));
vi.mock("@/lib/meta/connection-access", async () => {
  const { MetaClient } = await import("@/lib/meta/client");
  return {
    requireScheduledBusiness: async (id: string) => ({ businessId: id, userId: "owner-1" }),
    withMetaConnection: async (_context: unknown, options: { purpose: string }, execute: (meta: unknown) => unknown) => {
      expect(options.purpose).toBe("read_insights");
      return execute(new MetaClient(creds));
    },
  };
});

function replay(edit: (exchange: Exchange) => unknown = exchange => exchange.body) {
  const pending = [...resultsTape] as Exchange[];
  const sent: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    url.searchParams.delete("access_token");
    const call = `${init?.method ?? "GET"} ${url.pathname.replace("/v21.0/", "")}${url.search}`;
    sent.push(call);
    const index = pending.findIndex(exchange => `${exchange.method} ${exchange.path}` === call);
    if (index < 0) throw new Error(`Unrecorded Graph call: ${call}`);
    const [exchange] = pending.splice(index, 1);
    return Response.json(edit(exchange), { status: exchange.status });
  });
  return sent;
}

const run = async () => {
  const { GET } = await import("@/app/api/cron/refresh-results/route");
  const response = await GET(new Request("http://localhost/api/cron/refresh-results", { headers: { authorization: `Bearer ${SECRET}` } }));
  return { status: response.status, body: await response.json() as { refreshed: number; skipped: number; failed: number; alerts: Array<{ kind: string; key: string }> } };
};
const healthOf = (meta: string) => db.campaigns.find(row => row.meta_campaign_id === meta)!.raw.health as { activeSince: string; flags: Array<{ kind: string; reason: string; key: string }> };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-23T17:00:00Z"));
  db.results = [];
  db.campaigns = [{
    id: "00000000-0000-4000-8000-000000000157", business_id: "00000000-0000-4000-8000-0000000000b1", status: "active",
    meta_campaign_id: live, meta_adset_id: "120253678787370526", meta_ad_ids: ["120253678789370526", "120253678790440526"],
    meta_ad_account_id: creds.adAccountId, meta_page_id: creds.pageId, meta_connection_generation: 1,
    raw: {
      source: "campaign_operation",
      metaResult: { campaignId: live, adSetId: "120253678787370526", adSetIds: ["120253678787370526", "120253678789810526"], adIds: ["120253678789370526", "120253678790440526"], destination: "whatsapp" },
      cap: { adSetId: "120253678789810526", adIds: ["120253678790440526"], lifetimeBudgetPaise: 84000, endTime: "2026-10-26T14:24:16.000Z", days: 3 },
      cappedAdSetIds: ["120253678789810526"],
    },
  }, {
    id: "00000000-0000-4000-8000-000000000999", business_id: "00000000-0000-4000-8000-0000000000b1", status: "active",
    meta_campaign_id: paused, meta_adset_id: "120253164674160526", meta_ad_ids: ["120253164674630526"],
    meta_ad_account_id: creds.adAccountId, meta_page_id: creds.pageId, meta_connection_generation: 1,
    raw: { health: { checkedAt: "2026-10-23T16:00:00.000Z", activeSince: "2026-10-23T10:00:00.000Z", flags: [] } },
  }];
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("core: live campaigns refresh their results and health by themselves (#258)", () => {
  it("stores Meta's lifetime numbers, including today's delivery (#404)", async () => {
    const sent = replay();
    await run();
    expect(sent.filter(call => call.includes("/insights")).every(call => call.endsWith("&date_preset=maximum"))).toBe(true);
    expect(db.results.find(row => row.campaign_id.endsWith("157"))).toMatchObject({
      impressions: 70, clicks: 2, spend: 10.69, conversations: 1, cost_per_conversation: 10.69,
      destination: "whatsapp", period_start: "2026-10-23", period_end: "2026-10-24",
    });
  });

  it("saves one result row per campaign from recorded Meta reads, flags 0 impressions after 6 h, and only reads", async () => {
    const sent = replay();
    const { status, body } = await run();
    expect(status).toBe(200);
    expect(body).toMatchObject({ refreshed: 2, skipped: 0, failed: 0 });
    expect(sent.every(call => call.startsWith("GET "))).toBe(true);
    expect(db.results.map(row => [row.campaign_id.slice(-3), row.impressions])).toEqual([["157", 70], ["999", 0]]);
    // The live run started with its capped ad set (14:24Z), under 6 h ago: no flag yet.
    expect(healthOf(live)).toMatchObject({ activeSince: "2026-10-23T14:24:16.000Z", flags: [] });
    expect(healthOf(paused).flags).toEqual([expect.objectContaining({ kind: "not_delivering" })]);
    expect(body.alerts).toEqual([{ kind: "not_delivering", key: healthOf(paused).flags[0].key }]);
  });

  it("refreshes each campaign on every 15-min run, but not twice within 14 min (#992)", async () => {
    replay();
    await run();
    const sent = replay();
    vi.setSystemTime(new Date("2026-10-23T17:13:00Z"));
    const { body } = await run();
    expect(body).toMatchObject({ refreshed: 0, skipped: 2 });
    expect(sent).toEqual([]);
    expect(db.results).toHaveLength(2);
    vi.setSystemTime(new Date("2026-10-23T17:15:00Z"));
    expect((await run()).body).toMatchObject({ refreshed: 2, skipped: 0, failed: 0 });
    expect(db.results).toHaveLength(4);
  });

  it("flags a rejected ad with Meta's reason and alerts once per occurrence", async () => {
    replay(exchange => exchange.path.startsWith(`${live}/ads?`)
      ? { data: [
        { id: "120253678790440526", status: "ACTIVE", effective_status: "DISAPPROVED", configured_status: "ACTIVE", ad_review_feedback: { global: { "Housing": "Ads about housing must run with a special ad category." } } },
        { id: "120253678789370526", status: "PAUSED", effective_status: "PAUSED", configured_status: "PAUSED" },
      ] }
      : exchange.body);
    const { body } = await run();
    const rejected = healthOf(live).flags.find(flag => flag.kind === "rejected")!;
    expect(rejected.reason).toBe("Meta rejected an ad: Ads about housing must run with a special ad category.");
    expect(body.alerts).toContainEqual({ kind: "rejected", key: rejected.key });
    expect(JSON.stringify(body.alerts)).not.toMatch(/1202|0000-4000/);
    vi.setSystemTime(new Date("2026-10-23T18:01:00Z"));
    replay(exchange => exchange.path.startsWith(`${live}/ads?`) ? { data: [] } : exchange.body);
    await run();
    expect(healthOf(live).flags).toEqual([]);
  });
});
