import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN = "parent-token-fixture-value";
const PARENT = "9000000000001";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("PRODUCT_LOGGING_DATABASE_ENABLED", "false");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("CRON_SECRET", "cron-secret");
  vi.stubEnv("META_PARENT_SYSTEM_TOKEN", TOKEN);
  vi.stubEnv("META_PARENT_BUSINESS_ID", PARENT);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("2-Tier parent token check (#520)", () => {
  it("is off by default and reports 'not configured' without calling Meta", async () => {
    vi.stubEnv("META_PARENT_SYSTEM_TOKEN", "");
    const fetchImpl = vi.fn();
    const { checkParentAccess } = await import("@/lib/meta/parent");
    expect(await checkParentAccess(fetchImpl)).toEqual({ configured: false, enabled: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("has no default parent business: unset or empty stays unset (#2358)", async () => {
    vi.stubEnv("META_PARENT_BUSINESS_ID", "");
    const { getEnv } = await import("@/lib/env");
    expect(getEnv().META_PARENT_BUSINESS_ID).toBeUndefined();
  });

  it("a token without a parent business id is NOT_CONFIGURED, without calling Meta (#2358)", async () => {
    vi.stubEnv("META_PARENT_BUSINESS_ID", "");
    const fetchImpl = vi.fn();
    const { checkParentAccess } = await import("@/lib/meta/parent");
    expect(await checkParentAccess(fetchImpl)).toEqual({ configured: true, enabled: false, ok: false, errorCode: "NOT_CONFIGURED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reads /me and the parent business with the token in a header, never the URL", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json(200, { id: "61550000000001" }))
      .mockResolvedValueOnce(json(200, { id: PARENT, verification_status: "verified" }));
    const { checkParentAccess } = await import("@/lib/meta/parent");
    expect(await checkParentAccess(fetchImpl)).toEqual({ configured: true, enabled: false, ok: true, businessVerified: true });
    const [[meUrl, meInit], [bizUrl]] = fetchImpl.mock.calls;
    expect(meUrl).toBe("https://graph.facebook.com/v26.0/me?fields=id");
    expect(bizUrl).toBe(`https://graph.facebook.com/v26.0/${PARENT}?fields=id,verification_status`);
    expect(meInit.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    for (const [url] of fetchImpl.mock.calls) expect(url).not.toContain(TOKEN);
  });

  it("returns Meta's error code only, never its message or the token", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(400, { error: { message: `Invalid token ${TOKEN}`, type: "OAuthException", code: 190, error_subcode: 463 } }));
    const { checkParentAccess } = await import("@/lib/meta/parent");
    const result = await checkParentAccess(fetchImpl);
    expect(result).toEqual({ configured: true, enabled: false, ok: false, errorCode: "META_190_463" });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("flags a token that reads a different business", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json(200, { id: "1" }))
      .mockResolvedValueOnce(json(200, { id: "999" }));
    const { checkParentAccess } = await import("@/lib/meta/parent");
    expect(await checkParentAccess(fetchImpl)).toMatchObject({ ok: false, errorCode: "BUSINESS_MISMATCH" });
  });

  it("route: requires the cron secret, 200 when not configured, 503 when Meta refuses", async () => {
    const request = (auth = "Bearer cron-secret") => new Request("http://localhost/api/cron/meta-parent-health", { headers: { authorization: auth } });
    vi.stubEnv("META_PARENT_SYSTEM_TOKEN", "");
    let { GET } = await import("@/app/api/cron/meta-parent-health/route");
    expect((await GET(request("Bearer wrong"))).status).toBe(401);
    const off = await GET(request());
    expect(off.status).toBe(200);
    expect(await off.json()).toEqual({ ok: true, configured: false, enabled: false });

    vi.resetModules();
    vi.stubEnv("META_PARENT_SYSTEM_TOKEN", TOKEN);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(401, { error: { code: 190 } })));
    ({ GET } = await import("@/app/api/cron/meta-parent-health/route"));
    const refused = await GET(request());
    expect(refused.status).toBe(503);
    expect(await refused.json()).toEqual({ configured: true, enabled: false, ok: false, errorCode: "META_190" });
  });
});
