import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/meta/ad-edit.json";

// #775 slice B: PATCH /api/campaigns/[id]/ads/[adId] through the real route, connection access, ad edit
// service, MetaClient, trusted write and audit, on a token sealed by the real token store (the harness is
// #773's edit-routes.test.ts). Graph is answered from ad-edit.json: #499's paused ad and creative as Meta
// stores them, and Meta's validate_only answers for the edited creative and the swap. The real create and
// swap answers are synthesised (ids only), as the recording created nothing.
type Row = Record<string, unknown>;

const store = vi.hoisted(() => {
  const state = { tables: {} as Record<string, Row[]>, user: null as { id: string } | null, log: [] as string[], inserted: 0, rpc: {} as Record<string, (args: Row) => { data: unknown; error: unknown }> };
  const known = ["audit_log", "businesses", "campaigns", "campaign_edit_operations", "meta_connections", "spend_limits"];
  function from(table: string) {
    if (!known.includes(table)) throw new Error(`Unstubbed Supabase call: from(${table})`);
    const filters: Array<(row: Row) => boolean> = [];
    let write: { kind: "insert" | "update"; values: Row } | null = null;
    const settle = () => {
      const rows = state.tables[table] ??= [];
      if (write?.kind === "insert") {
        const row = { id: `00000000-0000-4000-9000-${String(++state.inserted).padStart(12, "0")}`, created_at: new Date().toISOString(), ...write.values };
        rows.push(row);
        return { data: [{ ...row }], error: null };
      }
      const matched = rows.filter(row => filters.every(test => test(row)));
      if (write?.kind === "update") for (const row of matched) Object.assign(row, write.values);
      return { data: matched.map(row => ({ ...row })), error: null };
    };
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; },
      in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return query; },
      order: () => query, limit: () => query, abortSignal: () => query,
      insert: (values: Row) => { state.log.push(`insert ${table}`); write = { kind: "insert", values }; return query; },
      update: (values: Row) => { state.log.push(`update ${table}`); write = { kind: "update", values }; return query; },
      maybeSingle: async () => {
        const { data } = settle();
        return data.length > 1 ? { data: null, error: { message: "multiple rows" } } : { data: data[0] ?? null, error: null };
      },
      single: async () => {
        const { data } = settle();
        return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { message: "not one row" } };
      },
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(settle).then(resolve, reject),
    };
    return query;
  }
  function rpc(name: string, args: Row) {
    const handler = state.rpc[name];
    if (!handler) throw new Error(`Unstubbed Supabase call: rpc(${name})`);
    const result = Promise.resolve().then(() => handler(args));
    return Object.assign(result, { abortSignal: () => result });
  }
  return { state, client: () => ({ auth: { getUser: async () => ({ data: { user: state.user }, error: null }) }, from, rpc }) };
});
const capabilities = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => store.client() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => store.client() }));
vi.mock("@/lib/meta/capability-verification", () => ({ verifyMetaCapabilities: capabilities.verify }));
vi.mock("@/lib/llm", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/llm")>(), complete: async () => { throw new Error("No LLM call in an edit route."); } }));

const BUSINESS = "00000000-0000-4000-8000-000000000773";
const OWNER = "00000000-0000-4000-8000-000000000001";
const SEAL_ID = "00000000-0000-4000-8000-000000000003";
const ACCOUNT = "act_2398686420592052", PAGE = "885223068001054", GENERATION = 3;
const available = { state: "available", blockers: [] };

const AD = "120253710001120526", META_CAMPAIGN = "120253709994100526", ADSET = "120253709998340526";
const CAMPAIGN = "00000000-0000-4000-8000-000000000775";

type Answer = { status: number; body: unknown };
const graph = { sent: [] as Array<{ method: string; path: string; form: Record<string, string> }> };
function replay(overrides: { createCreative?: Answer; swap?: Answer; validateCreative?: Answer } = {}) {
  graph.sent = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    url.searchParams.delete("access_token");
    const method = init?.method ?? "GET";
    const path = decodeURIComponent(url.pathname.replace("/v21.0/", "") + url.search);
    const form = init?.body instanceof URLSearchParams ? Object.fromEntries([...init.body].filter(([key]) => key !== "access_token")) : {};
    graph.sent.push({ method, path, form });
    const validateOnly = form.execution_options === JSON.stringify(["validate_only"]);
    const answer = (value: Answer) => Response.json(value.body, { status: value.status });
    if (method === "GET" && path.startsWith(`${AD}?fields=id,account_id,creative`)) return Response.json({ ...recorded.ad, id: AD });
    if (method === "GET" && path === `${AD}?fields=creative{id}`) return Response.json({ creative: { id: "NEW_CREATIVE" } });
    if (method === "POST" && path === `${ACCOUNT}/adcreatives`) return validateOnly ? answer(overrides.validateCreative ?? recorded.validated.creative) : answer(overrides.createCreative ?? { status: 200, body: { id: "NEW_CREATIVE" } });
    if (method === "POST" && path === AD) return validateOnly ? answer(recorded.validated.swap) : answer(overrides.swap ?? { status: 200, body: { success: true } });
    throw new Error(`Unrecorded Graph call: ${method} ${path}`);
  });
}
const posts = () => graph.sent.filter(call => call.method === "POST" && !call.form.execution_options);

async function connect() {
  const { encryptMetaToken, toPostgresBytea } = await import("@/lib/meta/token-store");
  const sealed = encryptMetaToken("oauth-connection-access", { tokenId: SEAL_ID, businessId: BUSINESS });
  store.state.tables.businesses = [{ id: BUSINESS, owner_id: OWNER, name: "Solaride", created_at: "2026-01-01T00:00:00Z" }];
  store.state.tables.meta_connections = [{
    business_id: BUSINESS, token_id: SEAL_ID, generation: GENERATION, authorization_status: "connected", meta_business_id: null,
    ad_account_id: ACCOUNT, page_id: PAGE, account_name: "Solaride", page_name: "Solaride", currency: "INR",
    timezone_name: "Asia/Kolkata", last_checked_at: "2026-10-25T00:00:00Z",
    capabilities: { canReadInsights: available, canReadLeads: available, canCreatePaused: available, canActivate: available },
  }];
  store.state.rpc.meta_token_get = args => ({ error: null, data: args.p_token_id === SEAL_ID && args.p_business_id === BUSINESS ? [{
    id: SEAL_ID, business_id: BUSINESS, ciphertext: toPostgresBytea(sealed.ciphertext), nonce: toPostgresBytea(sealed.nonce),
    auth_tag: toPostgresBytea(sealed.authTag), key_id: sealed.keyId, format_version: sealed.formatVersion,
    revoked_at: null, expires_at: null, data_access_expires_at: null, granted_scopes: ["ads_management", "ads_read"],
  }] : [] });
}

function seedCampaign(values: Row = {}) {
  store.state.tables.campaigns = [{
    id: CAMPAIGN, business_id: BUSINESS, name: "Solaride | Free Survey", objective: "OUTCOME_ENGAGEMENT", status: "active", daily_budget: 300,
    meta_ad_account_id: ACCOUNT, meta_page_id: PAGE, meta_connection_generation: GENERATION,
    meta_campaign_id: META_CAMPAIGN, meta_adset_id: ADSET, meta_ad_ids: [AD],
    raw: { source: "campaign_operation", metaResult: { campaignId: META_CAMPAIGN, adSetIds: [ADSET], adIds: [AD] } }, ...values,
  }];
  store.state.tables.businesses![0] = { ...store.state.tables.businesses![0], offers: ["Free solar site survey"], usps: [], description: "Rooftop solar", vertical: "solar energy" };
}

async function patchAd(change: Row, idempotencyKey = "ad-edit-key-0001", adId = AD) {
  const { PATCH } = await import("@/app/api/campaigns/[id]/ads/[adId]/route");
  const response = await PATCH(new Request(`https://adbrain.vanshul.com/api/campaigns/${CAMPAIGN}/ads/${adId}`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ change, idempotencyKey }),
  }), { params: Promise.resolve({ id: CAMPAIGN, adId }) });
  return { status: response.status, body: await response.json() };
}
const operation = () => store.state.tables.campaign_edit_operations?.[0] as Row | undefined;

beforeEach(async () => {
  vi.resetModules();
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: "https://core-test.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    META_CONNECT_ROLLOUT: "enabled", META_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), MANAGED_ACCOUNTS_ENABLED: "",
  })) vi.stubEnv(name, value);
  Object.assign(store.state, { tables: {}, user: { id: OWNER }, log: [], inserted: 0, rpc: {
    append_verified_audit_event: () => ({ data: null, error: null }),
  } });
  capabilities.verify.mockImplementation(async (_meta: unknown, connection: Row) => connection.capabilities);
  await connect();
  seedCampaign();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("core: edit a launched ad's words through the route (#775)", () => {
  it("swaps a new creative onto the ad, records the envelope and mirror, and says it goes back to review", async () => {
    replay();
    const result = await patchAd(recorded.edit);
    expect(result.status).toBe(200);
    expect(result.body.result).toEqual({ adId: AD, previousCreativeId: recorded.ad.creative.id, creativeId: "NEW_CREATIVE", consequence: expect.stringContaining("Meta review"), replay: false });
    expect(posts().map(call => call.path)).toEqual([`${ACCOUNT}/adcreatives`, AD]);
    expect(posts()[0].form).toEqual(recorded.form);
    expect(operation()).toMatchObject({ kind: "ad_creative", state: "succeeded", phase: "complete", transmitted: true,
      before: { ad_id: AD, previous_creative_id: recorded.ad.creative.id }, change: recorded.edit });
    expect((store.state.tables.campaigns![0].raw as Row).adCreatives).toEqual({ [AD]: "NEW_CREATIVE" });
  });

  it("replays the same change by key without calling Meta again, and refuses the key for a different change", async () => {
    replay();
    await patchAd(recorded.edit);
    replay();
    const again = await patchAd(recorded.edit);
    expect(again.body.result).toMatchObject({ creativeId: "NEW_CREATIVE", replay: true });
    expect(graph.sent).toEqual([]);
    expect((await patchAd({ message: "Different words for the same key." })).status).toBe(409);
  });

  it("refuses a claim the Brand doesn't support, before any Meta call", async () => {
    replay();
    const result = await patchAd({ message: "Guaranteed subsidy on every rooftop." });
    expect(result.status).toBe(422);
    expect(graph.sent).toEqual([]);
    expect(store.state.tables.campaign_edit_operations ?? []).toEqual([]);
  });

  it("refuses an ad that isn't part of the campaign", async () => {
    replay();
    expect((await patchAd(recorded.edit, "ad-edit-key-0002", "120253700000000000")).status).toBe(404);
    expect(graph.sent).toEqual([]);
  });

  it("a creative Meta refuses at validate_only ends failed with nothing sent, so it can be retried", async () => {
    replay({ validateCreative: { status: 400, body: { error: { message: "Invalid parameter", type: "OAuthException", code: 100, error_subcode: 1487390 } } } });
    expect((await patchAd(recorded.edit)).status).toBeGreaterThanOrEqual(400);
    expect(posts()).toEqual([]);
    expect(operation()).toMatchObject({ state: "failed", transmitted: false });
  });

  it("a swap that fails after the new creative exists needs reconciliation and keeps the new id", async () => {
    replay({ swap: { status: 500, body: { error: { message: "An unknown error has occurred.", type: "OAuthException", code: 1 } } } });
    expect((await patchAd(recorded.edit)).status).toBeGreaterThanOrEqual(400);
    expect(operation()).toMatchObject({ state: "needs_reconciliation", transmitted: true, result: { new_creative_id: "NEW_CREATIVE" } });
    expect((store.state.tables.campaigns![0].raw as Row).adCreatives).toBeUndefined();
  });
});
