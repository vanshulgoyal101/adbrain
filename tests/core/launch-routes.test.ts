import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import prepareTape from "./fixtures/meta/prepare.json";
import leadFormTape from "./fixtures/meta/lead-form.json";
import createTape from "./fixtures/meta/create.json";
// #741: Meta's recorded region/country of each launched place (the service-area read).
import geoTape from "./fixtures/meta/geo-exclusions.json";
import interestsTape from "./fixtures/meta/interests-chiropractic.json";
import refusals from "./fixtures/meta/create-cleanup-refusals.json";
import deletedTape from "./fixtures/meta/safety/capped-adset-delete.json";

// #648: the launch routes themselves (POST /api/campaigns/preflight → POST /api/campaigns/create,
// inline and through the queued worker) against the real Graph recordings of one PAUSED test
// campaign (scripts/record-meta-core-fixtures.ts). Auth, ownership, draft version, connection
// generation, planHash, blockers, operation states and the OAuth token path are the real code;
// only Supabase is an in-memory stand-in, and the network is the recorded tapes.
vi.mock("@/lib/security/ssrf", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/security/ssrf")>(),
  fetchPublicUrl: async () => new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])),
}));
const db = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]>, user: null as { id: string } | null, rpcs: [] as string[], rpc: null as null | ((name: string, args: Record<string, unknown>) => unknown) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeSupabase() }));

const OWNER = "8c1f4f0e-5a43-4c55-9b1f-3f7a3f0c2a10";
const BUSINESS = "816aaafb-7ebc-4ad7-bbda-001beff172f8";
const DRAFT = "90d1d2bb-466c-4889-9af2-edb533e82531";
const CREATIVE = "e3d165a9-bbf8-47f7-8c61-e69dbb8ee3d1";
const VAULT_ROW = "5b0b8f8e-1f61-4f43-9d55-0d4e7c2b8a11";
const ACCOUNT = "act_2398686420592052";
const PAGE = "885223068001054";
const CAMPAIGN = "120253646427440526";
const ACCESS_TOKEN = "core-oauth-token";
const ADSET = "120253646428630526";
const AD = "120253646430200526";

/** The operation names AdBrain's own campaign row, which holds Meta's ids for the recorded campaign. */
function expectLaunched(operation: { state: string; campaignId: string | null }) {
  const campaigns = db.tables.campaigns ?? [];
  expect(campaigns).toEqual([expect.objectContaining({ business_id: BUSINESS, status: "paused", meta_campaign_id: CAMPAIGN,
    meta_adset_id: ADSET, meta_ad_ids: [AD], meta_ad_account_id: ACCOUNT, meta_page_id: PAGE, meta_connection_generation: 1 })]);
  expect(operation).toMatchObject({ state: "succeeded", campaignId: campaigns[0].id });
  expect(db.tables.campaign_operations).toEqual([expect.objectContaining({ state: "succeeded", campaign_id: campaigns[0].id,
    external_ids: expect.arrayContaining([CAMPAIGN, ADSET, AD]) })]);
}

type Row = Record<string, unknown>;
type Exchange = { method: string; path: string; status: number; body: unknown };

/** Just enough of supabase-js for these routes: filters, single rows, inserts, updates and RPCs. */
function fakeSupabase() {
  const from = (table: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    let write: { kind: "insert" | "update" | "upsert" | "delete"; values?: Row | Row[] } | null = null;
    const rows = () => (db.tables[table] ??= []);
    const run = () => {
      if (write?.kind === "insert" || write?.kind === "upsert") {
        const added = [write.values].flat().map((values) => ({ id: crypto.randomUUID(), ...values }));
        rows().push(...added);
        return added;
      }
      const matched = rows().filter((row) => filters.every((filter) => filter(row)));
      if (write?.kind === "update") matched.forEach((row) => Object.assign(row, write!.values));
      if (write?.kind === "delete") db.tables[table] = rows().filter((row) => !matched.includes(row));
      return matched;
    };
    const query: Record<string, unknown> = new Proxy({}, {
      get(_target, key: string) {
        if (key === "eq") return (column: string, value: unknown) => { filters.push((row) => row[column] === value); return query; };
        if (key === "in") return (column: string, values: unknown[]) => { filters.push((row) => values.includes(row[column])); return query; };
        if (["insert", "update", "upsert"].includes(key)) return (values: Row) => { write = { kind: key as "insert", values }; return query; };
        if (key === "delete") return () => { write = { kind: "delete" }; return query; };
        if (key === "maybeSingle") return async () => ({ data: run()[0] ?? null, error: null });
        if (key === "single") return async () => { const [row] = run(); return row ? { data: row, error: null } : { data: null, error: { message: "No rows" } }; };
        if (key === "then") return (resolve: (value: unknown) => void, reject: (error: unknown) => void) => Promise.resolve({ data: run(), error: null }).then(resolve, reject);
        return () => query; // select, order, limit, gte… narrow nothing here
      },
    });
    return query;
  };
  return {
    auth: { getUser: async () => ({ data: { user: db.user }, error: null }) },
    from,
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      db.rpcs.push(name);
      const data = db.rpc?.(name, args);
      return data === undefined ? { data: null, error: { message: `Unexpected RPC ${name}` } } : { data, error: null };
    },
  };
}

/** The campaign_operations functions from db/migrations, reduced to the states these routes use. */
function operationRpc(name: string, args: Record<string, unknown>) {
  const operations = (db.tables.campaign_operations ??= []);
  const byId = (id: unknown) => operations.find((row) => row.id === id);
  const now = new Date().toISOString();
  const claim = (input: { id: unknown; businessId: unknown; draftId: unknown; draftVersion: unknown; generation: unknown; key: unknown; hash: unknown; lease: unknown; payload: unknown }) => {
    const existing = operations.find((row) => row.business_id === input.businessId && row.idempotency_key === input.key);
    if (existing) return [existing];
    const row = { id: input.id, business_id: input.businessId, draft_id: input.draftId, draft_version: input.draftVersion,
      connection_generation: input.generation, kind: "campaign_create", idempotency_key: input.key, request_hash: input.hash,
      state: "running", phase: "campaign", lease_until: input.lease, attempt_count: 1, payload: input.payload, result: null,
      campaign_id: null, external_ids: [], sanitized_error: null, created_at: now, updated_at: now };
    operations.push(row);
    return [row];
  };
  switch (name) {
    case "meta_token_get": return db.tables.tokens.filter((row) => row.id === args.p_token_id && row.business_id === args.p_business_id);
    case "claim_campaign_operation": return claim({ id: args.p_operation_id, businessId: args.p_business_id, draftId: args.p_draft_id,
      draftVersion: args.p_draft_version, generation: args.p_connection_generation, key: args.p_idempotency_key, hash: args.p_request_hash,
      lease: args.p_lease_until, payload: args.p_payload });
    case "enqueue_campaign_operation": {
      const input = args.p_input as Record<string, unknown>;
      const [row] = claim({ id: args.p_operation_id, businessId: input.businessId, draftId: input.draftId, draftVersion: input.draftVersion,
        generation: input.connectionGeneration, key: input.idempotencyKey, hash: args.p_request_hash,
        lease: new Date(Date.now() + 86_400_000).toISOString(), payload: { execution: "worker", request: input } });
      if (row.id === args.p_operation_id && row.state === "running") row.state = "pending";
      return [row];
    }
    case "claim_next_campaign_job": {
      const row = operations.find((candidate) => candidate.state === "pending");
      if (!row) return [];
      Object.assign(row, { state: "running", lease_until: new Date(Date.now() + 600_000).toISOString() });
      return [row];
    }
    case "checkpoint_campaign_operation": {
      const row = byId(args.p_operation_id);
      if (!row || row.state !== "running") return [];
      return [Object.assign(row, { phase: args.p_phase, lease_until: args.p_lease_until, external_ids: args.p_external_ids })];
    }
    case "finish_campaign_operation": {
      const row = byId(args.p_operation_id);
      return row ? [Object.assign(row, { state: "succeeded", phase: "complete", campaign_id: args.p_campaign_id, result: args.p_result, lease_until: null })] : [];
    }
    case "fail_campaign_operation": {
      const row = byId(args.p_operation_id);
      return row ? [Object.assign(row, { state: args.p_state, external_ids: args.p_external_ids, campaign_id: args.p_campaign_id, sanitized_error: args.p_error, lease_until: null })] : [];
    }
    default: return undefined;
  }
}

function replay(...tapes: unknown[][]) {
  const pending = tapes.flat() as Exchange[];
  const sent: { method: string; path: string; form: Record<string, string> }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname !== "graph.facebook.com") throw new Error(`Unexpected request to ${url.hostname}`);
    url.searchParams.delete("access_token");
    const method = init?.method ?? "GET";
    const path = url.pathname.replace("/v21.0/", "") + url.search;
    const form = init?.body instanceof URLSearchParams ? Object.fromEntries([...init.body].filter(([key]) => key !== "access_token")) : {};
    sent.push({ method, path, form });
    const index = pending.findIndex((exchange) => exchange.method === method && exchange.path === path);
    if (index < 0) throw new Error(`Unrecorded Graph call: ${method} ${path}`);
    const [exchange] = pending.splice(index, 1);
    return Response.json(exchange.body, { status: exchange.status });
  });
  return { sent, posts: () => sent.filter((call) => call.method === "POST") };
}

const draftInput = {
  businessId: BUSINESS, name: "AdBrain core fixture 2026-10-21T15:54 (PAUSED test)", goal: "Book new-patient exams", mode: "manual",
  creativeIds: [CREATIVE], dailyBudgetRupees: 200, leadFormId: "2531491190682703", destination: "instant_form", abTest: false,
  targeting: {
    location: { mode: "ai", cityScope: "city_only", includedNames: ["Austin, Texas"] },
    age: { mode: "manual", min: 25, max: 55 },
    // Meta's recorded search answers "Wellness" exactly; "Chiropractic" only finds universities.
    audience: { interestNames: ["Wellness"], rationale: "Adults near the clinic." },
  },
};

async function seed(website: string | null) {
  const { encryptMetaToken } = await import("@/lib/meta/token-store");
  const sealed = encryptMetaToken(ACCESS_TOKEN, { tokenId: VAULT_ROW, businessId: BUSINESS });
  const capability = { state: "available", blockers: [] };
  db.user = { id: OWNER };
  db.rpcs = [];
  db.rpc = operationRpc;
  db.tables = {
    businesses: [{ id: BUSINESS, owner_id: OWNER, name: "Cedar Ridge Chiropractic", website, locations: ["Austin, Texas"], offers: [] }],
    creatives: [{ id: CREATIVE, business_id: BUSINESS, status: "approved", image_url: "https://core-test.supabase.co/storage/v1/object/public/creatives/ad.png",
      headline: "Diwali Renewal, Starting With Your Spine", primary_text: "A $49 new-patient exam with a digital posture scan. Same-day and Saturday appointments.",
      cta: "Book Now", generation: null, angle: "offer" }],
    campaign_drafts: [{ id: DRAFT, business_id: BUSINESS, owner_id: OWNER, version: 2, input: draftInput,
      expires_at: "2099-01-01T00:00:00.000Z", created_at: "2026-10-25T00:00:00.000Z", updated_at: "2026-10-25T00:00:00.000Z" }],
    meta_connections: [{ business_id: BUSINESS, generation: 1, authorization_status: "connected", token_id: VAULT_ROW, meta_business_id: null,
      ad_account_id: ACCOUNT, page_id: PAGE, account_name: "Solaride 101", page_name: "Solaride Energy", currency: "INR", timezone_name: "Asia/Kolkata",
      capabilities: { canReadInsights: capability, canReadLeads: capability, canCreatePaused: capability, canActivate: capability },
      last_checked_at: "2026-10-25T00:00:00.000Z" }],
    tokens: [{ id: VAULT_ROW, business_id: BUSINESS, ciphertext: sealed.ciphertext, nonce: sealed.nonce, auth_tag: sealed.authTag,
      key_id: sealed.keyId, format_version: sealed.formatVersion, granted_scopes: ["ads_management", "ads_read"], revoked_at: null,
      expires_at: null, data_access_expires_at: null }],
    campaign_operations: [],
  };
}

/** What one review reads from Meta: Page token, lead form, Austin, and the Wellness interest. */
const reviewReads = [prepareTape, leadFormTape, interestsTape];

const post = async (route: "preflight" | "create", body: unknown) => {
  const { POST } = await import(`@/app/api/campaigns/${route}/route`);
  const response: Response = await POST(new Request(`http://localhost/api/campaigns/${route}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json() };
};
const preflight = () => post("preflight", { businessId: BUSINESS, draftId: DRAFT, draftVersion: 2 });
const createRequest = (review: { planHash: string; connectionGeneration: number }, extra: Record<string, unknown> = {}) => ({
  businessId: BUSINESS, draftId: DRAFT, draftVersion: 2, planHash: review.planHash,
  connectionGeneration: review.connectionGeneration, idempotencyKey: "core-launch-route-0001", ...extra,
});

beforeEach(() => {
  vi.resetModules();
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: "https://core-test.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    META_CONNECT_ROLLOUT: "enabled", META_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"), CAMPAIGN_EXECUTION_MODE: "inline",
  })) vi.stubEnv(name, value);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("core: the launch routes, preflight → create → worker, on recorded Meta answers (#648)", () => {
  it("reviews a business without a website as blocked: 200, canCreatePaused false, no planHash, and create refuses it", async () => {
    await seed(null);
    // The create route reviews the draft again before anything else, so it reads the same answers.
    const tape = replay(...reviewReads, ...reviewReads);
    const review = await preflight();
    expect(review.status).toBe(200);
    expect(review.body.data).toMatchObject({ canCreatePaused: false, planHash: null });
    expect(review.body.data.blockers).toEqual([expect.objectContaining({ action: { kind: "open_brand" } })]);
    const create = await post("create", createRequest({ planHash: "a".repeat(64), connectionGeneration: 1 }));
    expect(create).toMatchObject({ status: 400, body: { error: { code: "PREFLIGHT_BLOCKED" } } });
    expect(tape.posts()).toEqual([]);
    expect(db.tables.campaign_operations).toEqual([]);
  });

  it("creates a reviewed campaign inline: only PAUSED objects on the connected account and Page, operation succeeded with the recorded campaign", async () => {
    await seed("https://adbrain.vanshul.com");
    const tape = replay(...reviewReads, ...reviewReads, createTape, geoTape);
    const review = await preflight();
    expect(review.status).toBe(200);
    expect(review.body.data).toMatchObject({ canCreatePaused: true, blockers: [], connectionGeneration: 1,
      selected: { adAccountId: ACCOUNT, pageId: PAGE } });
    expect(review.body.data.planHash).toMatch(/^[0-9a-f]{64}$/);

    const create = await post("create", createRequest(review.body.data));
    expect(create.status).toBe(200);
    expect(create.body.data.blockers).toEqual([]);
    expectLaunched(create.body.data);
    expect(tape.posts().map((call) => call.path)).toEqual(["campaigns", "adimages", "adsets", "adcreatives", "ads"].map((edge) => `${ACCOUNT}/${edge}`));
    for (const edge of ["campaigns", "adsets", "ads"]) expect(tape.posts().find((call) => call.path.endsWith(`/${edge}`))?.form.status).toBe("PAUSED");
    expect(JSON.stringify(tape.sent)).not.toContain("ACTIVE");
    expect(JSON.parse(tape.posts().find((call) => call.path.endsWith("/adcreatives"))!.form.object_story_spec).page_id).toBe(PAGE);
  });

  // #735: Meta made the campaign, then refused the image upload, before any ad set. AdBrain deletes the
  // empty PAUSED campaign (sync can't import a campaign without ad sets); if the delete fails, it reconciles.
  describe("a create that fails before any ad set", () => {
    const [campaignPost] = createTape as Exchange[];
    const campaignId = (campaignPost.body as { id: string }).id;
    const imageRefused = (refusals as Exchange[]).find((exchange) => exchange.path.endsWith("/adimages"))!;
    const deleteAnswer = (answer: Exchange) => ({ ...answer, method: "DELETE", path: campaignId });

    it.each([
      ["Meta confirms the delete: nothing is left, so the attempt failed", deletedTape[0] as Exchange, "failed"],
      ["Meta refuses the delete: the campaign may remain, so it needs reconciliation",
        (refusals as Exchange[]).find((exchange) => exchange.method === "DELETE")!, "needs_reconciliation"],
    ])("%s", async (_case, answer, state) => {
      await seed("https://adbrain.vanshul.com");
      const tape = replay(...reviewReads, ...reviewReads, [campaignPost, imageRefused, deleteAnswer(answer)], geoTape);
      const review = await preflight();
      await post("create", createRequest(review.body.data));
      expect(tape.sent.map((call) => `${call.method} ${call.path}`)).toEqual(expect.arrayContaining([
        `POST ${ACCOUNT}/campaigns`, `POST ${ACCOUNT}/adimages`, `DELETE ${campaignId}`]));
      expect(tape.sent.filter((call) => call.method === "DELETE")).toHaveLength(1);
      expect(tape.posts().some((call) => call.path.endsWith("/adsets"))).toBe(false);
      expect(db.tables.campaign_operations).toEqual([expect.objectContaining({ state })]);
      expect(db.tables.campaigns ?? []).toEqual([]);
      if (state === "failed") expect(String(db.tables.campaign_operations[0].sanitized_error)).toContain("was deleted; nothing is left in Meta");
    });
  });

  it.each([
    ["an older draft version", { draftVersion: 1 }, 409],
    ["an older connection generation", { connectionGeneration: 0 }, 409],
    ["a plan that changed since review", { planHash: "b".repeat(64) }, 409],
  ])("refuses %s before any Meta write", async (_case, change, status) => {
    await seed("https://adbrain.vanshul.com");
    const tape = replay(...reviewReads, ...reviewReads);
    const review = await preflight();
    const create = await post("create", createRequest(review.body.data, change));
    expect(create).toMatchObject({ status, body: { error: { code: "CONFLICT" } } });
    expect(tape.posts()).toEqual([]);
    expect(db.tables.campaign_operations).toEqual([]);
  });

  it("queues the reviewed campaign and the worker creates it PAUSED with the recorded campaign", async () => {
    vi.stubEnv("CAMPAIGN_EXECUTION_MODE", "worker");
    await seed("https://adbrain.vanshul.com");
    const tape = replay(...reviewReads, ...reviewReads, ...reviewReads, createTape, geoTape);
    const review = await preflight();
    const queued = await post("create", createRequest(review.body.data));
    expect(queued).toMatchObject({ status: 202, body: { data: { state: "pending", campaignId: null } } });
    expect(tape.posts()).toEqual([]);

    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { runNextCampaignJob } = await import("@/lib/campaign/worker");
    expect(await runNextCampaignJob(createAdminClient() as never, new AbortController().signal)).toBe(true);
    const [operation] = db.tables.campaign_operations;
    expectLaunched({ state: String(operation.state), campaignId: operation.campaign_id as string });
    expect(tape.posts().map((call) => call.path.split("/")[0])).toEqual(Array(5).fill(ACCOUNT));
    expect(JSON.stringify(tape.sent)).not.toContain("ACTIVE");

    // The same request again replays the finished operation; nothing new reaches Meta.
    const again = await post("create", createRequest(review.body.data));
    expect(again.status).toBe(200);
    expectLaunched(again.body.data);
    expect(tape.posts()).toHaveLength(5);
  });
});
