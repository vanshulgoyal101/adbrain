import { beforeEach, describe, expect, it, vi } from "vitest";

type Filter = { table: string; ops: Array<[string, unknown[]]> };
const mocks = vi.hoisted(() => ({
  secret: "cron-secret" as string | undefined,
  tables: {} as Record<string, unknown[]>,
  error: null as unknown,
  queries: [] as Filter[],
  users: {} as Record<string, { id: string; email: string; email_confirmed_at: string | null }>,
}));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ CRON_SECRET: mocks.secret }) }));
vi.mock("@/lib/internal-accounts.json", () => ({
  default: { smokeUserIds: ["smoke-user"], domains: ["team.example"], userIds: [], exemptFromFreeProviders: [] },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { getUserById: async (id: string) => (mocks.users[id]
      ? { data: { user: mocks.users[id] }, error: null }
      : { data: { user: null }, error: { message: "not found" } }) } },
    from: (table: string) => {
      const query: Filter = { table, ops: [] };
      mocks.queries.push(query);
      const builder: Record<string, unknown> = {};
      for (const op of ["select", "in", "gte", "eq", "order", "range"]) {
        builder[op] = (...args: unknown[]) => { query.ops.push([op, args]); return builder; };
      }
      builder.abortSignal = async () => {
        if (mocks.error) return { data: null, error: mocks.error };
        const rows = mocks.tables[table] ?? [];
        const range = query.ops.find(([op]) => op === "range")?.[1] as [number, number] | undefined;
        const isPlanRoute = query.ops.some(([op, args]) => op === "eq" && args[0] === "name" && args[1] === "http.request");
        const selected = table === "product_events"
          ? rows.filter((r) => ((r as { name: string }).name === "http.request") === isPlanRoute)
          : rows;
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
  mocks.tables = {
    businesses: [{ id: "smoke-business" }],
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
    expect(JSON.stringify(body)).not.toMatch(/real-user|team-user|smoke-business|"b1"|example/);
    const businesses = mocks.queries.find((q) => q.table === "businesses")!;
    expect(businesses.ops).toContainEqual(["in", ["owner_id", ["smoke-user"]]]);
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
