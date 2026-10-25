import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import prepareTape from "./fixtures/meta/prepare.json";
import createTape from "./fixtures/meta/create.json";
import syncTape from "./fixtures/meta/sync.json";
import pauseTape from "./fixtures/meta/pause.json";

// #525: a managed (2-Tier) customer runs the same Prepare → PAUSED create → sync → pause as an
// OAuth customer, on their child's own system-user token (#624) and their own child ad account and Page.
// The Graph responses are the real recordings from one PAUSED Solaride test campaign
// (scripts/record-meta-core-fixtures.ts); the managed ledger row points at that ad account and
// Page, so the routing is real end to end. Only Supabase is stubbed.
vi.mock("@/lib/security/ssrf", () => ({
  fetchPublicUrl: async () => new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])),
}));
const mocks = vi.hoisted(() => ({ tables: [] as string[], rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "8c1f4f0e-5a43-4c55-9b1f-3f7a3f0c2a10" } } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: BUSINESS, owner_id: "8c1f4f0e-5a43-4c55-9b1f-3f7a3f0c2a10" }, error: null }) }) }) }),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    from: (table: string) => {
      mocks.tables.push(table);
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: table === "managed_meta_accounts" ? LEDGER : null, error: null }) };
      return query;
    },
  }),
}));

const BUSINESS = "6f0c2a10-5a43-4c55-9b1f-3f7a3f0c8c1f";
const PARENT_TOKEN = "parent-system-user-token";
const CHILD_TOKEN = "child-system-user-token";
const CHILD_ROW_ID = "00000000-0000-4000-8000-000000000624";
const KEY = Buffer.alloc(32, 7).toString("base64");
let LEDGER: Record<string, unknown>;
const BASE_LEDGER = {
  business_id: BUSINESS, state: "ready", child_business_id: "1158100643072999", ad_account_id: "act_2398686420592052",
  page_id: "885223068001054", funding_state: "card_attached", generation: 1, manager_token_id: CHILD_ROW_ID,
};
async function storedChildToken(overrides: Record<string, unknown> = {}) {
  const { encryptMetaToken } = await import("@/lib/meta/token-store");
  const sealed = encryptMetaToken(CHILD_TOKEN, { tokenId: CHILD_ROW_ID, businessId: BUSINESS });
  mocks.rpc.mockImplementation(async (name: string, args: Record<string, string>) => name === "meta_token_get" && args.p_token_id === CHILD_ROW_ID && args.p_business_id === BUSINESS
    ? { data: [{ id: CHILD_ROW_ID, business_id: BUSINESS, ciphertext: sealed.ciphertext, nonce: sealed.nonce, auth_tag: sealed.authTag, key_id: sealed.keyId,
      format_version: sealed.formatVersion, revoked_at: null, expires_at: null, data_access_expires_at: null, ...overrides }], error: null }
    : { data: [], error: null });
}
const campaignId = "120253646427440526";
type Exchange = { method: string; path: string; status: number; body: unknown };

function replay(...tapes: unknown[][]) {
  const pending = tapes.flat() as Exchange[];
  const tokens = new Set<string>();
  const posts: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const body = init?.body instanceof URLSearchParams ? init.body : null;
    const multipart = init?.body instanceof FormData ? init.body : null;
    tokens.add(url.searchParams.get("access_token") ?? body?.get("access_token") ?? String(multipart?.get("access_token") ?? "none"));
    url.searchParams.delete("access_token");
    const method = init?.method ?? "GET";
    const path = url.pathname.replace("/v21.0/", "") + url.search;
    if (method === "POST") posts.push(path);
    const index = pending.findIndex((exchange) => exchange.method === method && exchange.path === path);
    if (index < 0) throw new Error(`Unrecorded Graph call: ${method} ${path}`);
    const [exchange] = pending.splice(index, 1);
    return Response.json(exchange.body, { status: exchange.status });
  });
  return { pending, tokens, posts };
}

beforeEach(async () => {
  vi.resetModules();
  mocks.tables = [];
  mocks.rpc.mockReset();
  LEDGER = { ...BASE_LEDGER };
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: "https://core-test.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    META_CONNECT_ROLLOUT: "enabled", MANAGED_ACCOUNTS_ENABLED: "true", META_PARENT_SYSTEM_TOKEN: PARENT_TOKEN,
    META_TOKEN_ENCRYPTION_KEY: KEY,
  })) vi.stubEnv(name, value);
  await storedChildToken();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function managedCustomer() {
  const { requireOwnedBusiness, withMetaConnection } = await import("@/lib/meta/connection-access");
  return { context: await requireOwnedBusiness(BUSINESS), withMetaConnection };
}

describe("core: a managed customer's campaign runs on their child account (#525)", () => {
  it("prepares and launches PAUSED with the child's own token, on the child ad account and Page only", async () => {
    const tape = replay(prepareTape, createTape);
    const { context, withMetaConnection } = await managedCustomer();
    const created = await withMetaConnection(context, { purpose: "create_paused" }, async (meta, connection) => {
      expect(connection.generation).toBe(1);
      const forms = await meta.listLeadForms();
      const geo = await meta.resolveGeoTargeting(["Austin, Texas"], { cityScope: "city_only" });
      const audience = await meta.resolveAudienceInterests(["Chiropractic"]);
      return meta.createLeadCampaign({
        name: "AdBrain core fixture 2026-10-21T15:54 (PAUSED test)", dailyBudgetRupees: 200,
        leadFormId: forms[0].id, link: "https://adbrain.vanshul.com",
        creatives: [{ imageUrl: "https://example.com/ad.png", headline: "Diwali Renewal, Starting With Your Spine",
          message: "A $49 new-patient exam with a digital posture scan. Same-day and Saturday appointments.", cta: "Book Now" }],
        ageMin: 25, ageMax: 55, gender: "all", interests: audience.interests, location: geo.targeting, destination: "instant_form",
      });
    });
    expect(created.campaignId).toBe(campaignId);
    expect(tape.pending).toEqual([]);
    // Recorded paging links carry Meta's own token, redacted in the tape; every call AdBrain builds uses the child's.
    expect([...tape.tokens].filter((token) => token !== "REDACTED")).toEqual([CHILD_TOKEN]);
    expect(tape.posts.every((path) => path.startsWith(`${LEDGER.ad_account_id}/`))).toBe(true);
    expect(mocks.tables).not.toContain("meta_connections");
    expect(mocks.rpc.mock.calls.map(([name, args]) => [name, args])).toEqual([["meta_token_get", { p_token_id: CHILD_ROW_ID, p_business_id: BUSINESS }]]);
  });

  it("syncs and pauses through the same binding checks as an OAuth customer", async () => {
    const tape = replay(syncTape, pauseTape);
    const { context, withMetaConnection } = await managedCustomer();
    const listed = await withMetaConnection(context, { purpose: "read_insights" }, async (meta) =>
      (await meta.listCampaignsPage()).campaigns.find((campaign) => campaign.id === campaignId));
    expect(listed?.status).toBe("PAUSED");
    await withMetaConnection(context, { purpose: "pause", expectedGeneration: 1,
      binding: { adAccountId: String(LEDGER.ad_account_id), pageId: String(LEDGER.page_id) } }, (meta) => meta.updateCampaignStatus(campaignId, "PAUSED"));
    expect(tape.posts).toEqual([campaignId]);
    expect([...tape.tokens]).toEqual([CHILD_TOKEN]);
    await expect(withMetaConnection(context, { purpose: "pause", expectedGeneration: 1,
      binding: { adAccountId: "act_1", pageId: String(LEDGER.page_id) } }, (meta) => meta.updateCampaignStatus(campaignId, "PAUSED"))).rejects.toThrow(/no longer match/);
  });

  // #624 (CTO): no child token means no Meta call at all; the parent token is never a fallback.
  it("fails closed, without calling Meta, when the child token is missing, revoked, expired or another business's", async () => {
    const cases: [string, () => Promise<void>][] = [
      ["no token id", async () => { LEDGER = { ...BASE_LEDGER, manager_token_id: null }; }],
      ["deleted", async () => { mocks.rpc.mockResolvedValue({ data: [], error: null }); }],
      ["revoked", () => storedChildToken({ revoked_at: "2026-10-25T00:00:00Z" })],
      ["expired", () => storedChildToken({ expires_at: "2020-01-01T00:00:00Z" })],
      ["another business's row", () => storedChildToken({ business_id: "11111111-1111-4111-8111-111111111111" })],
      ["store down", async () => { mocks.rpc.mockResolvedValue({ data: null, error: { message: "down" } }); }],
    ];
    for (const [name, arrange] of cases) {
      LEDGER = { ...BASE_LEDGER };
      await storedChildToken();
      await arrange();
      const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("Meta must not be called"); });
      const { context, withMetaConnection } = await managedCustomer();
      for (const purpose of ["create_paused", "read_insights", "pause"] as const) {
        await expect(withMetaConnection(context, { purpose, expectedGeneration: 1, binding: { adAccountId: String(LEDGER.ad_account_id), pageId: String(LEDGER.page_id) } },
          async () => "ran"), `${name} ${purpose}`).rejects.toMatchObject({ code: "UNAVAILABLE" });
      }
      expect(fetch, name).not.toHaveBeenCalled();
      const { resolveMetaCredentials, getMetaConnection } = await import("@/lib/meta/credentials");
      expect(await resolveMetaCredentials(BUSINESS), name).toBeNull();
      expect(await getMetaConnection(BUSINESS), name).toMatchObject({ source: "managed", ready: false });
      vi.restoreAllMocks();
    }
  });
});
