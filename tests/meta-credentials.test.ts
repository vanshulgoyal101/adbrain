import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  connection: null as Record<string, unknown> | null,
  token: null as Record<string, unknown> | null,
  plaintext: "oauth-token",
  owner: null as string | null,
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
            data: table === "meta_connections" ? h.connection : table === "businesses" && h.owner ? { owner_id: h.owner } : null,
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
  h.owner = null;
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

  // #757: the earlier of the token's two expiries, so the owner can be warned before it lapses.
  it("reports when the token stops working: the earlier of expires_at and data_access_expires_at", async () => {
    const soon = new Date(Date.now() + 6 * 86_400_000).toISOString();
    h.connection = { business_id: "biz", token_id: "token-1", ad_account_id: "act_oauth", page_id: "pg_oauth", authorization_status: "connected" };
    h.token = { id: "token-1", business_id: "biz", expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(), data_access_expires_at: soon, revoked_at: null };
    const { getMetaConnection } = await import("@/lib/meta/credentials");
    expect(await getMetaConnection("biz")).toMatchObject({ ready: true, tokenExpiresAt: soon });
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

// #1649 (#1648): the business's client keeps the smoke account's pause-only rule (#1324), so a future write through
// metaClientForBusiness can't skip it; an unreadable owner means no client.
describe("metaClientForBusiness write mode (#1649)", () => {
  const connect = () => {
    h.connection = { business_id: "biz", token_id: "token-1", ad_account_id: "act_oauth", page_id: "pg_oauth", authorization_status: "connected" };
    h.token = { id: "token-1", business_id: "biz", ciphertext: "", nonce: "", auth_tag: "", key_id: "", format_version: "", expires_at: null, revoked_at: null };
  };
  const writes = (client: unknown) => (client as { writes: string }).writes;

  it("is pause-only for the smoke account's business and full for an owner's", async () => {
    connect();
    const { metaClientForBusiness } = await import("@/lib/meta/credentials");
    h.owner = "144e4745-7e6d-4fb9-a1fd-7edec31a335f";
    expect(writes(await metaClientForBusiness("biz"))).toBe("pause-only");
    h.owner = "55555555-5555-4555-8555-555555555555";
    expect(writes(await metaClientForBusiness("biz"))).toBe("all");
  });

  it("gives no client when the business's owner can't be read", async () => {
    connect();
    const { metaClientForBusiness } = await import("@/lib/meta/credentials");
    expect(await metaClientForBusiness("biz")).toBeNull();
  });
});
