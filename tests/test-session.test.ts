import { describe, expect, it } from "vitest";
import { browserCookies, mintTestSession, projectUrlFromKey, testSessionConfig } from "../scripts/lib/test-session.mjs";

const ref = "abcdefghijklmnopqrst";
const jwt = (payload: object) => `x.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.y`;
const serviceKey = jwt({ ref, role: "service_role" });
const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", email: "smoke@example.test" };

function fakeAuth({ linkStatus = 200, verifyStatus = 200 } = {}) {
  const calls: { path: string; grant: string | null; body: Record<string, unknown>; apikey: string | null }[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ path: url.pathname, grant: url.searchParams.get("grant_type"), body, apikey: new Headers(init?.headers).get("apikey") });
    if (url.pathname === "/auth/v1/admin/generate_link") {
      return Response.json(linkStatus === 200 ? { ...user, hashed_token: "hash-1", verification_type: "recovery" } : { code: linkStatus, error_code: "user_not_found", msg: "User not found" }, { status: linkStatus });
    }
    if (url.pathname === "/auth/v1/verify") {
      return Response.json(verifyStatus === 200
        ? { access_token: jwt({ sub: user.id, exp: 4102444800 }), refresh_token: "refresh-1", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user }
        : { code: verifyStatus, error_code: "otp_expired", msg: "Token has expired" }, { status: verifyStatus });
    }
    return Response.json({ msg: "unexpected" }, { status: 500 });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

describe("test sign-in without the password grant (#2574)", () => {
  it("reads the project from a JWT service key and refuses anything else", () => {
    expect(projectUrlFromKey(serviceKey)).toBe(`https://${ref}.supabase.co`);
    expect(projectUrlFromKey("sb_secret_abc")).toBeNull();
    expect(projectUrlFromKey(jwt({ ref: "../evil.example/x" }))).toBeNull();
    expect(projectUrlFromKey(undefined)).toBeNull();
  });

  it("needs only the service key, and prefers an explicit URL and publishable key", () => {
    expect(testSessionConfig({ SUPABASE_SERVICE_ROLE_KEY: serviceKey })).toEqual({ url: `https://${ref}.supabase.co`, serviceRoleKey: serviceKey, apikey: serviceKey });
    expect(testSessionConfig({ SUPABASE_SERVICE_ROLE_KEY: serviceKey, NEXT_PUBLIC_SUPABASE_URL: "https://other.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_x" }))
      .toEqual({ url: "https://other.supabase.co", serviceRoleKey: serviceKey, apikey: "sb_publishable_x" });
    expect(() => testSessionConfig({})).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(() => testSessionConfig({ SUPABASE_SERVICE_ROLE_KEY: "sb_secret_abc" })).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("mints through the app when TEST_SESSION_SECRET is set, so CI never holds the service key", async () => {
    const config = testSessionConfig({ TEST_SESSION_SECRET: " t0k ", SUPABASE_SERVICE_ROLE_KEY: serviceKey }, "https://adbrain.vanshul.com/x");
    expect(config).toEqual({ route: "https://adbrain.vanshul.com/api/internal/test-session", secret: "t0k" });
    expect(testSessionConfig({ TEST_SESSION_SECRET: "t0k", SUPABASE_SERVICE_ROLE_KEY: serviceKey })).toHaveProperty("serviceRoleKey");

    const calls: { url: string; init?: RequestInit }[] = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      const headers = new Headers({ "content-type": "application/json" });
      headers.append("set-cookie", `sb-${ref}-auth-token=base64-abc%3D; Path=/; Max-Age=34560000; SameSite=lax`);
      headers.append("set-cookie", `sb-${ref}-auth-token-code-verifier=; Path=/; Max-Age=0`);
      return new Response(JSON.stringify({ user: { id: user.id, email: user.email }, accessToken: "at-1", supabase: "https://x.supabase.co", apikey: "sb_publishable_x" }), { headers });
    }) as typeof globalThis.fetch;
    const minted = await mintTestSession(" smoke@example.test ", { config, fetch });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://adbrain.vanshul.com/api/internal/test-session");
    expect(new Headers(calls[0].init?.headers).get("authorization")).toBe("Bearer t0k");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ email: "smoke@example.test" });
    expect(minted).toEqual({ session: { access_token: "at-1" }, user: { id: user.id, email: user.email },
      cookies: [{ name: `sb-${ref}-auth-token`, value: "base64-abc=" }], supabase: "https://x.supabase.co", apikey: "sb_publishable_x" });

    const refused = (async () => Response.json({ error: "Forbidden" }, { status: 403 })) as typeof globalThis.fetch;
    await expect(mintTestSession("smoke@example.test", { config, fetch: refused })).rejects.toThrow(/^test sign-in: the app refused \(403\)$/);
  });

  it("mints a recovery token (an unknown email is refused, never signed up), verifies it and returns the app's session cookie, never the password grant", async () => {
    const { fetch, calls } = fakeAuth();
    const config = { url: `https://${ref}.supabase.co`, serviceRoleKey: serviceKey, apikey: "sb_publishable_x" };
    const minted = await mintTestSession(" smoke@example.test ", { config, fetch });

    expect(calls.map((call) => call.path)).toEqual(["/auth/v1/admin/generate_link", "/auth/v1/verify"]);
    expect(calls.some((call) => call.path === "/auth/v1/token")).toBe(false);
    expect(calls[0]).toMatchObject({ body: { type: "recovery", email: "smoke@example.test" }, apikey: serviceKey });
    expect(calls[1]).toMatchObject({ body: { type: "recovery", token_hash: "hash-1" }, apikey: "sb_publishable_x" });
    expect(minted.user.id).toBe(user.id);
    expect(minted).toMatchObject({ supabase: config.url, apikey: "sb_publishable_x" });
    expect(minted.cookies.map((cookie) => cookie.name)).toEqual([`sb-${ref}-auth-token`]);
    expect(minted.cookies[0].value).toMatch(/^base64-/);
  });

  it("fails with a code only, never the email", async () => {
    const config = { url: `https://${ref}.supabase.co`, serviceRoleKey: serviceKey, apikey: serviceKey };
    const missing = mintTestSession("smoke@example.test", { config, fetch: fakeAuth({ linkStatus: 404 }).fetch });
    await expect(missing).rejects.toThrow(/^test sign-in: no sign-in token \(user_not_found\)$/);
    const expired = mintTestSession("smoke@example.test", { config, fetch: fakeAuth({ verifyStatus: 403 }).fetch });
    await expect(expired).rejects.toThrow(/^test sign-in: verify failed \(otp_expired\)$/);
    await expect(mintTestSession(" ", { config, fetch: fakeAuth().fetch })).rejects.toThrow(/no email/);
  });

  it("scopes the browser cookies to the app's host", () => {
    expect(browserCookies([{ name: "sb-x-auth-token", value: "base64-abc" }], "https://adbrain.vanshul.com"))
      .toEqual([{ name: "sb-x-auth-token", value: "base64-abc", domain: "adbrain.vanshul.com", path: "/", sameSite: "Lax", secure: true }]);
    expect(browserCookies([{ name: "a", value: "b" }], "http://localhost:3939")[0]).toMatchObject({ domain: "localhost", secure: false });
  });
});
