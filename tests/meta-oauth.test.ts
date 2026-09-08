import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.NEXT_PUBLIC_SITE_URL = "https://adbrain.example.com";
  process.env.META_APP_ID = "123456";
  process.env.META_APP_SECRET = "shhh-secret";
  process.env.META_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
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

  it("includes Login for Business config_id when supplied", async () => {
    const { buildLoginUrl } = await import("@/lib/meta/oauth");
    const parsed = new URL(buildLoginUrl({
      appId: "123456",
      redirectUri: "https://adbrain.example.com/api/meta/oauth/callback",
      state: "state",
      configId: "config-123",
    }));
    expect(parsed.searchParams.get("config_id")).toBe("config-123");
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
  it("authenticates the instant-connect flow marker without changing legacy state", async () => {
    const { signState, verifyState } = await import("@/lib/meta/oauth");
    expect(verifyState(signState({ businessId: "business", userId: "owner", flow: "instant" }))?.flow).toBe("instant");
    expect(verifyState(signState({ businessId: "business", userId: "owner" }))?.flow).toBeUndefined();
  });

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

describe("Meta signed requests", () => {
  it("accepts an HMAC-SHA256 deauthorization payload", async () => {
    const payload = Buffer.from(JSON.stringify({
      algorithm: "HMAC-SHA256",
      user_id: "meta-user-1",
      issued_at: 1_757_200_000,
    })).toString("base64url");
    const signature = createHmac("sha256", "shhh-secret").update(payload).digest("base64url");
    const { verifyMetaSignedRequest } = await import("@/lib/meta/oauth");
    expect(verifyMetaSignedRequest(`${signature}.${payload}`)).toEqual({
      userId: "meta-user-1",
      issuedAt: 1_757_200_000,
    });
  });

  it("rejects a tampered signed request", async () => {
    const { verifyMetaSignedRequest } = await import("@/lib/meta/oauth");
    expect(verifyMetaSignedRequest("bad.payload")).toBeNull();
  });
});

describe("token exchange", () => {
  it("uses an app access token when inspecting a user token", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "meta-user" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ permission: "ads_read", status: "granted" }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { is_valid: true, app_id: "123456", user_id: "meta-user", expires_at: 1_800_000_000, data_access_expires_at: 1_790_000_000 } })));
    const { inspectMetaToken } = await import("@/lib/meta/oauth");
    const inspection = await inspectMetaToken("user-token");
    expect(inspection.metaUserId).toBe("meta-user");
    expect(inspection.dataAccessExpiresAt).toBe(new Date(1_790_000_000_000).toISOString());
    expect(String(fetchMock.mock.calls[2][0])).toContain("access_token=123456%7Cshhh-secret");
    expect(String(fetchMock.mock.calls[2][0])).not.toContain("access_token=user-token");
  });

  it.each([
    { is_valid: false, app_id: "123456", user_id: "meta-user" },
    { is_valid: true, app_id: "other-app", user_id: "meta-user" },
    { is_valid: true, app_id: "123456", user_id: "other-user" },
    { is_valid: true, app_id: "123456", user_id: "meta-user", data_access_expires_at: 1 },
  ])("rejects invalid token evidence %j", async (data) => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ id: "meta-user" }))
      .mockResolvedValueOnce(Response.json({ data: [] }))
      .mockResolvedValueOnce(Response.json({ data }));
    const { inspectMetaToken } = await import("@/lib/meta/oauth");
    await expect(inspectMetaToken("user-token")).rejects.toThrow();
  });

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

  it("follows bounded same-host cursors for account and page discovery", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes("me/adaccounts")) {
          const isNextPage = url.includes("after=one");
          return new Response(JSON.stringify({
            data: [{ id: isNextPage ? "act_2" : "act_1", account_id: isNextPage ? "2" : "1", name: isNextPage ? "Two" : "One", currency: "INR", account_status: 1 }],
            ...(isNextPage ? {} : { paging: { next: "https://graph.facebook.com/v21.0/me/adaccounts?after=one" } }),
          }));
        }
        if (url.includes("me/accounts")) {
          const isNextPage = url.includes("after=one");
          return new Response(JSON.stringify({
            data: [{ id: isNextPage ? "p2" : "p1", name: isNextPage ? "Page two" : "Page one" }],
            ...(isNextPage ? {} : { paging: { next: "https://graph.facebook.com/v21.0/me/accounts?after=one" } }),
          }));
        }
        return new Response(JSON.stringify({ data: [{ id: "act_2", account_id: "2", name: "Two", currency: "INR", account_status: 1 }] }));
      });
    const { fetchAdAccounts, fetchPages } = await import("@/lib/meta/oauth");
    expect(await fetchAdAccounts("tok")).toHaveLength(2);
    expect(await fetchPages("tok")).toHaveLength(2);
    expect(fetchMock.mock.calls.every(([input]) => !String(input).includes("access_token=tok") || String(input).startsWith("https://graph.facebook.com"))).toBe(true);
  });

  it("marks discovery incomplete when a cursor never terminates", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("me/adaccounts")) {
        return new Response(JSON.stringify({
          data: [{ id: "act_1", account_id: "1", name: "One", currency: "INR", account_status: 1 }],
          paging: { next: "https://graph.facebook.com/v21.0/me/adaccounts?after=forever" },
        }));
      }
      return new Response(JSON.stringify({
        data: [{ id: "page_1", name: "Page" }],
        paging: { next: "https://graph.facebook.com/v21.0/me/accounts?after=forever" },
      }));
    });
    const { discoverMetaAssets } = await import("@/lib/meta/oauth");
    expect((await discoverMetaAssets("tok")).complete).toBe(false);
  });

  it("records explicit shared business identity as relationship evidence", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("me/adaccounts")) {
        return new Response(JSON.stringify({
          data: [{
            id: "act_1",
            account_id: "1",
            name: "Main",
            currency: "INR",
            account_status: 1,
            timezone_name: "Asia/Kolkata",
            business: { id: "biz_1" },
          }],
        }));
      }
      return new Response(JSON.stringify({
        data: [{ id: "page_1", name: "Main Page", tasks: ["ADVERTISE"], business: { id: "biz_1" } }],
      }));
    });
    const { discoverMetaAssets } = await import("@/lib/meta/oauth");
    const snapshot = await discoverMetaAssets("tok");
    expect(snapshot.relationshipPairs).toEqual([
      { adAccountId: "act_1", pageId: "page_1", metaBusinessId: "biz_1" },
    ]);
    fetchMock.mockRestore();
  });
});
