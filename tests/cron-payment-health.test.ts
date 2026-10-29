import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({ rpc: vi.fn(), abortSignal: vi.fn(), unmatched: vi.fn(), filters: [] as unknown[][] }));
const payments = vi.hoisted(() => ({ live: true }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: database.rpc, from: (table: string) => {
  const chain: Record<string, unknown> = {};
  for (const op of ["select", "eq", "gte"]) chain[op] = (...args: unknown[]) => { database.filters.push([table, op, ...args]); return chain; };
  chain.abortSignal = database.unmatched;
  return chain;
} }) }));
vi.mock("@/lib/payments/production-config", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/payments/production-config")>();
  return {
    ...actual,
    getProductionPaymentConfig: () => {
      if (!payments.live) throw new actual.ProductionPaymentError("DISABLED");
      return { accountId: "acc_fixture" };
    },
  };
});

const SECRET = "cron-secret-value";
const request = (auth?: string) => new Request("https://adbrain.vanshul.com/api/cron/payment-health", {
  headers: auth ? { authorization: auth } : {},
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.stubEnv("PRODUCT_LOGGING_DATABASE_ENABLED", "false");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("CRON_SECRET", SECRET);
  payments.live = true;
  database.rpc.mockReturnValue({ abortSignal: database.abortSignal });
  database.abortSignal.mockResolvedValue({ data: { events7d: 2, unprocessed: 0, capturedWithoutEvent: 0 }, error: null });
  database.unmatched.mockResolvedValue({ count: 0, error: null });
  database.filters = [];
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/cron/payment-health (#178)", () => {
  it("returns webhook counts for the live merchant account", async () => {
    const { GET } = await import("@/app/api/cron/payment-health/route");
    const response = await GET(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, payments: "live", events7d: 2, unprocessed: 0, capturedWithoutEvent: 0, planUnmatched7d: 0 });
    expect(database.rpc).toHaveBeenCalledWith("production_payment_webhook_health", { p_account_id: "acc_fixture" });
  });

  it("flags a capture without a webhook event", async () => {
    database.abortSignal.mockResolvedValueOnce({ data: { events7d: 0, unprocessed: 0, capturedWithoutEvent: 1 }, error: null });
    const { GET } = await import("@/app/api/cron/payment-health/route");
    const body = await (await GET(request(`Bearer ${SECRET}`))).json();
    expect(body).toMatchObject({ ok: false, capturedWithoutEvent: 1 });
  });

  // #1583 (Reviewer): a captured ₹999 plan payment that settled no month must reach DevOps for a refund.
  it("flags a captured plan payment that matched no plan month in the last 7 days", async () => {
    database.unmatched.mockResolvedValueOnce({ count: 1, error: null });
    const { GET } = await import("@/app/api/cron/payment-health/route");
    const body = await (await GET(request(`Bearer ${SECRET}`))).json();
    expect(body).toMatchObject({ ok: false, planUnmatched7d: 1 });
    expect(database.filters).toContainEqual(["product_events", "eq", "name", "plan.payment_unmatched"]);
  });

  it("reports disabled payments without querying", async () => {
    payments.live = false;
    const { GET } = await import("@/app/api/cron/payment-health/route");
    expect(await (await GET(request(`Bearer ${SECRET}`))).json()).toEqual({ ok: true, payments: "disabled" });
    expect(database.rpc).not.toHaveBeenCalled();
  });

  it("returns 503 without database details when the query fails", async () => {
    database.abortSignal.mockResolvedValueOnce({ data: null, error: { message: "private connection details" } });
    const { GET } = await import("@/app/api/cron/payment-health/route");
    const response = await GET(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private connection details");
  });

  it("requires the cron secret", async () => {
    const { GET } = await import("@/app/api/cron/payment-health/route");
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request("Bearer nope"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    vi.resetModules();
    const fresh = await import("@/app/api/cron/payment-health/route");
    expect((await fresh.GET(request(`Bearer ${SECRET}`))).status).toBe(404);
    expect(database.rpc).not.toHaveBeenCalled();
  });
});
