import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  connection: null as Record<string, unknown> | null,
  token: null as Record<string, unknown> | null,
  plaintext: "oauth-token",
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null }) }),
      }),
    }),
  }),
}));

vi.mock("@/lib/meta/token-store", () => ({
  decryptMetaToken: () => h.plaintext,
  fromPostgresBytea: (value: string) => value,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string) => ({
      data: name === "meta_token_get" && h.token ? [h.token] : [],
      error: null,
    }),
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: table === "meta_connections" ? h.connection : null,
            error: null,
          }),
        }),
      }),
    }),
    schema: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: h.token, error: null }) }),
          }),
        }),
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
  h.connection = null;
  h.token = null;
  h.plaintext = "oauth-token";
});

const future = () => new Date(Date.now() + 86_400_000).toISOString();
const past = () => new Date(Date.now() - 1000).toISOString();

describe("resolveMetaCredentials", () => {
  it("uses a complete, unexpired OAuth connection", async () => {
    h.connection = {
      business_id: "biz",
      token_id: "token-1",
      ad_account_id: "act_oauth",
      page_id: "pg_oauth",
      authorization_status: "connected",
    };
    h.token = {
      id: "token-1", business_id: "biz", ciphertext: "", nonce: "", auth_tag: "",
      key_id: "", format_version: "", expires_at: null, revoked_at: null,
    };
    const { resolveMetaCredentials } = await import("@/lib/meta/credentials");
    expect(await resolveMetaCredentials("biz")).toEqual({
      adAccountId: "act_oauth",
      pageId: "pg_oauth",
      accessToken: "oauth-token",
    });
  });

  it("fails closed when the OAuth connection is pending selection", async () => {
    h.connection = { business_id: "biz", token_id: null, ad_account_id: null, page_id: null, authorization_status: "connected" };
    const { resolveMetaCredentials } = await import("@/lib/meta/credentials");
    expect(await resolveMetaCredentials("biz")).toBeNull();
  });

  it("fails closed when the token has expired", async () => {
    h.connection = { business_id: "biz", token_id: "token-1", ad_account_id: "act_oauth", page_id: "pg_oauth", authorization_status: "connected" };
    h.token = { id: "token-1", business_id: "biz", expires_at: past(), revoked_at: null };
    const { resolveMetaCredentials } = await import("@/lib/meta/credentials");
    expect(await resolveMetaCredentials("biz")).toBeNull();
  });

  it("fails closed when there is no stored row", async () => {
    const { resolveMetaCredentials } = await import("@/lib/meta/credentials");
    expect(await resolveMetaCredentials("biz")).toBeNull();
  });
});

describe("getMetaConnection", () => {
  it("reports a ready OAuth connection", async () => {
    h.connection = { business_id: "biz", token_id: "token-1", ad_account_id: "act_oauth", page_id: "pg_oauth", authorization_status: "connected" };
    h.token = { id: "token-1", business_id: "biz", expires_at: future(), revoked_at: null };
    const { getMetaConnection } = await import("@/lib/meta/credentials");
    const c = await getMetaConnection("biz");
    expect(c).toMatchObject({
      source: "oauth",
      ready: true,
      pending: false,
      adAccountId: "act_oauth",
    });
    expect(c.scopes).toEqual([]);
  });

  it("reports pending when no account/page chosen", async () => {
    h.connection = { business_id: "biz", token_id: "token-1", ad_account_id: null, page_id: null, authorization_status: "connected" };
    h.token = { id: "token-1", business_id: "biz", expires_at: future(), revoked_at: null };
    const { getMetaConnection } = await import("@/lib/meta/credentials");
    const c = await getMetaConnection("biz");
    expect(c).toMatchObject({ source: "oauth", pending: true, ready: false });
  });

  it("reports expired OAuth connections", async () => {
    h.connection = { business_id: "biz", token_id: "token-1", ad_account_id: "act_oauth", page_id: "pg_oauth", authorization_status: "connected" };
    h.token = { id: "token-1", business_id: "biz", expires_at: past(), revoked_at: null };
    const { getMetaConnection } = await import("@/lib/meta/credentials");
    const c = await getMetaConnection("biz");
    expect(c).toMatchObject({ source: "oauth", expired: true, ready: false });
  });

  it("reports no connection when nothing is stored", async () => {
    const { getMetaConnection } = await import("@/lib/meta/credentials");
    const c = await getMetaConnection("biz");
    expect(c).toMatchObject({ source: "none", ready: false, adAccountId: null });
  });
});
