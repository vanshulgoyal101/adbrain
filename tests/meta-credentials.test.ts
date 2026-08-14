import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ row: null as Record<string, unknown> | null }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: h.row }) }),
      }),
    }),
  }),
}));

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.META_SYSTEM_USER_TOKEN = "env-token";
  process.env.META_AD_ACCOUNT_ID = "act_env";
  process.env.META_PAGE_ID = "pg_env";
});

beforeEach(() => {
  h.row = null;
});

const future = () => new Date(Date.now() + 86_400_000).toISOString();
const past = () => new Date(Date.now() - 1000).toISOString();

describe("resolveMetaCredentials", () => {
  it("uses a complete, unexpired OAuth connection", async () => {
    h.row = {
      ad_account_id: "act_oauth",
      page_id: "pg_oauth",
      access_token: "oauth-token",
      token_type: "oauth",
      token_expires_at: future(),
      scopes: "ads_management",
    };
    const { resolveMetaCredentials } = await import("@/lib/meta/credentials");
    expect(await resolveMetaCredentials("biz")).toEqual({
      adAccountId: "act_oauth",
      pageId: "pg_oauth",
      accessToken: "oauth-token",
    });
  });

  it("falls back to env when the OAuth connection is pending selection", async () => {
    h.row = {
      ad_account_id: null,
      page_id: null,
      access_token: "oauth-token",
      token_type: "oauth",
      token_expires_at: future(),
      scopes: null,
    };
    const { resolveMetaCredentials } = await import("@/lib/meta/credentials");
    expect((await resolveMetaCredentials("biz"))?.adAccountId).toBe("act_env");
  });

  it("falls back to env when the token has expired", async () => {
    h.row = {
      ad_account_id: "act_oauth",
      page_id: "pg_oauth",
      access_token: "oauth-token",
      token_type: "oauth",
      token_expires_at: past(),
      scopes: null,
    };
    const { resolveMetaCredentials } = await import("@/lib/meta/credentials");
    expect((await resolveMetaCredentials("biz"))?.adAccountId).toBe("act_env");
  });

  it("uses env when there is no stored row", async () => {
    const { resolveMetaCredentials } = await import("@/lib/meta/credentials");
    expect((await resolveMetaCredentials("biz"))?.accessToken).toBe("env-token");
  });
});

describe("getMetaConnection", () => {
  it("reports a ready OAuth connection", async () => {
    h.row = {
      ad_account_id: "act_oauth",
      page_id: "pg_oauth",
      access_token: "oauth-token",
      token_type: "oauth",
      token_expires_at: future(),
      scopes: "ads_management,pages_show_list",
    };
    const { getMetaConnection } = await import("@/lib/meta/credentials");
    const c = await getMetaConnection("biz");
    expect(c).toMatchObject({
      source: "oauth",
      ready: true,
      pending: false,
      adAccountId: "act_oauth",
    });
    expect(c.scopes).toEqual(["ads_management", "pages_show_list"]);
  });

  it("reports pending when no account/page chosen", async () => {
    h.row = {
      ad_account_id: null,
      page_id: null,
      access_token: "oauth-token",
      token_type: "oauth",
      token_expires_at: future(),
      scopes: null,
    };
    const { getMetaConnection } = await import("@/lib/meta/credentials");
    const c = await getMetaConnection("biz");
    expect(c).toMatchObject({ source: "oauth", pending: true, ready: false });
  });

  it("reports expired OAuth connections", async () => {
    h.row = {
      ad_account_id: "act_oauth",
      page_id: "pg_oauth",
      access_token: "oauth-token",
      token_type: "oauth",
      token_expires_at: past(),
      scopes: null,
    };
    const { getMetaConnection } = await import("@/lib/meta/credentials");
    const c = await getMetaConnection("biz");
    expect(c).toMatchObject({ source: "oauth", expired: true, ready: false });
  });

  it("reports the env connection when nothing is stored", async () => {
    const { getMetaConnection } = await import("@/lib/meta/credentials");
    const c = await getMetaConnection("biz");
    expect(c).toMatchObject({ source: "env", ready: true, adAccountId: "act_env" });
  });
});
