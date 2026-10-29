import { beforeEach, describe, expect, it, vi } from "vitest";

// #1838: when Meta throttles an account the lead sync tries it again on a later run, and an app-wide limit stops the run.
const m = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("@/lib/observability/logger", () => ({ observeRoute: (_r: string, _m: string, handler: unknown) => handler }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ CRON_SECRET: "cron-secret" }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
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

beforeEach(() => { vi.clearAllMocks(); });

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

  it("the app-wide limit stops the run: no more Meta calls", async () => {
    const { MetaThrottledError } = await import("@/lib/meta/client");
    m.connect.mockRejectedValueOnce(new MetaThrottledError("(#4) Application request limit reached", 400, 4, undefined, "app", 900_000));
    const { status, body } = await run();
    expect(status).toBe(200);
    expect(m.connect).toHaveBeenCalledTimes(1);
    expect(body.businesses.map((business: { throttled?: { scope: string } }) => business.throttled?.scope)).toEqual(["app", "app", "app"]);
  });
});
