import { beforeEach, describe, expect, it, vi } from "vitest";

// #1838: when Meta throttles an account the lead sync tries it again on a later run, and an app-wide limit stops the run.
const m = vi.hoisted(() => ({ connect: vi.fn(), rpc: vi.fn(), event: vi.fn(), queryError: null as null | { message: string }, still: [] as Array<{ business_id: string; throttled_until: string }> }));
vi.mock("@/lib/observability/logger", () => ({ observeRoute: (_r: string, _m: string, handler: unknown) => handler, recordProductEvent: m.event }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ CRON_SECRET: "cron-secret" }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => {
  const query = { select: () => query, in: () => query, gt: () => query, then: (resolve: (value: unknown) => unknown) => resolve(m.queryError ? { data: null, error: m.queryError } : { data: m.still, error: null }) };
  return { rpc: m.rpc, from: () => query };
} }));
vi.mock("@/lib/supabase/queries", () => ({ readAllByCursor: async () => [{ business_id: "b1" }, { business_id: "b2" }, { business_id: "b3" }] }));
vi.mock("@/lib/alerts/sender", () => ({ ownerAlertsConfig: () => null }));
vi.mock("@/lib/alerts/alert-store", () => ({ supabaseAlertStore: () => ({}) }));
vi.mock("@/lib/meta/connection-access", () => ({
  requireScheduledBusiness: async (id: string) => ({ businessId: id }),
  withMetaConnection: (context: { businessId: string }) => m.connect(context.businessId),
}));

const run = async () => {
  const { GET } = await import("@/app/api/cron/sync-leads/route");
  const response = await GET(new Request("http://localhost/api/cron/sync-leads", { headers: { authorization: "Bearer cron-secret" } }));
  return { status: response.status, body: await response.json() };
};
const synced = { imported: 2, sync: { id: "s", state: "complete", hasMore: false }, failedForms: [] };

beforeEach(() => { vi.clearAllMocks(); m.still = []; m.queryError = null; m.rpc.mockResolvedValue({ data: null, error: null }); });

describe("GET /api/cron/sync-leads under Meta throttling (#1838)", () => {
  it("a throttled account is listed as throttled, not failed; the others sync", async () => {
    const { MetaThrottledError } = await import("@/lib/meta/client");
    m.connect.mockImplementation(async (id: string) => {
      if (id === "b1") throw new MetaThrottledError("(#17) User request limit reached", 400, 17, 2446079, "account", 600_000);
      return synced;
    });
    const { status, body } = await run();
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.businesses[0]).toMatchObject({ businessId: "b1", throttled: { scope: "account", retryAfterMs: 600_000 } });
    expect(body.businesses[0].error).toBeUndefined();
    expect(m.connect).toHaveBeenCalledTimes(3);
  });

  it("#1838 slice 2: remembers the throttle, and the next run skips that business without calling Meta", async () => {
    const { MetaThrottledError } = await import("@/lib/meta/client");
    m.connect.mockImplementation(async (id: string) => {
      if (id === "b1") throw new MetaThrottledError("(#17) User request limit reached", 400, 17, 2446079, "account", 600_000);
      return synced;
    });
    await run();
    expect(m.rpc).toHaveBeenCalledWith("meta_throttle_record", { p_business_id: "b1", p_scope: "account", p_until: expect.any(String) });
    vi.clearAllMocks();
    m.connect.mockResolvedValue(synced);
    m.rpc.mockResolvedValue({ data: null, error: null });
    m.still = [{ business_id: "b1", throttled_until: new Date(Date.now() + 9 * 60_000).toISOString() }];
    const { body } = await run();
    expect(m.connect.mock.calls.map(([id]) => id)).toEqual(["b2", "b3"]);
    expect(body.businesses[0]).toMatchObject({ businessId: "b1", throttled: { scope: "account" } });
  });

  it("the app-wide limit stops the run: no more Meta calls", async () => {
    const { MetaThrottledError } = await import("@/lib/meta/client");
    m.connect.mockRejectedValueOnce(new MetaThrottledError("(#4) Application request limit reached", 400, 4, undefined, "app", 900_000));
    const { status, body } = await run();
    expect(status).toBe(200);
    expect(m.connect).toHaveBeenCalledTimes(1);
    expect(body.businesses.map((business: { throttled?: { scope: string } }) => business.throttled?.scope)).toEqual(["app", "app", "app"]);
  });

  it("QA #1950: a throttle store that returns an error is logged, and the run still goes ahead (fail open)", async () => {
    const { MetaThrottledError } = await import("@/lib/meta/client");
    m.rpc.mockResolvedValue({ data: null, error: { message: "function meta_throttle_record does not exist" } });
    m.queryError = { message: "column throttled_until does not exist" };
    m.connect.mockImplementation(async (id: string) => {
      if (id === "b1") throw new MetaThrottledError("(#17) User request limit reached", 400, 17, 2446079, "account", 600_000);
      return synced;
    });
    const { status, body } = await run();
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(m.connect.mock.calls.map(([id]) => id)).toEqual(["b1", "b2", "b3"]);
    const codes = m.event.mock.calls.map(([event]) => [event.name, event.outcome, event.attributes?.errorCode, event.businessId]);
    expect(codes).toEqual(expect.arrayContaining([
      ["meta.throttle_store", "failed", "THROTTLE_APP_READ_FAILED", undefined],
      ["meta.throttle_store", "failed", "THROTTLE_READ_FAILED", undefined],
      ["meta.throttle_store", "failed", "THROTTLE_WRITE_FAILED", "b1"],
    ]));
  });
});
