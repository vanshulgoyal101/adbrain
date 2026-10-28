import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import dailyTape from "./fixtures/meta/edit-budget-daily.json";
import cappedTape from "./fixtures/meta/edit-budget-capped.json";
import refusedTape from "./fixtures/meta/edit-budget-refused.json";
import rateLimitedTape from "./fixtures/meta/edit-budget-rate-limited.json";
import fundingTape from "./fixtures/meta/account-funding.json";
import liveRunsTape from "./fixtures/meta/account-funding-live-runs.json";

// #774 3/3: POST /api/campaigns/[id]/budget through the real route, connection access, budget-edit service,
// money rules, MetaClient, trusted write and audit, on a token sealed by the real token store. Only Supabase
// (an in-memory table store), the funding-mode and spend-limit lookups and the capability re-check are stubbed;
// every Graph call is answered from tapes recorded by scripts/record-meta-edit-budget.ts on one PAUSED
// Solaride test campaign (archived) and any other call fails the test.
// Recorded: binding checks, ad-set budget reads, validate_only and real writes, read-backs, Meta's minimum
// budget refusal (1885272) and its 30 s limit (613, which counts validate_only). The service reads each ad
// set before the edit, so that read is replayed from the tape's own read of the same state. The account
// funding is recorded (₹847.46 of room); "no account limit" for the successful cap raise is synthesised.
// #1094: the account's live ad sets are Solaride's real listing (recorded and scrubbed Oct 27, 18:00Z: the lever-2
// WhatsApp run, ₹450 left), mapped onto this account, with this campaign's own capped ad set added, so the raise
// excludes it and counts the other.
// The clock is the recording time, so the capped run's end dates stay in the future.
type Exchange = { method: string; path: string; status: number; body: unknown };
type Row = Record<string, unknown>;

const store = vi.hoisted(() => {
  const state = { tables: {} as Record<string, Row[]>, user: null as { id: string } | null, inserted: 0, rpc: {} as Record<string, (args: Row) => { data: unknown; error: unknown }> };
  const known = ["audit_log", "businesses", "campaigns", "campaign_edit_operations", "campaign_learnings", "meta_connections"];
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
      insert: (values: Row) => { write = { kind: "insert", values }; return query; },
      update: (values: Row) => { write = { kind: "update", values }; return query; },
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
const money = vi.hoisted(() => ({ mode: "own" as string, weeklyCapRupees: null as number | null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => store.client() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => store.client() }));
vi.mock("@/lib/supabase/queries", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/supabase/queries")>(),
  getSpendLimits: async () => ({ weeklyCapRupees: money.weeklyCapRupees, alertPct: 80, autoPause: false }),
  getCampaignSpend: async () => [],
}));
vi.mock("@/lib/meta/capability-verification", () => ({ verifyMetaCapabilities: capabilities.verify }));
vi.mock("@/lib/payments/operator-funding", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/payments/operator-funding")>(), fundingMode: async () => money.mode }));

const BUSINESS = "00000000-0000-4000-8000-000000000774";
const OWNER = "00000000-0000-4000-8000-000000000001";
const SEAL_ID = "00000000-0000-4000-8000-000000000003";
const STORED = "00000000-0000-4000-8000-000000000004";
const ACCOUNT = "act_9000000000000001", PAGE = "900000000000002", GENERATION = 3;
const available = { state: "available", blockers: [] };
const RECORDED_AT = new Date("2026-10-26T14:45:00Z");

const daily = dailyTape as Exchange[], capped = cappedTape as Exchange[], refused = refusedTape as Exchange[], limited = rateLimitedTape as Exchange[];
const CAMPAIGN = "120253712459000526", DAILY_AD_SET = "120253712459810526", DAILY_AD = "120253712461120526";
const CAPPED_AD_SET = "120253712571840526", CAPPED_AD = "120253712576640526";
const recordedFunding = fundingTape[0] as Exchange;
const noAccountLimit: Exchange = { ...recordedFunding, body: { ...recordedFunding.body as Row, spend_cap: "0" } };
const recordedListing = JSON.parse(JSON.stringify(liveRunsTape.tape[1]).replaceAll(liveRunsTape.adAccountId, ACCOUNT)) as Exchange;
const listing = (others: boolean): Exchange => ({ ...recordedListing, body: { ...recordedListing.body as Row, data: [
  { id: CAPPED_AD_SET, effective_status: "ACTIVE", lifetime_budget: "60000", budget_remaining: "60000", daily_budget: "0" },
  ...others ? (recordedListing.body as { data: Row[] }).data : [],
] } });

const audit: Row[] = [];
const graph = { sent: [] as Array<{ method: string; path: string; form: Record<string, string> }>, pending: [] as Exchange[] };
function replay(recorded: Exchange[]) {
  graph.pending = [...recorded];
  graph.sent = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    url.searchParams.delete("access_token");
    const method = init?.method ?? "GET";
    const path = url.pathname.replace("/v26.0/", "") + url.search;
    const form = init?.body instanceof URLSearchParams ? Object.fromEntries([...init.body].filter(([key]) => key !== "access_token")) : {};
    graph.sent.push({ method, path, form });
    const index = graph.pending.findIndex(exchange => exchange.method === method && exchange.path === path);
    if (index < 0) throw new Error(`Unrecorded Graph call: ${method} ${path}`);
    const [exchange] = graph.pending.splice(index, 1);
    return Response.json(exchange.body, { status: exchange.status });
  });
}

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

/** An uncapped campaign on one daily ad set (the managed shape). */
function storedDaily(values: Row = {}, campaignId = CAMPAIGN, adSetId = DAILY_AD_SET) {
  (store.state.tables.campaigns ??= []).push({
    id: STORED, business_id: BUSINESS, name: "Solaride budget", objective: "leads", status: "paused", daily_budget: 200,
    meta_ad_account_id: ACCOUNT, meta_page_id: PAGE, meta_connection_generation: GENERATION,
    meta_campaign_id: campaignId, meta_adset_id: adSetId, meta_ad_ids: [DAILY_AD],
    raw: { source: "campaign_operation", metaResult: { campaignId, adSetIds: [adSetId], adIds: [DAILY_AD] } }, ...values,
  });
}
/** A capped run (#157): the daily ad set paused, a lifetime ad set with an end date (own account shape). */
function storedCapped(cap: Row, values: Row = {}) {
  (store.state.tables.campaigns ??= []).push({
    id: STORED, business_id: BUSINESS, name: "Solaride capped", objective: "leads", status: "paused", daily_budget: 200,
    meta_ad_account_id: ACCOUNT, meta_page_id: PAGE, meta_connection_generation: GENERATION,
    meta_campaign_id: CAMPAIGN, meta_adset_id: DAILY_AD_SET, meta_ad_ids: [DAILY_AD, CAPPED_AD],
    raw: {
      source: "campaign_operation", metaResult: { campaignId: CAMPAIGN, adSetIds: [DAILY_AD_SET, CAPPED_AD_SET], adIds: [DAILY_AD, CAPPED_AD] },
      cappedAdSetIds: [CAPPED_AD_SET], cap: { adSetId: CAPPED_AD_SET, adIds: [CAPPED_AD], ...cap }, health: { flags: [] },
    }, ...values,
  });
}

const mirror = () => store.state.tables.campaigns[0];
const operations = () => store.state.tables.campaign_edit_operations ?? [];
const writes = () => graph.sent.filter(call => call.method === "POST");
async function edit(body: Row) {
  const { POST } = await import("@/app/api/campaigns/[id]/budget/route");
  const response = await POST(new Request(`http://localhost/api/campaigns/${STORED}/budget`, {
    method: "POST", body: JSON.stringify({ idempotencyKey: "budget-key-0001", ...body }),
  }), { params: Promise.resolve({ id: STORED }) });
  return { status: response.status, body: await response.json() as Row };
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(RECORDED_AT);
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: "https://core-test.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    META_CONNECT_ROLLOUT: "enabled", META_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), MANAGED_ACCOUNTS_ENABLED: "",
  })) vi.stubEnv(name, value);
  Object.assign(store.state, { tables: {}, user: { id: OWNER }, inserted: 0, rpc: {
    append_verified_audit_event: (args: Row) => { audit.push(args); return { data: null, error: null }; },
  } });
  Object.assign(money, { mode: "own", weeklyCapRupees: null });
  audit.length = 0;
  capabilities.verify.mockImplementation(async (_meta: unknown, connection: Row) => connection.capabilities);
  await connect();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("core: edit a launched campaign's daily budget (#774)", () => {
  it("raises it: the preview validates with Meta and asks for confirmation, the confirmed save writes, reads back and mirrors", async () => {
    storedDaily();
    replay([daily[2], ...daily.slice(0, 4), daily[6], ...daily.slice(4, 9)]);
    const preview = await edit({ change: { dailyRupees: 250 }, preview: true });
    expect(preview.status).toBe(200);
    expect(preview.body.preview).toMatchObject({
      before: { dailyRupees: 200, capRupees: null }, after: { dailyRupees: 250 }, needsConfirmation: true,
      confirmationDigest: expect.stringMatching(/^[0-9a-f]{64}$/), notices: [expect.stringContaining("restart Meta's learning")],
    });
    expect(writes()).toEqual([expect.objectContaining({ form: { daily_budget: "25000", execution_options: "[\"validate_only\"]" } })]);
    expect(operations()).toEqual([]);

    const saved = await edit({ change: { dailyRupees: 250 }, confirmationDigest: (preview.body.preview as Row).confirmationDigest });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ ok: true, result: { before: { dailyRupees: 200 }, after: { dailyRupees: 250 }, replay: false } });
    expect(writes().at(-1)).toMatchObject({ path: DAILY_AD_SET, form: { daily_budget: "25000" } });
    expect(graph.pending).toEqual([]);
    expect(mirror()).toMatchObject({ daily_budget: 250 });
    expect(operations()).toMatchObject([{ kind: "budget", state: "succeeded", phase: "complete", transmitted: true }]);
    expect(JSON.stringify(audit)).toContain("₹200 → ₹250 a day");
  });

  it("refuses a raise above what the owner approved without the confirmation, before any Meta write", async () => {
    storedDaily();
    replay([daily[2]]);
    const { status, body } = await edit({ change: { dailyRupees: 250 } });
    expect(status).toBe(409);
    expect(body.error).toBe("Confirm the new amount first: it's more than you approved.");
    expect(writes()).toEqual([]);
    expect(operations()).toMatchObject([{ state: "failed", transmitted: false }]);
    expect(mirror()).toMatchObject({ daily_budget: 200 });
  });

  it("lowers it without a confirmation", async () => {
    storedDaily({ daily_budget: 250 });
    replay([daily[11], ...daily.slice(9, 14)]);
    const { status, body } = await edit({ change: { dailyRupees: 150 } });
    expect(status).toBe(200);
    expect(body).toMatchObject({ result: { before: { dailyRupees: 250 }, after: { dailyRupees: 150 }, notices: [expect.stringContaining("learning")] } });
    expect(writes()).toEqual([expect.objectContaining({ form: { daily_budget: "15000" } })]);
    expect(mirror()).toMatchObject({ daily_budget: 150 });
  });

  // #1146: a waiting new-audience copy holds the budget it was made with; the switch would drop this change.
  it("refuses while a new audience waits to be switched on, before any Meta call", async () => {
    storedDaily({ daily_budget: 250 });
    store.state.tables.campaign_edit_operations = [{ id: "op-waiting", campaign_id: STORED, kind: "audience", state: "awaiting_switch", phase: "copy" }];
    replay([]);
    const { status, body } = await edit({ change: { dailyRupees: 150 } });
    expect(status).toBe(409);
    expect(body.error).toBe("A new audience is waiting for this campaign. Turn it on or cancel it first.");
    expect(graph.sent).toEqual([]);
  });

  // Reviewer on #901: a running campaign's daily budget is held by its AdBrain reservation (customer_ad_campaign_guard).
  it("refuses a running campaign's daily change before any Meta call", async () => {
    storedDaily({ status: "active" });
    replay([]);
    const { status, body } = await edit({ change: { dailyRupees: 250 }, preview: true });
    expect(status).toBe(409);
    expect(body.error).toBe("Pause the campaign to change its daily budget; it resumes at the new amount after your review.");
    expect(graph.sent).toEqual([]);
  });

  // Reviewer on #901: Meta accepted the write, so a failed read-back (a 4xx such as #17) is never "nothing sent".
  it("keeps an edit whose read-back fails after Meta accepted the write as sent and to be reconciled", async () => {
    storedDaily({ daily_budget: 250 });
    const throttled: Exchange = { ...daily[13], status: 400, body: { error: { message: "User request limit reached", type: "OAuthException", code: 17 } } };
    replay([daily[11], ...daily.slice(9, 13), throttled]);
    const { status } = await edit({ change: { dailyRupees: 150 } });
    expect(status).toBe(409);
    expect(writes()).toEqual([expect.objectContaining({ form: { daily_budget: "15000" } })]);
    expect(operations()).toMatchObject([{ state: "needs_reconciliation", transmitted: true }]);
    expect(mirror()).toMatchObject({ daily_budget: 250 });
  });

  it("shows Meta's minimum budget in plain words (recorded 1885272, in the token user's Hindi)", async () => {
    storedDaily({ daily_budget: 150 });
    replay([refused[2], ...refused]);
    const { status, body } = await edit({ change: { dailyRupees: 1 }, preview: true });
    expect(status).toBe(400);
    expect(body.error).toBe("That budget is below Meta's minimum of ₹95.46 a day. Choose a higher budget.");
  });

  it("turns Meta's 613 on the first write into a retryable failure with nothing sent, leaving the mirror alone", async () => {
    const campaignId = "120253712447820526", adSetId = "120253712448520526";
    storedDaily({}, campaignId, adSetId);
    const { budgetConfirmationDigest } = await import("@/lib/campaign/budget-edit-service");
    const digest = budgetConfirmationDigest(STORED, campaignId, [{ adSetId, status: "PAUSED", dailyBudgetPaise: 20_000, lifetimeBudgetPaise: 0, remainingPaise: 0, endTime: null }], { dailyRupees: 250 });
    replay([limited[2], ...limited.slice(4)]);
    const before = structuredClone(mirror());
    const { status, body } = await edit({ change: { dailyRupees: 250 }, confirmationDigest: digest });
    expect(status).toBe(429);
    expect(body).toMatchObject({ error: "Meta needs 30 seconds between budget changes. Try again in a moment.", retryable: true });
    expect(operations()).toMatchObject([{ state: "failed", transmitted: false }]);
    expect(mirror()).toEqual(before);
  });

  it("answers 401 without a session, 404 for another owner's campaign and 400 for an empty change", async () => {
    storedDaily();
    replay([]);
    expect((await edit({ change: {} })).status).toBe(400);
    store.state.user = null;
    expect((await edit({ change: { dailyRupees: 150 } })).status).toBe(401);
    store.state.user = { id: OWNER };
    store.state.tables.campaigns = [];
    expect((await edit({ change: { dailyRupees: 150 } })).status).toBe(404);
    expect(graph.sent).toEqual([]);
  });
});

describe("core: edit a capped run's total and end date (#774)", () => {
  const launchCap = { lifetimeBudgetPaise: 60_000, endTime: "2026-10-29T14:27:07.000Z", days: 3 };
  const longer = "2026-10-31T14:27:07.000Z";

  it("raises the cap and runs longer after a confirmation, and keeps raw written meanwhile", async () => {
    storedCapped(launchCap);
    replay([capped[2], noAccountLimit, listing(true), ...capped.slice(0, 4), capped[6], noAccountLimit, listing(true), ...capped.slice(4, 9)]);
    const change = { capRupees: 900, endTime: longer };
    const preview = await edit({ change, preview: true });
    expect(preview.status).toBe(200);
    expect(preview.body.preview).toMatchObject({ before: { capRupees: 600, spentRupees: 0 }, after: { capRupees: 900, endTime: longer }, needsConfirmation: true, notices: [] });

    const answer = vi.mocked(globalThis.fetch).getMockImplementation()!;
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      if (init?.method === "POST") mirror().raw = { ...mirror().raw as Row, health: { flags: ["checked"] } };
      return answer(input, init);
    });
    const saved = await edit({ change, confirmationDigest: (preview.body.preview as Row).confirmationDigest });
    expect(saved.status).toBe(200);
    expect(writes().at(-1)).toMatchObject({ path: CAPPED_AD_SET, form: { lifetime_budget: "90000", end_time: longer } });
    expect(graph.pending).toEqual([]);
    expect(mirror()).toMatchObject({ daily_budget: 200 });
    expect(mirror().raw).toMatchObject({ health: { flags: ["checked"] }, cappedAdSetIds: [CAPPED_AD_SET], cap: { adSetId: CAPPED_AD_SET, adIds: [CAPPED_AD], lifetimeBudgetPaise: 90_000, endTime: longer, days: 5 } });
    expect(JSON.stringify(audit)).toContain("total cap ₹600 → ₹900");
  });

  // Reviewer on #901: a capped run spends what's left over the days left, so these speed Meta's daily pace up.
  it("needs a confirmation for a shorter end date, which speeds the run up, before any write", async () => {
    storedCapped(launchCap);
    replay([capped[2]]);
    const { status, body } = await edit({ change: { endTime: "2026-10-28T14:27:07.000Z" } });
    expect(status).toBe(409);
    expect(body.error).toBe("Confirm the new amount first: it's more than you approved.");
    expect(writes()).toEqual([]);
  });

  it("checks a running capped run's faster pace against the weekly limit in Settings, before any write", async () => {
    storedCapped(launchCap, { status: "active" });
    money.weeklyCapRupees = 1_000;
    replay([capped[2], noAccountLimit, listing(true)]);
    const { status, body } = await edit({ change: { capRupees: 900 }, preview: true });
    expect(status).toBe(422);
    expect(body.error).toBe("About ₹301 a day would take your campaigns past your weekly limit of ₹1,000 in Settings.");
    expect(writes()).toEqual([]);
  });

  it("refuses a cap the Meta ad account can't fund (recorded room ₹847.46), before any write", async () => {
    storedCapped(launchCap);
    replay([capped[2], recordedFunding, listing(false)]);
    const { status, body } = await edit({ change: { capRupees: 900 }, preview: true });
    expect(status).toBe(422);
    // #1094: the run's own ₹600 still to spend is not subtracted again: it is part of the ₹900 it needs.
    expect(body.error).toBe("Meta has ₹847 left under the ad account's spending limit; this cap needs ₹900. Add funds on Meta or choose a lower cap.");
    expect(writes()).toEqual([]);
  });

  // #1094 (CTO): tonight's ₹250 → ₹450 raise was checked against the whole room, not what other runs leave.
  it("counts the account's other live run against a raise, names it, and leaves out uncapped spend", async () => {
    storedCapped(launchCap);
    const withDaily = listing(true);
    (withDaily.body as { data: Row[] }).data.push({ id: "120253700000000526", effective_status: "ACTIVE", lifetime_budget: "0", budget_remaining: "0", daily_budget: "20000" });
    replay([capped[2], recordedFunding, withDaily]);
    const { status, body } = await edit({ change: { capRupees: 800 }, preview: true });
    expect(status).toBe(422);
    // ₹847.46 room − ₹450 still promised to the WhatsApp run = ₹397.46 < ₹800; the ₹200/day ad set is named only.
    expect(body.error).toBe("Meta has ₹397 left under the ad account's spending limit after ₹450 for your 1 other live run, and ₹200 a day also runs on 1 uncapped ad set; this cap needs ₹800. Add funds on Meta or choose a lower cap.");
    expect(graph.sent.map(call => call.path)).toContain(recordedListing.path);
    expect(writes()).toEqual([]);
  });

  it("lowers the cap without a confirmation and replays it by key without calling Meta again", async () => {
    storedCapped({ lifetimeBudgetPaise: 90_000, endTime: longer, days: 5 });
    replay([capped[11], ...capped.slice(9, 14)]);
    const first = await edit({ change: { capRupees: 700 } });
    expect(first.status).toBe(200);
    expect(writes()).toEqual([expect.objectContaining({ form: { lifetime_budget: "70000" } })]);
    expect(mirror().raw).toMatchObject({ cap: { lifetimeBudgetPaise: 70_000, endTime: longer, days: 5 } });
    const calls = graph.sent.length;
    const again = await edit({ change: { capRupees: 700 } });
    expect(again.body).toMatchObject({ result: { ...(first.body.result as Row), replay: true } });
    expect(graph.sent).toHaveLength(calls);
    expect((await edit({ change: { capRupees: 650 } })).status).toBe(409);
  });

  it("refuses a daily budget change on a capped run, a managed cap raise and an ended run before any Meta call", async () => {
    storedCapped(launchCap);
    replay([]);
    expect((await edit({ change: { dailyRupees: 300 } })).body.error).toContain("Change those instead of the daily budget");
    money.mode = "managed";
    expect((await edit({ change: { capRupees: 900 }, idempotencyKey: "budget-key-0002" })).body.error).toContain("isn't available yet");
    vi.setSystemTime(new Date("2026-10-30T00:00:00Z"));
    expect((await edit({ change: { endTime: longer }, idempotencyKey: "budget-key-0003" })).body.error).toBe("This run has ended. Start a new run instead.");
    expect(graph.sent).toEqual([]);
  });
});
