import { beforeEach, describe, expect, it, vi } from "vitest";

type Filter = { table: string; ops: Array<[string, unknown[]]> };
const mocks = vi.hoisted(() => ({
  secret: "cron-secret" as string | undefined,
  tables: {} as Record<string, unknown[]>,
  error: null as unknown,
  queries: [] as Filter[],
  users: {} as Record<string, { id: string; email: string; email_confirmed_at: string | null }>,
  recorded: [] as Array<{ name: string; attributes?: Record<string, unknown> }>,
}));
vi.mock("@/lib/observability/logger", async (actual) => ({
  ...(await actual<object>()),
  recordProductEvent: (event: { name: string; attributes?: Record<string, unknown> }) => mocks.recorded.push(event),
}));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ CRON_SECRET: mocks.secret }) }));
vi.mock("@/lib/internal-accounts.json", () => ({
  default: { smokeUserIds: ["smoke-user"], domains: ["team.example"], userIds: [], exemptFromFreeProviders: [] },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: {
      getUserById: async (id: string) => (mocks.users[id]
        ? { data: { user: mocks.users[id] }, error: null }
        : { data: { user: null }, error: { message: "not found" } }),
      // #1242: the scoreboard lists every account once.
      listUsers: async () => ({ data: { users: Object.values(mocks.users).map((user) => ({ created_at: "2026-01-01T00:00:00Z", ...user })) }, error: null }),
    } },
    from: (table: string) => {
      const query: Filter = { table, ops: [] };
      mocks.queries.push(query);
      const builder: Record<string, unknown> = {};
      for (const op of ["select", "in", "gte", "lt", "eq", "not", "order", "range", "like"]) {
        builder[op] = (...args: unknown[]) => { query.ops.push([op, args]); return builder; };
      }
      builder.abortSignal = async () => {
        if (mocks.error) return { data: null, error: mocks.error };
        const rows = mocks.tables[table] ?? [];
        const range = query.ops.find(([op]) => op === "range")?.[1] as [number, number] | undefined;
        const isPlanRoute = query.ops.some(([op, args]) => op === "eq" && args[0] === "name" && args[1] === "http.request");
        const named = query.ops.find(([op, args]) => op === "eq" && args[0] === "name" && args[1] !== "http.request")?.[1] as [string, string] | undefined;
        // #1242: the sign-up query matches by prefix; the others never see sign-ups.
        const like = query.ops.find(([op]) => op === "like")?.[1] as [string, string] | undefined;
        const name = (r: unknown) => (r as { name: string }).name;
        const ownerIn = query.ops.find(([op, args]) => op === "in" && args[0] === "owner_id")?.[1] as [string, string[]] | undefined;
        const owned = (r: unknown) => !ownerIn || ownerIn[1].includes((r as { owner_id?: string }).owner_id ?? "");
        const selected = table !== "product_events" ? rows.filter(owned)
          : named ? rows.filter((r) => name(r) === named[1])
          : like ? rows.filter((r) => name(r).startsWith(like[1].replace(/%$/, "")))
            : rows.filter((r) => !name(r).startsWith("auth.sign_up.") && name(r) !== "scoreboard.manage" && (name(r) === "http.request") === isPlanRoute);
        return { data: range ? selected.slice(range[0], range[1] + 1) : selected, error: null };
      };
      return builder;
    },
  }),
}));

const now = new Date().toISOString();
const call = async (path = "/api/cron/core-scoreboard", auth = "Bearer cron-secret") => {
  const { GET } = await import("@/app/api/cron/core-scoreboard/route");
  const response = await GET(new Request(`http://localhost${path}`, { headers: { authorization: auth } }));
  return { status: response.status, body: await response.json() };
};

beforeEach(() => {
  mocks.secret = "cron-secret";
  mocks.error = null;
  mocks.queries = [];
  mocks.recorded = [];
  mocks.tables = {
    businesses: [{ id: "smoke-business", owner_id: "smoke-user" }],
    product_events: [
      { name: "meta.create_paused", outcome: "success", user_id: "real-user", business_id: "b1", duration_ms: 900, attributes: {}, created_at: now },
      { name: "meta.create_paused", outcome: "failed", user_id: null, business_id: "smoke-business", duration_ms: 900, attributes: {}, created_at: now },
      { name: "creative.batch", outcome: "success", user_id: "real-user", business_id: "b1", duration_ms: null, attributes: { count: 3 }, created_at: now },
      { name: "creative.batch", outcome: "success", user_id: "team-user", business_id: "b2", duration_ms: null, attributes: { count: 3 }, created_at: now },
      { name: "http.request", outcome: "success", user_id: "real-user", business_id: "b1", duration_ms: 2000, attributes: { route: "/api/campaigns/plan" }, created_at: now },
    ],
    llm_usage_events: [
      { route: "creatives.generate", status: "success", user_id: "real-user", business_id: "b1", request_id: "r1", latency_ms: 20_000, created_at: now },
      { route: "creatives.generate", status: "success", user_id: "team-user", business_id: "b2", request_id: "r2", latency_ms: 100_000, created_at: now },
    ],
    campaign_operations: [{ business_id: "b1", state: "succeeded", created_at: now }, { business_id: "smoke-business", state: "failed", created_at: now }],
    campaigns: [{ id: "c1", business_id: "b1" }, { id: "c2", business_id: "smoke-business" }],
    campaign_results: [
      { campaign_id: "c1", fetched_at: new Date(Date.now() - 40 * 60_000).toISOString() },
      { campaign_id: "c1", fetched_at: new Date(Date.now() - 5 * 60_000).toISOString() },
    ],
  };
  mocks.users = {
    "real-user": { id: "real-user", email: "owner@shop.example", email_confirmed_at: now },
    "team-user": { id: "team-user", email: "qa@team.example", email_confirmed_at: now },
  };
});

describe("GET /api/cron/core-scoreboard (#681)", () => {
  it("requires the cron secret", async () => {
    expect((await call(undefined, "Bearer wrong")).status).toBe(401);
    mocks.secret = undefined;
    expect((await call()).status).toBe(404);
  });

  it("rejects an out-of-range window", async () => {
    for (const hours of ["0", "169", "2.5", "x"]) expect((await call(`/api/cron/core-scoreboard?hours=${hours}`)).status).toBe(400);
  });

  it("returns the board for the last 24 h with the smoke and its businesses left out", async () => {
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.hours).toBe(24);
    expect(body.excluded).toEqual({ events: 1, aiCalls: 0 });
    const step = (name: string) => body.rows.find((r: { step: string }) => r.step === name);
    expect(step("Launch")).toMatchObject({ now: "1 launch: 100% succeeded; Meta calls under `create_paused` 0/1 failed", met: true });
    expect(step("Create (customers, paid images)").now).toContain("p90 20 s");
    expect(step("Create (internal, free images)").now).toContain("p90 100 s");
    expect(mocks.queries.find((q) => q.table === "campaign_operations")!.ops).toContainEqual(["eq", ["kind", "campaign_create"]]);
    // #992: Manage is the newest result's age on active, Meta-bound campaigns (the smoke's left out).
    expect(step("Manage")).toMatchObject({ now: expect.stringMatching(/^1 active campaign: oldest results 5 min old;/), met: true });
    const campaigns = mocks.queries.find((q) => q.table === "campaigns")!;
    expect(campaigns.ops).toEqual(expect.arrayContaining([["eq", ["status", "active"]], ["not", ["meta_campaign_id", "is", null]]]));
    expect(mocks.queries.find((q) => q.table === "campaign_results")!.ops).toContainEqual(["in", ["campaign_id", ["c1", "c2"]]]);
    expect(JSON.stringify(body)).not.toMatch(/real-user|team-user|smoke-business|"b1"|example/);
    const businesses = mocks.queries.find((q) => q.table === "businesses")!;
    expect(businesses.ops).toContainEqual(["in", ["owner_id", ["smoke-user"]]]);
  });

  it("#1543: records today's Manage snapshot and reads the last 7 days of them into the trend row", async () => {
    mocks.tables.product_events.push({ name: "scoreboard.manage", outcome: "success", user_id: null, business_id: null, duration_ms: null,
      attributes: { count: 1, failedCount: 0, worstMinutes: 29, p90Minutes: 29 }, created_at: new Date(Date.now() - 86_400_000).toISOString() });
    const { body } = await call();
    expect(mocks.recorded).toContainEqual(expect.objectContaining({ kind: "system", name: "scoreboard.manage", outcome: "success",
      attributes: { count: 1, failedCount: 0, worstMinutes: 5, p90Minutes: 5 } }));
    const history = mocks.queries.find((q) => q.ops.some(([op, args]) => op === "eq" && args[1] === "scoreboard.manage"))!;
    expect(history.ops).toContainEqual(["gte", ["created_at", expect.any(String)]]);
    expect(body.rows.find((r: { step: string }) => r.step === "Manage, 7 days").now).toMatch(/29 min ❌$/);
  });

  it("#1697: counts the pilot funnel from prospect ownership, hand-over events and Go lives (no names)", async () => {
    mocks.users["prospect-user"] = { id: "prospect-user", email: "sales+prospect-solar@team.example", email_confirmed_at: now };
    mocks.users["pilot-owner"] = { id: "pilot-owner", email: "owner@solar.example", email_confirmed_at: now };
    mocks.tables.businesses.push({ id: "p-prepared", owner_id: "prospect-user" }, { id: "p-live", owner_id: "pilot-owner" });
    mocks.tables.creatives = [{ business_id: "p-prepared" }];
    mocks.tables.product_events.push({ name: "prospect.handed_over", outcome: "success", user_id: null, business_id: "p-live", duration_ms: null, attributes: {}, created_at: now });
    mocks.tables.campaigns.push({ id: "c-pilot", business_id: "p-live", launched_at: new Date(Date.now() - 8 * 86_400_000).toISOString() });
    const { body } = await call();
    const row = body.rows.find((r: { step: string }) => r.step === "Pilots");
    expect(row.now).toBe("2 prepared → 1 handed over → 1 live → 1 at Day 7 (answers: yes 0, maybe 0, no 0)");
    expect(JSON.stringify(body)).not.toMatch(/p-prepared|p-live|prospect-user|solar\.example/);
  });

  it("pages past 1,000 rows", async () => {
    mocks.tables.product_events = Array.from({ length: 1500 }, () =>
      ({ name: "meta.create_paused", outcome: "success", user_id: "real-user", business_id: "b1", duration_ms: 1, attributes: {}, created_at: now }));
    const { body } = await call("/api/cron/core-scoreboard?hours=168");
    expect(body.hours).toBe(168);
    expect(body.rows.find((r: { step: string }) => r.step === "Launch").now).toContain("Meta calls under `create_paused` 0/1500 failed");
  });

  it("returns 503 when a maker's account can't be read, so the split is never guessed", async () => {
    delete mocks.users["team-user"];
    expect(await call()).toEqual({ status: 503, body: { ok: false, error: "Scoreboard data is unavailable." } });
  });

  it("returns 503 without database details", async () => {
    mocks.error = { message: "private details" };
    expect(await call()).toEqual({ status: 503, body: { ok: false, error: "Scoreboard data is unavailable." } });
  });
});
