import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import syncTape from "./fixtures/meta/sync.json";
import resultsTape from "./fixtures/meta/results.json";
import cappedAdSetTape from "./fixtures/meta/safety/capped-adset.json";
import campaignSpendCapTape from "./fixtures/meta/safety/campaign-spend-cap.json";
import pauseAllTape from "./fixtures/meta/safety/pause-all.json";
import tokenRevoked from "./fixtures/meta/token-revoked.json";
import deliveryTape from "./fixtures/meta/delivery.json";
import fundingTape from "./fixtures/meta/account-funding-live-runs.json";
import deletedTape from "./fixtures/meta/campaign-deleted.json";
import goneFixture from "./fixtures/meta/campaigns-gone.json";
import whatsappValidateTape from "./fixtures/meta/whatsapp-adset-validate.json";
import cleanupRefusals from "./fixtures/meta/create-cleanup-refusals.json";

// #649: the manage loop (pause, sync, refresh, activation review and refusals) through the real route
// handlers, connection access, MetaClient, trusted writes, spend enforcement and audit, on an OAuth
// connection with a token sealed by the real token store. Only Supabase (an in-memory table store),
// the LLM and the capability re-check (its account/Page/permission reads were never recorded; it
// returns the stored "available" capabilities) are stubbed; every Graph call is answered from the
// recorded tapes and any other call fails the test.
// Recorded: the pause tree (safety/campaign-spend-cap binding + safety/pause-all), the sync listing
// and the bound campaign's ad sets (sync.json), the live #157 run's insights and ad review
// (results.json), the paused launch's delivery reads (delivery.json) and the ad account's funding
// with its running capped runs (account-funding-live-runs.json, both read at the same moment, #1058).
// Synthesised from recorded bodies: the sync listing trimmed to campaigns whose ad sets were recorded, one of them moved to another ad account, and a #157 capped campaign
// whose ad set list is the recorded capped ad set read-back (safety/capped-adset).
// Activation: GET /api/campaigns/[id] returns the recorded delivery (and funding when operator-funded);
// PATCH "active" is refused for a stale digest, another connection generation, the weekly cap, an
// operator-funded cap above the recorded funding room and, uncapped, the recorded paused children,
// with no Graph write. The success path (spend cap and ACTIVE writes) is still unrecorded.
type Exchange = { method: string; path: string; status: number; body: unknown };
type Row = Record<string, unknown>;

const store = vi.hoisted(() => {
  const state = {
    tables: {} as Record<string, Row[]>, user: null as { id: string } | null, log: [] as string[], unknown: [] as string[],
    rpc: {} as Record<string, (args: Row) => { data: unknown; error: unknown }>, inserted: 0,
  };
  const known = ["audit_log", "businesses", "campaign_edit_operations", "campaigns", "campaign_results", "meta_connections", "spend_limits"];
  const fail = (call: string): never => {
    state.unknown.push(call);
    throw new Error(`Unstubbed Supabase call: ${call}`);
  };
  function from(table: string) {
    if (!known.includes(table)) fail(`from(${table})`);
    const filters: Array<(row: Row) => boolean> = [];
    let write: { kind: "insert" | "update" | "delete"; values: Row } | null = null;
    let count = false, withResults = false;
    let sort: { key: string; ascending: boolean } | null = null, take: number | null = null;
    const settle = () => {
      const rows = state.tables[table] ??= [];
      if (write?.kind === "insert") {
        const row = { id: `00000000-0000-4000-9000-${String(++state.inserted).padStart(12, "0")}`, created_at: new Date().toISOString(), ...write.values };
        rows.push(row);
        return { data: [{ ...row }], error: null, count: null };
      }
      const matched = rows.filter(row => filters.every(test => test(row)));
      if (sort && !write) {
        const { key, ascending } = sort;
        matched.sort((a, b) => (ascending ? 1 : -1) * String(a[key]).localeCompare(String(b[key])));
      }
      if (take !== null && !write) matched.splice(take);
      if (write?.kind === "update") for (const row of matched) Object.assign(row, write.values);
      if (write?.kind === "delete") state.tables[table] = rows.filter(row => !matched.includes(row));
      // getLatestResults' `campaign_results!inner(*)` embed: each campaign's newest result, campaigns without one dropped.
      const data = matched.map(row => withResults ? { ...row, campaign_results: (state.tables.campaign_results ?? [])
        .filter(result => result.campaign_id === row.id).sort((a, b) => String(b.fetched_at).localeCompare(String(a.fetched_at))).slice(0, 1) } : { ...row })
        .filter(row => !withResults || (row.campaign_results as Row[]).length);
      return { data, error: null, count: count ? matched.length : null };
    };
    const query = {
      select: (columns?: string, options?: { count?: string }) => {
        count ||= Boolean(options?.count);
        withResults ||= Boolean(columns?.includes("campaign_results!inner"));
        return query;
      },
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; },
      in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return query; },
      gt: (key: string, value: unknown) => { filters.push(row => String(row[key]) > String(value)); return query; },
      order: (key: string, options?: { ascending?: boolean }) => { sort = { key, ascending: options?.ascending ?? true }; return query; },
      limit: (n: number) => { take = n; return query; },
      abortSignal: () => query,
      insert: (values: Row) => { state.log.push(`insert ${table}`); write = { kind: "insert", values }; return query; },
      update: (values: Row) => { state.log.push(`update ${table}`); write = { kind: "update", values }; return query; },
      delete: () => { state.log.push(`delete ${table}`); write = { kind: "delete", values: {} }; return query; },
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
// The capability reads (account, Pages, permissions, insights, lead forms) were never recorded; the
// re-check before activation gets the connection's stored "available" capabilities instead.
const capabilities = vi.hoisted(() => ({ verify: vi.fn() }));
const llm = vi.hoisted(() => ({ complete: vi.fn(async () => { throw new Error("No LLM call in a manage route."); }) }));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => store.client() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => store.client() }));
vi.mock("@/lib/meta/capability-verification", () => ({ verifyMetaCapabilities: capabilities.verify }));
vi.mock("@/lib/llm", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/llm")>(), complete: llm.complete }));
// #2312: the owner's language cookie; unset (English) unless a test sets it.
const lang = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => (name === "adbrain_lang" && lang.value ? { value: lang.value } : undefined) }) }));

const BUSINESS = "00000000-0000-4000-8000-000000000649";
const OWNER = "00000000-0000-4000-8000-000000000001";
const STRANGER = "00000000-0000-4000-8000-000000000002";
const SEAL_ID = "00000000-0000-4000-8000-000000000003";
const STORED = "00000000-0000-4000-8000-000000000004";
const ACCESS = "oauth-connection-access";
const ACCOUNT = "act_9000000000000001", PAGE = "900000000000002", GENERATION = 3;
const SYNCED = "120253646427440526", CAPPED = "120253655093920526", LIVE = "120253678786150526";
const TREE = { campaignId: "120253654207670526", adSetIds: ["120253654208240526"], adIds: ["120253654209040526"] };
const REVIEWED = { campaignId: SYNCED, adSetIds: ["120253646428630526"], adIds: ["120253646430200526"] };
const available = { state: "available", blockers: [] };
const ADSET_FIELDS = "fields=id%2Cstatus%2Cdaily_budget%2Clifetime_budget%2Cpromoted_object%2Cdestination_type&limit=100";

const tapes = {
  delivery: deliveryTape as Exchange[],
  // Scrubbed (#1094): its fake ad account is mapped onto this file's recorded account.
  funding: JSON.parse(JSON.stringify(fundingTape.tape).replaceAll(fundingTape.adAccountId, ACCOUNT)) as Exchange[],
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
      { id: CAPPED, name: "#157 capped run", status: "PAUSED", objective: "OUTCOME_LEADS", account_id: "9000000000000001" },
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
  graph.sent = [];
  vi.spyOn(globalThis, "fetch").mockClear().mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const body = new URLSearchParams(init?.body instanceof URLSearchParams ? init.body : undefined);
    // #1649: the token rides in the Authorization header; the proof is stripped for matching.
    const access = new Headers(init?.headers).get("authorization")?.replace(/^Bearer /, "") ?? null;
    url.searchParams.delete("appsecret_proof");
    body.delete("appsecret_proof");
    const method = init?.method ?? "GET";
    const path = url.pathname.replace("/v26.0/", "") + url.search;
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

// The recorded paused launch whose delivery reads are in delivery.json, stored as AdBrain launched it.
const reviewedCampaign = (values: Row = {}) => storeCampaign({
  status: "paused", meta_campaign_id: REVIEWED.campaignId, meta_adset_id: REVIEWED.adSetIds[0], meta_ad_ids: REVIEWED.adIds,
  raw: { source: "campaign_operation", metaResult: REVIEWED }, ...values,
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });
async function pause(id = STORED) {
  const { PATCH } = await import("@/app/api/campaigns/[id]/route");
  return PATCH(new Request(`http://localhost/api/campaigns/${id}`, { method: "PATCH", body: JSON.stringify({ status: "paused" }) }), params(id));
}
async function review(id = STORED) {
  const { GET } = await import("@/app/api/campaigns/[id]/route");
  return GET(new Request(`http://localhost/api/campaigns/${id}`), params(id));
}
async function activate(body: Row, id = STORED) {
  const { PATCH } = await import("@/app/api/campaigns/[id]/route");
  return PATCH(new Request(`http://localhost/api/campaigns/${id}`, { method: "PATCH", body: JSON.stringify({ status: "active", ...body }) }), params(id));
}
/** The digest the Campaigns card confirms (src/components/campaigns.tsx), over the reviewed delivery. */
async function digest(campaign: Row, delivery: unknown, capDays?: number) {
  const { activationConfirmationPayload } = await import("@/lib/campaign/activation");
  const { createHash } = await import("node:crypto");
  const connection = { generation: GENERATION, selected: {
    metaBusinessId: null, adAccountId: ACCOUNT, accountName: "Solaride", pageId: PAGE, pageName: "Solaride", currency: "INR", timezoneName: "Asia/Kolkata",
  } };
  return createHash("sha256").update(activationConfirmationPayload(campaign as never, connection as never, delivery as never, capDays)).digest("hex");
}
async function sync() {
  const { POST } = await import("@/app/api/campaigns/sync/route");
  return POST(new Request("http://localhost/api/campaigns/sync", { method: "POST" }));
}
async function remove(id = STORED) {
  const { DELETE } = await import("@/app/api/campaigns/[id]/route");
  return DELETE(new Request(`http://localhost/api/campaigns/${id}`, { method: "DELETE" }), params(id));
}
async function refresh(id = STORED, query = "") {
  const { POST } = await import("@/app/api/campaigns/[id]/refresh/route");
  return POST(new Request(`http://localhost/api/campaigns/${id}/refresh${query}`, { method: "POST" }), params(id));
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
  capabilities.verify.mockReset().mockResolvedValue({ canReadInsights: available, canReadLeads: available, canCreatePaused: available, canActivate: available });
  await connect();
});
afterEach(() => {
  lang.value = undefined;
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

  // #1961: pause is the owner's safety stop. A waiting new-audience copy (#1518) refuses activation, never a pause.
  it("pause: still pauses the whole tree in Meta while a new audience waits to be switched on", async () => {
    treeCampaign();
    store.state.tables.campaign_edit_operations = [{ id: "op-waiting", campaign_id: STORED, kind: "audience", state: "awaiting_switch", phase: "copy" }];
    replay(tapes.pause);
    const response = await pause();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, status: "paused", pause: { confirmed: true } });
    expect(writes().map(({ path, form }) => [path, form])).toEqual([TREE.campaignId, ...TREE.adSetIds, ...TREE.adIds].map(id => [id, { status: "PAUSED" }]));
    expect(graph.pending).toEqual([]);
    expect(store.state.tables.campaigns[0].status).toBe("paused");
  });

  // #1961: Meta throttling the account (#1838) must not leave anything that refuses the owner's next pause.
  it("pause: right after Meta throttles the account, the owner's retry still reaches Meta and pauses", async () => {
    treeCampaign();
    const throttled = { ...tapes.pause[0], status: 400, body: { error: { message: "There have been too many calls to this ad-account.", type: "OAuthException", code: 17, error_subcode: 2446079 } } };
    replay([throttled]);
    const first = await pause();
    expect(first.status).not.toBe(200);
    expect(writes()).toEqual([]);
    expect(store.state.tables.campaigns[0].status).toBe("active");
    replay(tapes.pause);
    const retry = await pause();
    expect(retry.status).toBe(200);
    expect(writes().map(({ path }) => path)).toEqual([TREE.campaignId, ...TREE.adSetIds, ...TREE.adIds]);
    expect(graph.pending).toEqual([]);
    expect(store.state.tables.campaigns[0].status).toBe("paused");
  });

  // #757: Meta stops accepting the token (password change, checkpoint) with no deauthorize callback.
  it("pause: a recorded Graph 190 names Ads Manager, writes nothing, and flips the connection to reauth_required", async () => {
    treeCampaign();
    replay([{ ...(tapes.pause[0]), status: tokenRevoked.status, body: tokenRevoked.body }]);
    store.state.rpc.meta_connection_mark_reauth = args => {
      const row = store.state.tables.meta_connections.find(r => r.business_id === args.p_business_id && r.generation === args.p_generation && r.authorization_status === "connected");
      if (row) row.authorization_status = "reauth_required";
      return { data: Boolean(row), error: null };
    };
    const response = await pause();
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("META_REAUTH");
    expect(body.error).toBe("Meta stopped accepting AdBrain's access, so we couldn't pause this campaign. Pause it in Ads Manager now, then reconnect Facebook in Settings.");
    expect(graph.sent.filter(call => call.method !== "GET")).toEqual([]);
    expect(store.state.log).toContain("rpc meta_connection_mark_reauth");
    expect(store.state.tables.meta_connections[0].authorization_status).toBe("reauth_required");
    const { getMetaConnection } = await import("@/lib/meta/credentials");
    expect(await getMetaConnection(BUSINESS)).toMatchObject({ expired: true, ready: false });
  });

  it("#2312: the same refusal reads in Hindi for a हिन्दी owner, with the status and code unchanged", async () => {
    treeCampaign();
    replay([{ ...(tapes.pause[0]), status: tokenRevoked.status, body: tokenRevoked.body }]);
    store.state.rpc.meta_connection_mark_reauth = () => ({ data: true, error: null });
    lang.value = "hi";
    const response = await pause();
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("META_REAUTH");
    expect(body.error).toBe("Meta ने AdBrain की पहुँच मानना बंद कर दिया, इसलिए हम यह कैंपेन रोक नहीं पाए। अभी इसे Ads Manager में रोकें, फिर सेटिंग में Facebook दोबारा जोड़ें।");
    expect(graph.sent.filter(call => call.method !== "GET")).toEqual([]);
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

  it("#1003: a background refresh reads Meta once when results are stale, then answers from the stored row while fresh", async () => {
    storeCampaign({ meta_campaign_id: LIVE, objective: "OUTCOME_ENGAGEMENT", destination: "whatsapp" });
    const stale = new Date(Date.now() - 20 * 60_000).toISOString();
    store.state.tables.campaign_results = [{ id: "r-old", campaign_id: STORED, fetched_at: stale, impressions: 1, clicks: 0, leads: 0, spend: 0 }];
    replay(tapes.results);
    const first = await refresh(STORED, "?ifStale=1");
    expect(first.status).toBe(200);
    const recorded = (tapes.results.find(exchange => exchange.path.includes("/insights?"))!.body as { data: Row[] }).data[0];
    expect((await first.json()).result).toMatchObject({ campaign_id: STORED, impressions: Number(recorded.impressions), spend: Number(recorded.spend), conversations: 1 });
    expect(graph.sent.length).toBeGreaterThan(0);
    expect(graph.pending).toEqual([]);
    expect(store.state.tables.campaign_results).toHaveLength(2);

    // Fresh now: the next open gets the stored row back with no Graph call, no new row and no audit.
    store.state.tables.campaign_results.find(row => row.id !== "r-old")!.fetched_at = new Date().toISOString();
    replay();
    const second = await refresh(STORED, "?ifStale=1");
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ fresh: true, result: { campaign_id: STORED, impressions: Number(recorded.impressions) } });
    expect(graph.sent).toEqual([]);
    expect(store.state.tables.campaign_results).toHaveLength(2);
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

  const writes = () => graph.sent.filter(call => call.method !== "GET");
  const deliveryReads = tapes.delivery.map(exchange => `GET ${exchange.path}`);

  it("activation review: returns the recorded delivery and account funding with reads only", async () => {
    reviewedCampaign();
    replay(tapes.delivery, tapes.funding);
    const response = await review();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      delivery: {
        campaign: { id: REVIEWED.campaignId, status: "PAUSED", effectiveStatus: "PAUSED" },
        adSets: [expect.objectContaining({ id: REVIEWED.adSetIds[0], status: "PAUSED", effectiveStatus: "IN_PROCESS", dailyBudgetPaise: 20000, pageId: PAGE, destinationType: "ON_AD" })],
        ads: [{ id: REVIEWED.adIds[0], status: "PAUSED", effectiveStatus: "IN_PROCESS", adSetId: REVIEWED.adSetIds[0], creativeId: "1148404661464451" }],
      },
      funding: { spendCapPaise: 182204, amountSpentPaise: 123717, roomPaise: 58487, prepay: true, committed: { runs: 1, remainingPaise: 45000, uncapped: { adSets: 0, dailyPaise: 0 } } },
      spendLimitRequired: true,
      learning: { costPerResultRupees: null, pausedAt: null },
    });
    expect(capabilities.verify).toHaveBeenCalledWith(ACCESS, expect.objectContaining({ adAccountId: ACCOUNT, pageId: PAGE }));
    expect(writes()).toEqual([]);
    expect(new Set(graph.sent.map(call => call.access))).toEqual(new Set([ACCESS]));
    expect(graph.pending).toEqual([]);
    expect(store.state.tables.campaigns[0].status).toBe("paused");
  });

  // #759: with managed accounts off, a business that isn't operator-funded is on its own ad account: it pays
  // Meta directly, so the review reads Meta's funding too, but no spending limit is required.
  it("activation review: an own-account business gets the delivery and Meta funding, with no limit required", async () => {
    store.state.rpc.operator_funded = () => ({ data: false, error: null });
    reviewedCampaign();
    replay(tapes.delivery, tapes.funding);
    const response = await review();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ funding: { spendCapPaise: 182204, roomPaise: 58487, committed: { runs: 1, remainingPaise: 45000, uncapped: { adSets: 0, dailyPaise: 0 } } }, spendLimitRequired: false });
    expect(body.delivery.campaign).toEqual({ id: REVIEWED.campaignId, status: "PAUSED", effectiveStatus: "PAUSED" });
    expect(writes()).toEqual([]);
  });

  it("activate: a stale confirmation digest is refused after the recorded delivery reads, with no write", async () => {
    const campaign = reviewedCampaign();
    replay(tapes.delivery, tapes.funding);
    const { delivery } = await (await review()).json();
    replay(tapes.delivery);
    // Confirmed for a 3-day run, then sent as a 5-day one: the reviewed terms no longer match.
    const response = await activate({ confirmationDigest: await digest(campaign, delivery, 3), connectionGeneration: GENERATION, capDays: 5 });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "Campaign or child review changed; review the current Meta delivery settings again." });
    expect(graph.sent.map(call => `${call.method} ${call.path}`).sort()).toEqual([...deliveryReads].sort());
    expect(writes()).toEqual([]);
    expect(store.state.tables.campaigns[0].status).toBe("paused");
    expect(audits()).toEqual([]);
  });

  // #1217: one Meta 5xx during the capability re-check used to be saved as 'unknown' and read as a permissions problem.
  it("#1217 activate: Meta not answering the re-check returns a retryable 503, stores nothing and makes no Meta write", async () => {
    const campaign = reviewedCampaign();
    replay(tapes.delivery, tapes.funding);
    const { delivery } = await (await review()).json();
    const stored = structuredClone(store.state.tables.meta_connections[0].capabilities);
    const { ConnectionAccessError } = await import("@/lib/meta/connection-access-error");
    capabilities.verify.mockRejectedValueOnce(new ConnectionAccessError("UNAVAILABLE", "Meta didn't answer. Try again.", { retryable: true }));
    replay(tapes.delivery);
    const response = await activate({ confirmationDigest: await digest(campaign, delivery, 3), connectionGeneration: GENERATION, capDays: 3 });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "Meta didn't answer. Try again." });
    expect(store.state.tables.meta_connections[0].capabilities).toEqual(stored);
    expect(writes()).toEqual([]);
    expect(store.state.tables.campaigns[0].status).toBe("paused");
  });

  it("#1217 activate: 'unknown' access is a retryable 503 ('Check again'); 'blocked' gives Meta's reason", async () => {
    const campaign = reviewedCampaign();
    replay(tapes.delivery, tapes.funding);
    const { delivery } = await (await review()).json();
    const available = { state: "available", blockers: [] };
    const unknown = { state: "unknown", blockers: [{ code: "MISSING_PERMISSION", message: "Meta access could not be verified. Check again.", action: { kind: "retry_check" } }] };
    const billing = { state: "blocked", blockers: [{ code: "BILLING_REQUIRED", message: "Meta billing must be verified before activation.", action: null }] };
    for (const [canActivate, status, error] of [[unknown, 503, "Meta access could not be verified. Check again."], [billing, 400, "Meta billing must be verified before activation."]] as const) {
      capabilities.verify.mockResolvedValueOnce({ canReadInsights: available, canReadLeads: available, canCreatePaused: available, canActivate });
      replay(tapes.delivery);
      const response = await activate({ confirmationDigest: await digest(campaign, delivery, 3), connectionGeneration: GENERATION, capDays: 3 });
      expect({ status: response.status, body: await response.json() }).toMatchObject({ status, body: { error } });
      expect(writes()).toEqual([]);
    }
  });

  it("activate: a connectionGeneration other than the stored binding is refused before any Meta call", async () => {
    const campaign = reviewedCampaign();
    replay(tapes.delivery, tapes.funding);
    const confirmationDigest = await digest(campaign, (await (await review()).json()).delivery, 3);
    replay(tapes.delivery, tapes.funding);
    capabilities.verify.mockClear();
    const response = await activate({ confirmationDigest, connectionGeneration: GENERATION + 1, capDays: 3 });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "Meta connection changed; review the campaign again." });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(capabilities.verify).not.toHaveBeenCalled();
    expect(store.state.tables.campaigns[0].status).toBe("paused");
  });

  // #1518 (CTO): a paused campaign can still have a new-audience copy waiting (made while it ran). Turning it on would
  // build a capped copy of the old ad set beside the waiting one, and both could spend.
  it("activate: refuses while a new audience waits to be switched on, before any Meta write or reservation", async () => {
    const campaign = reviewedCampaign();
    replay(tapes.delivery, tapes.funding);
    const confirmationDigest = await digest(campaign, (await (await review()).json()).delivery, 3);
    store.state.tables.campaign_edit_operations = [{ id: "op-waiting", campaign_id: STORED, kind: "audience", state: "awaiting_switch", phase: "copy" }];
    replay(tapes.delivery, tapes.funding);
    const response = await activate({ confirmationDigest, connectionGeneration: GENERATION, capDays: 3 });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "switch_pending", error: "A new audience is waiting for this campaign. Turn it on or cancel it first." });
    expect(writes()).toEqual([]);
    expect(store.state.inserted).toBe(0);
    expect(store.state.tables.campaigns[0].status).toBe("paused");
  });

  it("activate: a run that would exceed the weekly spend cap is refused with 422 before any Meta call", async () => {
    store.state.tables.spend_limits = [{ business_id: BUSINESS, weekly_cap_rupees: 2000, alert_pct: 80, auto_pause: false }];
    reviewedCampaign();
    storeCampaign({ id: "00000000-0000-4000-8000-000000000005", status: "active", daily_budget: 100 });
    replay(tapes.delivery, tapes.funding);
    // ₹100 a day already running plus this ₹200 a day: ₹2,100 a week over a ₹2,000 cap.
    const response = await activate({ confirmationDigest: "0".repeat(64), connectionGeneration: GENERATION, capDays: 3 });
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/^Activating this would commit about ₹2,100 a week, over your ₹2,000 a week cap\./);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(capabilities.verify).not.toHaveBeenCalled();
    expect(store.state.tables.campaigns.map(row => row.status)).toEqual(["paused", "active"]);
  });

  it("activate: an operator-funded capped run larger than the recorded funding room is refused with no write", async () => {
    const campaign = reviewedCampaign();
    replay(tapes.delivery, tapes.funding);
    const { delivery } = await (await review()).json();
    replay(tapes.delivery, tapes.funding);
    // 5 days × ₹200 = ₹1,000 against ₹134.87: Meta's ₹584.87 room less ₹450 still promised to the account's
    // live capped run (#1058; Meta's room alone would have said ₹584.87).
    const response = await activate({ confirmationDigest: await digest(campaign, delivery, 5), connectionGeneration: GENERATION, capDays: 5 });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "Meta has ₹134.87 left under the ad account's spending limit after ₹450 for your 1 other live run; this run needs ₹1,000. Add funds on Meta or choose fewer days.",
    });
    expect(graph.sent.map(call => `${call.method} ${call.path}`).sort()).toEqual([...deliveryReads, ...tapes.funding.map(exchange => `GET ${exchange.path}`)].sort());
    expect(writes()).toEqual([]);
    expect(graph.pending).toEqual([]);
    expect(store.state.tables.campaigns[0].status).toBe("paused");
    expect(audits()).toEqual([]);
  });

  it("activate: without a cap, the recorded paused children are refused before any write", async () => {
    const campaign = reviewedCampaign();
    replay(tapes.delivery, tapes.funding);
    const { delivery } = await (await review()).json();
    replay(tapes.delivery);
    const response = await activate({ confirmationDigest: await digest(campaign, delivery), connectionGeneration: GENERATION });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "An intended ad set or ad is paused. Activate only the intended children in Meta and review this campaign again." });
    expect(writes()).toEqual([]);
    expect(graph.pending).toEqual([]);
    expect(store.state.tables.campaigns[0].status).toBe("paused");
  });

  // #721 (QA): #499's first tree, deleted in Meta, still listed as paused; every Refresh answered 502.
  // campaign-deleted.json: the real reads after the delete (binding read finds no ad sets; status DELETED).
  it("refresh: a campaign Meta deleted is shown as deleted, not paused, and the refresh says so instead of failing", async () => {
    const DELETED = "120253706331870526";
    storeCampaign({ meta_campaign_id: DELETED, status: "paused", name: "Solaride | Free Survey | Tricity | WhatsApp EN | Oct 26" });
    replay(deletedTape.tape as Exchange[], deletedTape.tape as Exchange[]);
    const response = await refresh();
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).not.toBe(502);
    expect(JSON.stringify(body)).toMatch(/deleted/i);
    expect(store.state.tables.campaigns.find(row => row.id === STORED)?.status).not.toBe("paused");
    expect(graph.sent.every(call => call.method === "GET")).toBe(true);
  });

  // #2268 (QA on #2261): Meta's /campaigns listing leaves deleted campaigns out, so Sync never revisited a stored paused
  // row deleted in Ads Manager and Manage kept saying "Paused". Sync now reads the account's gone campaigns.
  // campaigns-gone.json: the real read-only `filtering` read (Graph v26 refuses `?ids=`), recorded through the client.
  const goneTape = goneFixture.tape as Exchange[];
  const goneList = (goneTape[0].body as { data: Array<{ id: string; effective_status: string }> }).data;
  const [DELETED_ID, OTHER_ACCOUNT_ID] = goneList.filter(campaign => campaign.effective_status === "DELETED").map(campaign => campaign.id);
  const ARCHIVED_ID = goneList.find(campaign => campaign.effective_status === "ARCHIVED")!.id;
  const STILL_PAUSED = "120253164673180526";
  const goneRows = () => [
    storeCampaign({ id: "00000000-0000-4000-8000-000000000011", meta_campaign_id: DELETED_ID, status: "paused", meta_ad_account_id: null, raw: { source: "sync" } }),
    storeCampaign({ id: "00000000-0000-4000-8000-000000000012", meta_campaign_id: ARCHIVED_ID, status: "active" }),
    storeCampaign({ id: "00000000-0000-4000-8000-000000000013", meta_campaign_id: STILL_PAUSED, status: "paused" }),
    storeCampaign({ id: "00000000-0000-4000-8000-000000000014", meta_campaign_id: OTHER_ACCOUNT_ID, status: "paused", meta_ad_account_id: "act_1000000000000001" }),
  ];
  const row = (id: string) => store.state.tables.campaigns.find(campaign => campaign.meta_campaign_id === id);

  it("sync: stored live campaigns Meta deleted or archived end as gone, legacy rows with no account id included", async () => {
    const [, , stillPaused, otherAccount] = goneRows();
    replay(tapes.sync([SYNCED]), goneTape);
    const response = await sync();
    expect(response.status).toBe(200);
    expect(row(DELETED_ID)).toMatchObject({ status: "completed", raw: { source: "sync", metaStatus: "DELETED", metaGoneAt: expect.any(String) } });
    expect(row(ARCHIVED_ID)).toMatchObject({ status: "completed", raw: { metaStatus: "ARCHIVED" } });
    const { goneInMeta } = await import("@/lib/campaign/gone-in-meta");
    expect([goneInMeta(row(DELETED_ID) as never), goneInMeta(row(ARCHIVED_ID) as never)]).toEqual(["Deleted in Meta", "Archived in Meta"]);
    // Still paused in Meta, or bound to another ad account: left exactly as they were.
    expect([row(STILL_PAUSED), row(OTHER_ACCOUNT_ID)]).toEqual([stillPaused, otherAccount]);
    expect(graph.sent.every(call => call.method === "GET" && call.access === ACCESS)).toBe(true);
    expect(graph.pending).toEqual([]);
  });

  it("sync: when Meta refuses the gone-campaigns read, every stored row is kept and the sync still succeeds", async () => {
    const before = goneRows();
    replay(tapes.sync([SYNCED]), [{ ...goneTape[0], status: 400, body: { error: { message: "Invalid parameter", type: "OAuthException", code: 100 } } }]);
    const response = await sync();
    expect(response.status).toBe(200);
    expect(store.state.tables.campaigns.filter(campaign => campaign.meta_campaign_id !== SYNCED)).toEqual(before);
    expect(graph.pending).toEqual([]);
  });

  // #1479: the campaign DELETE route against recorded Meta answers. The binding reads are the tree's
  // (safety/campaign-spend-cap); Meta's answer to a campaign DELETE is the recorded deletion of a PAUSED test
  // campaign (whatsapp-adset-validate, Oct 23) and its refusal the recorded subcode 33 (create-cleanup-refusals).
  const binding = (tapes.pause as Exchange[]).slice(0, 2);
  const deleteAnswer = (whatsappValidateTape.tape as Exchange[]).find(exchange => exchange.method === "DELETE")!;
  const deleteRefused = (cleanupRefusals as Exchange[]).find(exchange => exchange.method === "DELETE")!;

  it("delete: removes the bound campaign from Meta, then from AdBrain, with an audit row", async () => {
    treeCampaign();
    replay(binding, [{ ...deleteAnswer, path: TREE.campaignId }]);
    const response = await remove();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, metaDeleted: true });
    expect(graph.sent.map(call => call.method)).toEqual(["GET", "GET", "DELETE"]);
    expect(graph.sent.every(call => call.access === ACCESS)).toBe(true);
    expect(store.state.tables.campaigns).toEqual([]);
    expect(audits()).toHaveLength(1);
    expect(graph.pending).toEqual([]);
  });

  it("delete: Meta refusing the DELETE keeps the campaign in AdBrain and says it couldn't confirm", async () => {
    treeCampaign();
    replay(binding, [{ ...deleteRefused, path: TREE.campaignId }]);
    const response = await remove();
    expect(response.status).toBe(502);
    expect(store.state.tables.campaigns).toHaveLength(1);
    expect(audits()).toEqual([]);
  });

  // #721's tree, deleted in Ads Manager: the binding read lists no ad sets and Meta's status read says DELETED
  // (campaign-deleted.json, the delete path's narrower field lists over the same recorded bodies). Before #1479
  // every Delete answered 502, so the owner could never remove a campaign already gone from Meta.
  it("delete: a campaign already deleted in Meta is removed from AdBrain, with no Meta DELETE", async () => {
    const DELETED = "120253706331870526";
    const [campaign, adSets, state] = deletedTape.tape as Exchange[];
    storeCampaign({ meta_campaign_id: DELETED, status: "paused", name: "Solaride | Free Survey | Tricity | WhatsApp EN | Oct 26" });
    const { id, account_id } = campaign.body as Row;
    replay([
      { ...campaign, path: `${DELETED}?fields=id%2Caccount_id`, body: { id, account_id } },
      { ...adSets, path: `${DELETED}/adsets?fields=promoted_object%2Cdestination_type&limit=100` },
      state,
    ]);
    const response = await remove();
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body).toEqual({ ok: true, metaDeleted: false });
    expect(graph.sent.every(call => call.method === "GET")).toBe(true);
    expect(store.state.tables.campaigns).toEqual([]);
    expect(audits()).toHaveLength(1);
  });
});
