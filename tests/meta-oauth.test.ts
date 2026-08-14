import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.NEXT_PUBLIC_SITE_URL = "https://adbrain.example.com";
  process.env.META_APP_ID = "123456";
  process.env.META_APP_SECRET = "shhh-secret";
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(json: unknown, ok = true, status = 200) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => json,
    text: async () => "",
  }) as unknown as typeof fetch;
}

describe("buildLoginUrl", () => {
  it("includes the app id, redirect, state, scopes and response_type", async () => {
    const { buildLoginUrl, META_LOGIN_SCOPES } = await import("@/lib/meta/oauth");
    const url = buildLoginUrl({
      appId: "123456",
      redirectUri: "https://adbrain.example.com/api/meta/oauth/callback",
      state: "st.ate",
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(
      "https://www.facebook.com/v21.0/dialog/oauth",
    );
    expect(parsed.searchParams.get("client_id")).toBe("123456");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("state")).toBe("st.ate");
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "https://adbrain.example.com/api/meta/oauth/callback",
    );
    expect(parsed.searchParams.get("scope")).toBe(META_LOGIN_SCOPES.join(","));
  });
});

describe("oauthRedirectUri", () => {
  it("derives the callback URL from the site origin", async () => {
    const { oauthRedirectUri } = await import("@/lib/meta/oauth");
    expect(oauthRedirectUri()).toBe(
      "https://adbrain.example.com/api/meta/oauth/callback",
    );
  });
});

describe("metaOAuthConfigured", () => {
  it("is true when app id + secret are present", async () => {
    const { metaOAuthConfigured } = await import("@/lib/meta/oauth");
    expect(metaOAuthConfigured()).toBe(true);
  });
});

describe("signState / verifyState", () => {
  it("round-trips a valid state token", async () => {
    const { signState, verifyState } = await import("@/lib/meta/oauth");
    const token = signState({ businessId: "biz-1", userId: "user-1" });
    const payload = verifyState(token);
    expect(payload?.businessId).toBe("biz-1");
    expect(payload?.userId).toBe("user-1");
  });

  it("rejects a tampered token", async () => {
    const { signState, verifyState } = await import("@/lib/meta/oauth");
    const token = signState({ businessId: "biz-1", userId: "user-1" });
    const [body] = token.split(".");
    expect(verifyState(`${body}.deadbeef`)).toBeNull();
  });

  it("rejects a malformed token", async () => {
    const { verifyState } = await import("@/lib/meta/oauth");
    expect(verifyState("nonsense")).toBeNull();
    expect(verifyState("")).toBeNull();
  });

  it("rejects an expired token", async () => {
    const { signState, verifyState } = await import("@/lib/meta/oauth");
    const token = signState({ businessId: "biz-1", userId: "user-1" });
    expect(verifyState(token, -1)).toBeNull();
  });
});

describe("token exchange", () => {
  it("exchangeCodeForToken returns the access token", async () => {
    mockFetch({ access_token: "short-token" });
    const { exchangeCodeForToken } = await import("@/lib/meta/oauth");
    const token = await exchangeCodeForToken("code123", "https://x/cb");
    expect(token).toBe("short-token");
  });

  it("exchangeForLongLivedToken maps expiry", async () => {
    mockFetch({ access_token: "long-token", expires_in: 5184000 });
    const { exchangeForLongLivedToken } = await import("@/lib/meta/oauth");
    const out = await exchangeForLongLivedToken("short-token");
    expect(out).toEqual({ accessToken: "long-token", expiresInSec: 5184000 });
  });

  it("throws a MetaError on an error response", async () => {
    mockFetch({ error: { message: "bad code" } }, false, 400);
    const { exchangeCodeForToken } = await import("@/lib/meta/oauth");
    await expect(exchangeCodeForToken("bad", "https://x/cb")).rejects.toThrow(
      "bad code",
    );
  });
});

describe("account + page listing", () => {
  it("maps ad accounts and flags disabled ones", async () => {
    mockFetch({
      data: [
        { id: "act_1", account_id: "1", name: "Main", currency: "INR", account_status: 1 },
        { id: "act_2", account_id: "2", name: "Old", account_status: 2 },
      ],
    });
    const { fetchAdAccounts } = await import("@/lib/meta/oauth");
    const accounts = await fetchAdAccounts("tok");
    expect(accounts).toHaveLength(2);
    expect(accounts[0]).toMatchObject({ id: "act_1", disabled: false });
    expect(accounts[1].disabled).toBe(true);
  });

  it("maps pages", async () => {
    mockFetch({ data: [{ id: "p1", name: "Solaride" }] });
    const { fetchPages } = await import("@/lib/meta/oauth");
    const pages = await fetchPages("tok");
    expect(pages).toEqual([{ id: "p1", name: "Solaride" }]);
  });

  it("returns [] when Meta omits or malforms the data field", async () => {
    const { fetchAdAccounts, fetchPages } = await import("@/lib/meta/oauth");
    for (const body of [{}, { data: null }, { data: "oops" }, { data: {} }]) {
      mockFetch(body);
      expect(await fetchAdAccounts("tok")).toEqual([]);
      mockFetch(body);
      expect(await fetchPages("tok")).toEqual([]);
    }
  });
});
