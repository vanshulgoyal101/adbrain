import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Keep-alive cron. This endpoint is what stands between the app and a paused
 * Supabase project (a pause takes DNS down, so auth and every query fail), so
 * its auth gating and failure reporting are pinned.
 */

const selectResult = { error: null as { message: string } | null };
const retention = vi.hoisted(() => ({ rpc: vi.fn(), abortSignal: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: retention.rpc }) }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({ limit: async () => selectResult }),
    }),
  }),
}));

const SECRET = "cron-secret-value";

function request(auth?: string): Request {
  return new Request("https://adbrain.vanshul.com/api/cron/keepalive", {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PRODUCT_LOGGING_DATABASE_ENABLED", "false");
  retention.rpc.mockReturnValue({ abortSignal: retention.abortSignal });
  retention.abortSignal.mockResolvedValue({ data: 12, error: null });
  vi.resetModules();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.CRON_SECRET = SECRET;
  selectResult.error = null;
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/cron/keepalive", () => {
  it("runs bounded retention only when durable logging is enabled", async () => {
    const { GET } = await import("@/app/api/cron/keepalive/route");
    expect((await GET(request(`Bearer ${SECRET}`))).status).toBe(200);
    expect(retention.rpc).not.toHaveBeenCalled();
    vi.stubEnv("PRODUCT_LOGGING_DATABASE_ENABLED", "true");
    expect((await GET(request(`Bearer ${SECRET}`))).status).toBe(200);
    expect(retention.rpc).toHaveBeenCalledWith("prune_product_events", {});
    expect(retention.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it("reports retention failure without exposing database messages", async () => {
    vi.stubEnv("PRODUCT_LOGGING_DATABASE_ENABLED", "true");
    retention.abortSignal.mockResolvedValueOnce({ data: null, error: { message: "private connection details" } });
    const { GET } = await import("@/app/api/cron/keepalive/route");
    const response = await GET(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private connection details");
  });

  it("is disabled when no secret is configured", async () => {
    process.env.CRON_SECRET = "";
    const { GET } = await import("@/app/api/cron/keepalive/route");
    expect((await GET(request(`Bearer ${SECRET}`))).status).toBe(404);
  });

  it("rejects a request with no credentials", async () => {
    const { GET } = await import("@/app/api/cron/keepalive/route");
    expect((await GET(request())).status).toBe(401);
  });

  it("rejects a wrong secret", async () => {
    const { GET } = await import("@/app/api/cron/keepalive/route");
    expect((await GET(request("Bearer nope"))).status).toBe(401);
  });

  it("rejects the right secret in the wrong scheme", async () => {
    const { GET } = await import("@/app/api/cron/keepalive/route");
    expect((await GET(request(SECRET))).status).toBe(401);
  });

  it("touches the database for Vercel Cron", async () => {
    const { GET } = await import("@/app/api/cron/keepalive/route");
    const res = await GET(request(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });
  });

  it("reports a failing keep-alive instead of silently succeeding", async () => {
    selectResult.error = { message: "connection refused" };
    const { GET } = await import("@/app/api/cron/keepalive/route");
    const res = await GET(request(`Bearer ${SECRET}`));
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({ ok: false });
  });
});
