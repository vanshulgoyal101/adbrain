import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import prepareTape from "./fixtures/meta/prepare.json";
import createTape from "./fixtures/meta/create.json";
import syncTape from "./fixtures/meta/sync.json";
import pauseTape from "./fixtures/meta/pause.json";

// #525: a managed (2-Tier) customer runs the same Prepare → PAUSED create → sync → pause as an
// OAuth customer, on the parent system user's token and their own child ad account and Page.
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
const LEDGER = {
  business_id: BUSINESS, state: "ready", child_business_id: "1158100643072999", ad_account_id: "act_2398686420592052",
  page_id: "885223068001054", funding_state: "funded", generation: 1,
};
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

beforeEach(() => {
  vi.resetModules();
  mocks.tables = [];
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: "https://core-test.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    META_CONNECT_ROLLOUT: "enabled", MANAGED_ACCOUNTS_ENABLED: "true", META_PARENT_SYSTEM_TOKEN: PARENT_TOKEN,
  })) vi.stubEnv(name, value);
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
  it("prepares and launches PAUSED with the parent token, on the child ad account and Page only", async () => {
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
    // Recorded paging links carry Meta's own token, redacted in the tape; every call AdBrain builds uses the parent's.
    expect([...tape.tokens].filter((token) => token !== "REDACTED")).toEqual([PARENT_TOKEN]);
    expect(tape.posts.every((path) => path.startsWith(`${LEDGER.ad_account_id}/`))).toBe(true);
    expect(mocks.tables).not.toContain("meta_connections");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("syncs and pauses through the same binding checks as an OAuth customer", async () => {
    const tape = replay(syncTape, pauseTape);
    const { context, withMetaConnection } = await managedCustomer();
    const listed = await withMetaConnection(context, { purpose: "read_insights" }, async (meta) =>
      (await meta.listCampaignsPage()).campaigns.find((campaign) => campaign.id === campaignId));
    expect(listed?.status).toBe("PAUSED");
    await withMetaConnection(context, { purpose: "pause", expectedGeneration: 1,
      binding: { adAccountId: LEDGER.ad_account_id, pageId: LEDGER.page_id } }, (meta) => meta.updateCampaignStatus(campaignId, "PAUSED"));
    expect(tape.posts).toEqual([campaignId]);
    expect([...tape.tokens]).toEqual([PARENT_TOKEN]);
    await expect(withMetaConnection(context, { purpose: "pause", expectedGeneration: 1,
      binding: { adAccountId: "act_1", pageId: LEDGER.page_id } }, (meta) => meta.updateCampaignStatus(campaignId, "PAUSED"))).rejects.toThrow(/no longer match/);
  });
});
