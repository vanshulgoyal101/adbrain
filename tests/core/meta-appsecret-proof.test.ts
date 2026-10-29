import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// #2096: every Graph call in oauth, parent and the alerts sender carries appsecret_proof, so Meta's
// "Require app secret" can be turned on without breaking connect, the parent check or alerts.
const SECRET = "app-secret-fixture";
const proofOf = (token: string) => createHmac("sha256", SECRET).update(token).digest("hex");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("PRODUCT_LOGGING_DATABASE_ENABLED", "false");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("META_APP_ID", "123456");
  vi.stubEnv("META_APP_SECRET", SECRET);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("appsecret_proof on Graph calls outside MetaClient (#2096)", () => {
  it("connect discovery sends the user token in a header with its proof, including Meta's paging URLs", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("me/adaccounts") && !url.includes("after=")) {
        return json({
          data: [{ id: "act_1", account_id: "1", name: "One", currency: "INR", account_status: 1 }],
          // Meta's next links carry the token (and sometimes a proof) in the query.
          paging: { next: "https://graph.facebook.com/v26.0/me/adaccounts?access_token=user-token&appsecret_proof=stale&after=x" },
        });
      }
      if (url.includes("me/adaccounts")) return json({ data: [] });
      return json({ data: [{ id: "page_1", name: "Page" }] });
    });
    const { discoverMetaAssets } = await import("@/lib/meta/oauth");
    await discoverMetaAssets("user-token");
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
    for (const [input, init] of fetchMock.mock.calls) {
      const url = new URL(String(input));
      expect(url.searchParams.getAll("appsecret_proof")).toEqual([proofOf("user-token")]);
      expect(url.searchParams.has("access_token")).toBe(false);
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer user-token");
    }
  });

  it("adds no proof to the code exchange (no token) or the app-token debug call", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("oauth/access_token")) return json({ access_token: "short-token" });
      if (url.includes("debug_token")) return json({ data: { is_valid: true, app_id: "123456", user_id: "u1" } });
      if (url.includes("me/permissions")) return json({ data: [{ permission: "ads_management", status: "granted" }] });
      return json({ id: "u1" });
    });
    const { exchangeCodeForToken, inspectMetaToken } = await import("@/lib/meta/oauth");
    await exchangeCodeForToken("code123", "https://x/cb");
    await inspectMetaToken("user-token");
    const proofs = fetchMock.mock.calls.map(([input]) => {
      const url = new URL(String(input));
      return [url.pathname.replace("/v26.0/", ""), url.searchParams.get("appsecret_proof")];
    });
    expect(proofs).toEqual(expect.arrayContaining([
      ["oauth/access_token", null],
      ["debug_token", null],
      ["me", proofOf("user-token")],
      ["me/permissions", proofOf("user-token")],
    ]));
  });

  it("sends no proof when META_APP_SECRET is unset", async () => {
    vi.stubEnv("META_APP_SECRET", "");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ data: [] }));
    const { fetchPages } = await import("@/lib/meta/oauth");
    await fetchPages("user-token");
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("appsecret_proof");
  });

  it("the 2-Tier parent check sends the parent token's proof", async () => {
    vi.stubEnv("META_PARENT_SYSTEM_TOKEN", "parent-token");
    vi.stubEnv("META_PARENT_BUSINESS_ID", "1158100643072508");
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ id: "61550000000001" }))
      .mockResolvedValueOnce(json({ id: "1158100643072508", verification_status: "verified" }));
    const { checkParentAccess } = await import("@/lib/meta/parent");
    expect(await checkParentAccess(fetchImpl)).toMatchObject({ ok: true });
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      `https://graph.facebook.com/v26.0/me?fields=id&appsecret_proof=${proofOf("parent-token")}`,
      `https://graph.facebook.com/v26.0/1158100643072508?fields=id,verification_status&appsecret_proof=${proofOf("parent-token")}`,
    ]);
  });

  it("an owner alert send carries the alerts token's proof", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({ messaging_product: "whatsapp", messages: [{ id: "wamid.fixture" }] }));
    const { sendTemplate } = await import("@/lib/alerts/sender");
    await sendTemplate({ phoneNumberId: "100000000000001", token: "alerts-token" }, { to: "+919800000000", template: "t", language: "en", params: ["x"] }, fetchImpl);
    expect(fetchImpl.mock.calls[0][0]).toBe(`https://graph.facebook.com/v26.0/100000000000001/messages?appsecret_proof=${proofOf("alerts-token")}`);
  });
});
