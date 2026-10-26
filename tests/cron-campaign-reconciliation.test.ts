import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ secret: "cron-secret" as string | undefined, rows: [] as unknown[], error: null as unknown, filters: [] as unknown[][] }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ CRON_SECRET: mocks.secret }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ select: () => ({ eq: (...args: unknown[]) => {
    mocks.filters.push(args);
    return { limit: () => ({ abortSignal: async () => ({ data: mocks.error ? null : mocks.rows, error: mocks.error }) }) };
  } }) }) }),
}));

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const key = (id: string) => createHash("sha256").update(id).digest("hex").slice(0, 12);
const call = async (auth = "Bearer cron-secret") => {
  const { GET } = await import("@/app/api/cron/campaign-reconciliation/route");
  const response = await GET(new Request("http://localhost/api/cron/campaign-reconciliation", { headers: { authorization: auth } }));
  return { status: response.status, body: await response.json() };
};

beforeEach(() => { mocks.secret = "cron-secret"; mocks.error = null; mocks.rows = []; mocks.filters = []; });

describe("GET /api/cron/campaign-reconciliation (#734)", () => {
  it("requires the cron secret", async () => {
    expect((await call("Bearer wrong")).status).toBe(401);
    mocks.secret = undefined;
    expect((await call()).status).toBe(404);
  });

  it("is ok with nothing waiting", async () => {
    expect(await call()).toEqual({ status: 200, body: { ok: true, waiting: 0, stuck: [] } });
    expect(mocks.filters).toEqual([["state", "needs_reconciliation"]]);
  });

  it("flags rows waiting over 30 min, oldest first, with opaque keys only", async () => {
    mocks.rows = [
      { id: "operation-fixture-1", updated_at: ago(10) },
      { id: "operation-fixture-2", updated_at: ago(45) },
      { id: "operation-fixture-3", updated_at: ago(7_200) },
    ];
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body).toEqual({ ok: false, waiting: 3, stuck: [
      { key: key("operation-fixture-3"), minutes: 7_200 },
      { key: key("operation-fixture-2"), minutes: 45 },
    ] });
    expect(JSON.stringify(body)).not.toContain("operation-fixture");
  });

  it("returns 503 without database details", async () => {
    mocks.error = { message: "private details" };
    expect(await call()).toEqual({ status: 503, body: { ok: false, error: "Campaign operations are unavailable." } });
  });
});
