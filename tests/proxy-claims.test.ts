import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";

/**
 * The proxy gate verifies the Supabase JWT locally (getClaims) instead of calling Auth on every
 * request. These tests use a real ES256 key, a real signed token and a mocked network.
 */

const b64u = (value: string | Uint8Array) => Buffer.from(value).toString("base64url");
let privateKey: CryptoKey;
let otherKey: CryptoKey;
let jwk: JsonWebKey & { kid?: string };
const fetchMock = vi.fn();

async function sign(payload: Record<string, unknown>, key = privateKey) {
  const data = `${b64u(JSON.stringify({ alg: "ES256", typ: "JWT", kid: "test-kid" }))}.${b64u(JSON.stringify(payload))}`;
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, Buffer.from(data));
  return `${data}.${b64u(new Uint8Array(signature))}`;
}
const now = () => Math.floor(Date.now() / 1000);
const claims = (exp: number) => ({ sub: "u1", aud: "authenticated", role: "authenticated", exp, iat: exp - 3600, session_id: "s1" });
const user = { id: "u1", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };

async function cookieFor(accessToken: string, expiresAt: number) {
  const session = { access_token: accessToken, refresh_token: "refresh-1", token_type: "bearer", expires_in: 3600, expires_at: expiresAt, user };
  return { "sb-test-auth-token": `base64-${b64u(JSON.stringify(session))}` };
}
function request(path: string, cookies: Record<string, string> = {}) {
  const req = new NextRequest(`https://adbrain.vanshul.com${path}`);
  for (const [name, value] of Object.entries(cookies)) req.cookies.set(name, value);
  return req;
}
const urls = () => fetchMock.mock.calls.map(([url]) => String(url));

beforeAll(async () => {
  const generate = () => crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pair = await generate();
  privateKey = pair.privateKey;
  otherKey = (await generate()).privateKey;
  jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), alg: "ES256", use: "sig", kid: "test-kid" } as JsonWebKey;
});

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("NEXT_PUBLIC_DEV_AUTH_BYPASS", "");
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).endsWith("/.well-known/jwks.json")) return Response.json({ keys: [jwk] });
    throw new Error(`unexpected network call: ${url}`);
  });
});

describe("proxy auth with local JWT verification", () => {
  it("lets a valid session through without calling Auth, and reuses the cached key set", async () => {
    const { updateSession } = await import("@/lib/supabase/middleware");
    const cookies = await cookieFor(await sign(claims(now() + 3600)), now() + 3600);
    const first = await updateSession(request("/dashboard", cookies));
    expect(first.status).toBe(200);
    expect(first.headers.get("location")).toBeNull();
    expect(urls().filter(url => !url.endsWith("/.well-known/jwks.json"))).toEqual([]);
    const before = fetchMock.mock.calls.length;
    expect((await updateSession(request("/campaigns", cookies))).headers.get("location")).toBeNull();
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it("refreshes an expired access token with the refresh token and sets the new cookies", async () => {
    const fresh = await sign(claims(now() + 3600));
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith("/.well-known/jwks.json")) return Response.json({ keys: [jwk] });
      if (String(url).includes("/auth/v1/token?grant_type=refresh_token")) {
        return Response.json({ access_token: fresh, token_type: "bearer", expires_in: 3600, expires_at: now() + 3600, refresh_token: "refresh-2", user });
      }
      throw new Error(`unexpected network call: ${url}`);
    });
    const { updateSession } = await import("@/lib/supabase/middleware");
    const stale = await cookieFor(await sign(claims(now() - 60)), now() - 60);
    const res = await updateSession(request("/dashboard", stale));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(urls().filter(url => url.includes("grant_type=refresh_token"))).toHaveLength(1);
    expect(res.headers.getSetCookie().some(cookie => cookie.startsWith("sb-test-auth-token="))).toBe(true);
  });

  it("redirects a protected path with no cookie to login and keeps the destination", async () => {
    const { updateSession } = await import("@/lib/supabase/middleware");
    const res = await updateSession(request("/campaigns"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("redirect")).toBe("/campaigns");
  });

  it("redirects a token signed with the wrong key", async () => {
    const { updateSession } = await import("@/lib/supabase/middleware");
    const forged = await cookieFor(await sign(claims(now() + 3600), otherKey), now() + 3600);
    expect(new URL((await updateSession(request("/dashboard", forged))).headers.get("location")!).pathname).toBe("/login");
  });

  it("does not sign anyone out when the key set cannot be fetched", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const { updateSession } = await import("@/lib/supabase/middleware");
    const cookies = await cookieFor(await sign(claims(now() + 3600)), now() + 3600);
    const res = await updateSession(request("/dashboard", cookies));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("does not sign anyone out when Auth rejects a refresh for a reason other than a dead session", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("grant_type=refresh_token")) return Response.json({ code: 429, error_code: "over_request_rate_limit", msg: "slow down" }, { status: 429 });
      throw new Error(`unexpected network call: ${url}`);
    });
    const { updateSession } = await import("@/lib/supabase/middleware");
    const stale = await cookieFor(await sign(claims(now() - 60)), now() - 60);
    expect((await updateSession(request("/dashboard", stale))).headers.get("location")).toBeNull();
  });

  it("redirects when the refresh token is no longer valid", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("grant_type=refresh_token")) {
        return Response.json({ code: "refresh_token_not_found", error_code: "refresh_token_not_found", message: "Invalid Refresh Token" }, { status: 400 });
      }
      throw new Error(`unexpected network call: ${url}`);
    });
    const { updateSession } = await import("@/lib/supabase/middleware");
    const stale = await cookieFor(await sign(claims(now() - 60)), now() - 60);
    expect(new URL((await updateSession(request("/dashboard", stale))).headers.get("location")!).pathname).toBe("/login");
  });

  // #1376: the homepage is static (CDN-cached); the proxy, not the page, sends signed-in owners to the dashboard.
  it("sends a signed-in owner from / to /dashboard and keeps refreshed cookies", async () => {
    const fresh = await sign(claims(now() + 3600));
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith("/.well-known/jwks.json")) return Response.json({ keys: [jwk] });
      if (String(url).includes("/auth/v1/token?grant_type=refresh_token")) {
        return Response.json({ access_token: fresh, token_type: "bearer", expires_in: 3600, expires_at: now() + 3600, refresh_token: "refresh-2", user });
      }
      throw new Error(`unexpected network call: ${url}`);
    });
    const { updateSession } = await import("@/lib/supabase/middleware");
    const valid = await updateSession(request("/", await cookieFor(fresh, now() + 3600)));
    expect(valid.status).toBe(307);
    expect(new URL(valid.headers.get("location")!).pathname).toBe("/dashboard");
    const refreshed = await updateSession(request("/", await cookieFor(await sign(claims(now() - 60)), now() - 60)));
    expect(new URL(refreshed.headers.get("location")!).pathname).toBe("/dashboard");
    expect(refreshed.headers.getSetCookie().some(cookie => cookie.startsWith("sb-test-auth-token="))).toBe(true);
  });

  it("lets a visitor with no session (or another key's token) see the homepage", async () => {
    const { updateSession } = await import("@/lib/supabase/middleware");
    const anonymous = await updateSession(request("/"));
    expect(anonymous.status).toBe(200);
    expect(anonymous.headers.get("location")).toBeNull();
    const forged = await updateSession(request("/", await cookieFor(await sign(claims(now() + 3600), otherKey), now() + 3600)));
    expect(forged.headers.get("location")).toBeNull();
    expect(urls().filter(url => !url.endsWith("/.well-known/jwks.json"))).toEqual([]);
  });

  it("keeps the homepage free of per-request APIs so it renders static", () => {
    const page = readFileSync("src/app/page.tsx", "utf8");
    expect(page).not.toMatch(/getUser|cookies\(|headers\(|createClient|redirect\(|connection\(/);
  });
});
