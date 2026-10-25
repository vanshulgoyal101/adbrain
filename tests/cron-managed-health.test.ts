import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ secret: "cron-secret" as string | undefined, rows: [] as unknown[], error: null as unknown }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ CRON_SECRET: mocks.secret }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ select: () => ({ limit: () => ({ abortSignal: async () => ({ data: mocks.error ? null : mocks.rows, error: mocks.error }) }) }) }) }),
}));

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const call = async (auth = "Bearer cron-secret") => {
  const { GET } = await import("@/app/api/cron/managed-health/route");
  const response = await GET(new Request("http://localhost/api/cron/managed-health", { headers: { authorization: auth } }));
  return { status: response.status, body: await response.json() };
};

beforeEach(() => { mocks.secret = "cron-secret"; mocks.error = null; mocks.rows = []; });

describe("GET /api/cron/managed-health (#527)", () => {
  it("requires the cron secret", async () => {
    expect((await call("Bearer nope")).status).toBe(401);
    mocks.secret = undefined;
    expect((await call()).status).toBe(404);
  });

  it("is ok with no managed accounts", async () => {
    expect(await call()).toEqual({ status: 200, body: { ok: true, accounts: 0, byState: {}, stuck: [] } });
  });

  it("counts by state and flags non-final states older than 30 min, failed included, with opaque keys only", async () => {
    mocks.rows = [
      { business_id: "business-fixture-1", state: "ready", updated_at: ago(500) },
      { business_id: "business-fixture-2", state: "offboarded", updated_at: ago(500) },
      { business_id: "business-fixture-3", state: "child_created", updated_at: ago(10) },
      { business_id: "business-fixture-4", state: "ad_account_created", updated_at: ago(45) },
      { business_id: "business-fixture-5", state: "failed", updated_at: ago(31) },
    ];
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.byState).toEqual({ ready: 1, offboarded: 1, child_created: 1, ad_account_created: 1, failed: 1 });
    expect(body.stuck.map(({ state, minutes }: { state: string; minutes: number }) => [state, minutes])).toEqual([["ad_account_created", 45], ["failed", 31]]);
    for (const { key } of body.stuck) expect(key).toMatch(/^[a-f0-9]{12}$/);
    expect(JSON.stringify(body)).not.toContain("business-fixture");
  });

  it("returns 503 without database details", async () => {
    mocks.error = { message: "private details" };
    expect(await call()).toEqual({ status: 503, body: { ok: false, error: "Managed accounts are unavailable." } });
  });
});
