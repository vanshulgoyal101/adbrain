import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import syncTape from "./fixtures/meta/sync.json";
import resultsTape from "./fixtures/meta/results.json";
import cappedAdSetTape from "./fixtures/meta/safety/capped-adset.json";
import campaignSpendCapTape from "./fixtures/meta/safety/campaign-spend-cap.json";
import pauseAllTape from "./fixtures/meta/safety/pause-all.json";

// #649: the manage loop (pause, sync, refresh) through the real route handlers, connection access,
// MetaClient, trusted writes, spend enforcement and audit, on an OAuth connection with a token sealed
// by the real token store. Only Supabase (an in-memory table store) and the LLM are stubbed; every
// Graph call is answered from the recorded tapes and any other call fails the test.
// Recorded: the pause tree (safety/campaign-spend-cap binding + safety/pause-all), the sync listing
// and the bound campaign's ad sets (sync.json), and the live #157 run's insights and ad review
// (results.json). Synthesised from recorded bodies: the sync listing trimmed to campaigns whose ad
// sets were recorded, one of them moved to another ad account, and a #157 capped campaign whose
// ad set list is the recorded capped ad set read-back (safety/capped-adset). Activation is not
// covered: it needs capability, delivery and spend-cap reads plus an ACTIVE write, never recorded.
type Exchange = { method: string; path: string; status: number; body: unknown };
type Row = Record<string, unknown>;

const store = vi.hoisted(() => {
  const state = {
    tables: {} as Record<string, Row[]>, user: null as { id: string } | null, log: [] as string[], unknown: [] as string[],
    rpc: {} as Record<string, (args: Row) => { data: unknown; error: unknown }>, inserted: 0,
  };
  const known = ["businesses", "campaigns", "campaign_results", "meta_connections", "spend_limits"];
  const fail = (call: string): never => {
    state.unknown.push(call);
    throw new Error(`Unstubbed Supabase call: ${call}`);
  };
  function from(table: string) {
    if (!known.includes(table)) fail(`from(${table})`);
    const filters: Array<(row: Row) => boolean> = [];
    let write: { kind: "insert" | "update"; values: Row } | null = null;
    let count = false;
    const settle = () => {
      const rows = state.tables[table] ??= [];
      if (write?.kind === "insert") {
        const row = { id: `00000000-0000-4000-9000-${String(++state.inserted).padStart(12, "0")}`, created_at: new Date().toISOString(), ...write.values };
        rows.push(row);
        return { data: [{ ...row }], error: null, count: null };
      }
      const matched = rows.filter(row => filters.every(test => test(row)));
      if (write?.kind === "update") for (const row of matched) Object.assign(row, write.values);
      return { data: matched.map(row => ({ ...row })), error: null, count: count ? matched.length : null };
    };
    const query = {
      select: (_columns?: string, options?: { count?: string }) => { count ||= Boolean(options?.count); return query; },
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; },
      gt: (key: string, value: unknown) => { filters.push(row => String(row[key]) > String(value)); return query; },
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
    const handler = state.rpc[name] ?? fail(`rpc(${name})`);
    state.log.push(`rpc ${name}`);
    const result = Promise.resolve().then(() => handler(args));
    return Object.assign(result, { abortSignal: () => result });
  }
  const client = () => ({ auth: { getUser: async () => ({ data: { user: state.user }, error: null }) }, from, rpc });
  return { state, client };
});
const llm = vi.hoisted(() => ({ complete: vi.fn(async () => { throw new Error("No LLM call in a manage route."); }) }));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => store.client() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => store.client() }));
vi.mock("@/lib/llm", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/llm")>(), complete: llm.complete }));

const BUSINESS = "00000000-0000-4000-8000-000000000649";
const OWNER = "00000000-0000-4000-8000-000000000001";
const STRANGER = "00000000-0000-4000-8000-000000000002";
const SEAL_ID = "00000000-0000-4000-8000-000000000003";
const STORED = "00000000-0000-4000-8000-000000000004";
const ACCESS = "oauth-connection-access";
const ACCOUNT = "act_2398686420592052", PAGE = "885223068001054", GENERATION = 3;
const SYNCED = "120253646427440526", CAPPED = "120253655093920526", LIVE = "120253678786150526";
const TREE = { campaignId: "120253654207670526", adSetIds: ["120253654208240526"], adIds: ["120253654209040526"] };
const available = { state: "available", blockers: [] };
const ADSET_FIELDS = "fields=id%2Cstatus%2Cdaily_budget%2Clifetime_budget%2Cpromoted_object%2Cdestination_type&limit=100";

const tapes = {
  pause: [...(campaignSpendCapTape as Exchange[]).slice(0, 2), ...pauseAllTape as Exchange[]],
  results: (resultsTape as Exchange[]).filter(exchange => exchange.path.startsWith(LIVE)),
  sync: (campaignIds: string[]) => {
    const [listing, adSets] = syncTape as Exchange[];
    const recorded = listing.body as { data: Row[] };
    const capped = (cappedAdSetTape as Exchange[]).find(exchange => exchange.path.startsWith("120253655095920526?"))!.body as Row;
    const cappedBinding = ((cappedAdSetTape as Exchange[])[1].body as { data: Row[] }).data[0];
    const campaigns = [
      recorded.data.find(campaign => campaign.id === SYNCED)!,
      { ...recorded.data.find(campaign => campaign.id === "120253256980050526")!, account_id: "1000000000000001" },
      { id: CAPPED, name: "#157 capped run", status: "PAUSED", objective: "OUTCOME_LEADS", account_id: "2398686420592052" },
    ].filter(campaign => campaignIds.includes(String(campaign.id)));
    return [
      { ...listing, body: { ...recorded, data: campaigns } }, adSets,
      ...campaignIds.includes(CAPPED) ? [{ method: "GET", path: `${CAPPED}/adsets?${ADSET_FIELDS}`, status: 200, body: { data: [{
        id: capped.id, status: capped.status, daily_budget: capped.daily_budget, lifetime_budget: capped.lifetime_budget,
        promoted_object: cappedBinding.promoted_object, destination_type: cappedBinding.destination_type,
      }] } }] : [],
    ];
  },
};

const graph = { sent: [] as Array<{ method: string; path: string; form: Row; access: string | null }>, unrecorded: [] as string[], pending: [] as Exchange[] };
function replay(...recorded: Exchange[][]) {
  graph.pending = recorded.flat();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const body = new URLSearchParams(init?.body instanceof URLSearchParams ? init.body : undefined);
    const access = url.searchParams.get("access_token") ?? body.get("access_token");
    url.searchParams.delete("access_token");
    body.delete("access_token");
    const method = init?.method ?? "GET";
    const path = url.pathname.replace("/v21.0/", "") + url.search;
    graph.sent.push({ method, path, form: Object.fromEntries(body), access });
    const index = graph.pending.findIndex(exchange => exchange.method === method && exchange.path === path);
    if (index < 0) {
      graph.unrecorded.push(`${method} ${path}`);
      throw new Error(`Unrecorded Graph call: ${method} ${path}`);
    }
    const [exchange] = graph.pending.splice(index, 1);
    return Response.json(exchange.body, { status: exchange.status });
  });
}

async function connect(owner = OWNER, pageId = PAGE) {
  const { encryptMetaToken, toPostgresBytea } = await import("@/lib/meta/token-store");
  const sealed = encryptMetaToken(ACCESS, { tokenId: SEAL_ID, businessId: BUSINESS });
  store.state.tables.businesses = [{ id: BUSINESS, owner_id: owner, name: "Solaride", created_at: "2026-01-01T00:00:00Z" }];
  store.state.tables.meta_connections = [{
    business_id: BUSINESS, token_id: SEAL_ID, generation: GENERATION, authorization_status: "connected", meta_business_id: null,
    ad_account_id: ACCOUNT, page_id: pageId, account_name: "Solaride", page_name: "Solaride", currency: "INR",
    timezone_name: "Asia/Kolkata", last_checked_at: "2026-10-25T00:00:00Z",
    capabilities: { canReadInsights: available, canReadLeads: available, canCreatePaused: available, canActivate: available },
  }];
  store.state.rpc.meta_token_get = args => ({ error: null, data: args.p_token_id === SEAL_ID && args.p_business_id === BUSINESS ? [{
    id: SEAL_ID, business_id: BUSINESS, ciphertext: toPostgresBytea(sealed.ciphertext), nonce: toPostgresBytea(sealed.nonce),
    auth_tag: toPostgresBytea(sealed.authTag), key_id: sealed.keyId, format_version: sealed.formatVersion,
    revoked_at: null, expires_at: null, data_access_expires_at: null, granted_scopes: ["ads_management", "ads_read"],
  }] : [] });
}

function storeCampaign(values: Row) {
  const row = {
    id: STORED, business_id: BUSINESS, name: "Solaride stored", objective: "leads", status: "active", daily_budget: 200,
    meta_ad_account_id: ACCOUNT, meta_page_id: PAGE, meta_connection_generation: GENERATION, meta_ad_ids: [], raw: {}, ...values,
  };
  (store.state.tables.campaigns ??= []).push(row);
  return structuredClone(row);
}
const treeCampaign = (values: Row = {}) => storeCampaign({
  meta_campaign_id: TREE.campaignId, meta_adset_id: TREE.adSetIds[0], meta_ad_ids: TREE.adIds,
  raw: { source: "campaign_operation", metaResult: TREE }, ...values,
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });
async function pause(id = STORED) {
  const { PATCH } = await import("@/app/api/campaigns/[id]/route");
  return PATCH(new Request(`http://localhost/api/campaigns/${id}`, { method: "PATCH", body: JSON.stringify({ status: "paused" }) }), params(id));
}
async function sync() {
  const { POST } = await import("@/app/api/campaigns/sync/route");
  return POST(new Request("http://localhost/api/campaigns/sync", { method: "POST" }));
}
async function refresh(id = STORED) {
  const { POST } = await import("@/app/api/campaigns/[id]/refresh/route");
  return POST(new Request(`http://localhost/api/campaigns/${id}/refresh`, { method: "POST" }), params(id));
}

beforeEach(async () => {
  vi.resetModules();
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: "https://core-test.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    META_CONNECT_ROLLOUT: "enabled", META_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), MANAGED_ACCOUNTS_ENABLED: "",
  })) vi.stubEnv(name, value);
  Object.assign(store.state, { tables: {}, user: { id: OWNER }, log: [], unknown: [], inserted: 0, rpc: {
    append_verified_audit_event: () => ({ data: null, error: null }),
    // #245: operator-funded, so the spend guard needs no customer ledger (live payments are off in tests).
    operator_funded: () => ({ data: true, error: null }),
  } });
  Object.assign(graph, { sent: [], unrecorded: [], pending: [] });
  llm.complete.mockClear();
  await connect();
});
afterEach(() => {
  expect(store.state.unknown).toEqual([]);
  expect(graph.unrecorded).toEqual([]);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const audits = () => store.state.log.filter(entry => entry === "rpc append_verified_audit_event");

describe("core: manage routes against recorded Graph responses (#649)", () => {
  it("pause: pauses only the bound campaign tree, once, with the connection's token", async () => {
    treeCampaign();
    replay(tapes.pause);
    const response = await pause();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, status: "paused", pause: { confirmed: true } });
    const posts = graph.sent.filter(call => call.method === "POST");
    expect(posts.map(({ path, form }) => [path, form])).toEqual([TREE.campaignId, ...TREE.adSetIds, ...TREE.adIds].map(id => [id, { status: "PAUSED" }]));
    expect(posts.filter(call => call.path === TREE.campaignId)).toHaveLength(1);
    expect(new Set(graph.sent.map(call => call.access))).toEqual(new Set([ACCESS]));
    expect(graph.pending).toEqual([]);
    expect(store.state.tables.campaigns[0].status).toBe("paused");
    expect(audits()).toHaveLength(1);
  });

  it.each([
    ["another ad account", { meta_ad_account_id: "act_1000000000000001" }, 409],
    ["another Page", { meta_page_id: "100000000000002" }, 409],
    ["a stale connection generation", { meta_connection_generation: GENERATION - 1 }, 409],
    ["no stored binding", { meta_page_id: null }, 409],
  ])("pause: a campaign bound to %s is refused before any Meta call", async (_case, binding, status) => {
    const before = treeCampaign(binding);
    replay(tapes.pause);
    const response = await pause();
    expect(response.status).toBe(status);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(store.state.tables.campaigns).toEqual([before]);
  });

  it("sync: imports the campaign bound to the connected account and Page, and skips another account and an unknown capped tree", async () => {
    replay(tapes.sync([SYNCED, "120253256980050526", CAPPED]));
    const response = await sync();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ skipped: 2, nextCursor: null });
    expect(store.state.tables.campaigns).toEqual([expect.objectContaining({
      business_id: BUSINESS, name: "AdBrain core fixture 2026-10-21T15:54 (PAUSED test)", objective: "OUTCOME_LEADS",
      destination: "instant_form", daily_budget: 200, status: "paused", meta_campaign_id: SYNCED, meta_adset_id: "120253646428630526",
      meta_ad_account_id: ACCOUNT, meta_page_id: PAGE, meta_connection_generation: GENERATION,
    })]);
    expect(body.campaigns.map((campaign: Row) => campaign.meta_campaign_id)).toEqual([SYNCED]);
    expect(graph.sent.every(call => call.method === "GET" && call.access === ACCESS)).toBe(true);
    expect(graph.sent.map(call => call.path.split("?")[0])).not.toContain("120253256980050526/adsets");
    expect(graph.pending).toEqual([]);
  });

  it.each([
    ["ad account", { meta_ad_account_id: "act_1000000000000001" }],
    ["Page", { meta_page_id: "100000000000002" }],
  ])("sync: a stored row for the campaign on another %s is skipped, not overwritten", async (_case, binding) => {
    const before = storeCampaign({ meta_campaign_id: SYNCED, ...binding });
    replay(tapes.sync([SYNCED]));
    const response = await sync();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ skipped: 1 });
    expect(store.state.tables.campaigns).toEqual([before]);
    expect(store.state.log.filter(entry => /^(insert|update) /.test(entry))).toEqual([]);
    expect(graph.pending).toEqual([]);
  });

  it("sync: a connection on another Page imports nothing from the recorded account", async () => {
    await connect(OWNER, "100000000000002");
    replay(tapes.sync([SYNCED]));
    const response = await sync();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ skipped: 1, campaigns: [] });
    expect(store.state.tables.campaigns ?? []).toEqual([]);
    expect(graph.pending).toEqual([]);
  });

  it("refresh: writes one result row with the recorded insights for a correctly bound campaign", async () => {
    storeCampaign({ meta_campaign_id: LIVE, objective: "OUTCOME_ENGAGEMENT", destination: "whatsapp" });
    replay(tapes.results);
    const response = await refresh();
    expect(response.status).toBe(200);
    const recorded = (tapes.results.find(exchange => exchange.path.includes("/insights?"))!.body as { data: Row[] }).data[0];
    expect(store.state.tables.campaign_results).toEqual([expect.objectContaining({
      campaign_id: STORED, destination: "whatsapp", impressions: Number(recorded.impressions), clicks: Number(recorded.clicks),
      spend: Number(recorded.spend), leads: 0, conversations: 1, period_start: recorded.date_start, period_end: recorded.date_stop,
    })]);
    expect(await response.json()).toMatchObject({ autoPaused: [], protectionConfirmed: true, review: [{ state: "approved" }, { state: "approved" }] });
    expect(graph.sent.every(call => call.method === "GET" && call.access === ACCESS)).toBe(true);
    expect(graph.pending).toEqual([]);
    expect(llm.complete).not.toHaveBeenCalled();
    expect(audits()).toHaveLength(1);
  });

  it("refresh: a stale connection generation is refused before any Meta call", async () => {
    storeCampaign({ meta_campaign_id: LIVE, meta_connection_generation: GENERATION - 1 });
    replay(tapes.results);
    expect((await refresh()).status).toBe(409);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(store.state.tables.campaign_results ?? []).toEqual([]);
  });

  it("signed out: every manage route answers 401 with no Meta call", async () => {
    treeCampaign();
    store.state.user = null;
    replay(tapes.pause, tapes.sync([SYNCED]), tapes.results);
    expect([(await pause()).status, (await sync()).status, (await refresh()).status]).toEqual([401, 401, 401]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("another owner's business: every manage route refuses with no Meta call", async () => {
    await connect(STRANGER);
    treeCampaign();
    replay(tapes.pause, tapes.sync([SYNCED]), tapes.results);
    // Ownership is re-checked even if RLS let the row through; PATCH and refresh map FORBIDDEN to 400, sync to 403.
    const responses = [await pause(), await sync(), await refresh()];
    expect(responses.map(response => response.status)).toEqual([400, 403, 400]);
    expect(await responses[0].json()).toMatchObject({ error: "Business access is not allowed." });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(store.state.tables.campaigns[0].status).toBe("active");
    expect(store.state.log.filter(entry => /^(insert|update) /.test(entry))).toEqual([]);
  });
});
