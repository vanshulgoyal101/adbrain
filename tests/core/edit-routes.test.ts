import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import rebuildTape from "./fixtures/meta/edit-audience-rebuild.json";
import patchTape from "./fixtures/meta/edit-audience-patch.json";
import rateLimitedTape from "./fixtures/meta/edit-audience-patch-rate-limited.json";
import whatsappTape from "./fixtures/meta/edit-audience-whatsapp.json";
import languageTape from "./fixtures/meta/edit-audience-language.json";
import areaTape from "./fixtures/meta/edit-audience-area-exclusions.json";
import scrubbedRunningTape from "./fixtures/meta/edit-audience-running.json";
import { lacksAreaExclusions } from "@/lib/meta/service-area";

// #773 2/3: POST /api/campaigns/[id]/audience through the real route, connection access, edit service,
// MetaClient, trusted write and audit, on a token sealed by the real token store. Only Supabase (an
// in-memory table store), the LLM and the capability re-check are stubbed; every Graph call is answered
// from the recorded tapes (edit-audience-*.json) and any other call fails the test.
// Recorded: the edit itself (binding checks, source ad set read, validate_only / patch / rebuild writes,
// the #613 refusal). Synthesised from the recorded bodies, as the service reads the tree from Meta before
// editing: the campaign, ad set and ad reads of readCampaignDelivery (their shape is recorded in
// delivery.json; the ad set carries the recorded source targeting, the budget is made up), and the
// patch tapes' ad id (they only recorded ad sets). The service validates only the rebuild path, so the
// patch tapes are replayed without their leading validate_only exchanges (the first four).
// The change is age-only, which the tapes recorded alongside the area, so no exclusions search is needed.
type Exchange = { method: string; path: string; status: number; body: unknown };
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
const STORED = "00000000-0000-4000-8000-000000000004";
const ACCOUNT = "act_2398686420592052", PAGE = "885223068001054", GENERATION = 3;
const available = { state: "available", blockers: [] };
const CHANGE = { age: { min: 30, max: 60 } };

const audit: Row[] = [];
const graph = { sent: [] as Array<{ method: string; path: string }>, pending: [] as Exchange[], forms: [] as Array<Record<string, string>> };
function replay(recorded: Exchange[]) {
  graph.pending = [...recorded];
  graph.sent = [];
  graph.forms = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    url.searchParams.delete("access_token");
    const method = init?.method ?? "GET";
    const path = url.pathname.replace("/v21.0/", "") + url.search;
    graph.sent.push({ method, path });
    if (init?.body instanceof URLSearchParams) graph.forms.push(Object.fromEntries([...init.body].filter(([key]) => key !== "access_token")));
    const index = graph.pending.findIndex(exchange => exchange.method === method && exchange.path === path);
    if (index < 0) throw new Error(`Unrecorded Graph call: ${method} ${path}`);
    const [exchange] = graph.pending.splice(index, 1);
    return Response.json(exchange.body, { status: exchange.status });
  });
}

/** The tree reads of readCampaignDelivery for a recorded tape: its campaign, its source ad set, one ad. */
function scenario(tape: Exchange[], adId: string, skip = 0) {
  const campaignId = tape[1].path.split("/")[0];
  const source = tape[2].body as { id: string; promoted_object: unknown; destination_type: string; targeting: unknown };
  const reads: Exchange[] = [
    { method: "GET", path: `${campaignId}?fields=id%2Caccount_id%2Cstatus%2Ceffective_status%2Cdaily_budget%2Clifetime_budget`, status: 200, body: { id: campaignId, account_id: ACCOUNT.slice(4), status: "PAUSED", effective_status: "PAUSED", daily_budget: "20000", lifetime_budget: "0" } },
    { method: "GET", path: `${campaignId}/adsets?fields=id%2Cstatus%2Ceffective_status%2Cdaily_budget%2Clifetime_budget%2Cpromoted_object%2Cdestination_type%2Ctargeting&limit=100`, status: 200, body: { data: [{ id: source.id, status: "PAUSED", effective_status: "PAUSED", daily_budget: "0", lifetime_budget: "0", promoted_object: source.promoted_object, destination_type: source.destination_type, targeting: source.targeting }] } },
    { method: "GET", path: `${campaignId}/ads?fields=id%2Cstatus%2Ceffective_status%2Cadset_id%2Ccreative%7Bid%7D&limit=100`, status: 200, body: { data: [{ id: adId, status: "PAUSED", effective_status: "PAUSED", adset_id: source.id, creative: { id: "1148404661464451" } }] } },
  ];
  // The recorded ad set has no budget of its own; the campaign carries it.
  return { campaignId, adSetId: source.id, adId, tape: [...reads, ...tape.slice(skip)] };
}
const rebuild = () => {
  const adId = (rebuildTape as Exchange[]).find(exchange => exchange.path.endsWith("/copies"))!.path.split("/")[0];
  return { ...scenario(rebuildTape as Exchange[], adId), newAdSetId: "120253709913520526", newAdId: "120253709917310526" };
};
const patch = () => scenario(patchTape as Exchange[], "120253709953000526", 4);
const limited = () => scenario(rateLimitedTape as Exchange[], "120253709671200526", 4);
const language = () => scenario(languageTape as Exchange[], "120253724289410526", 4);
// #765: recorded on an ACTIVE ad set under a PAUSED test campaign (CEO-approved, deleted after). Its ids are
// metaScrubber() fakes (#1040); the fake account and Page are rebound to this test's connection.
const runningTape = JSON.parse(JSON.stringify(scrubbedRunningTape).replaceAll("9000000000000001", ACCOUNT.slice(4)).replaceAll("900000000000002", PAGE)) as Exchange[];
const running = () => scenario(runningTape, "900000000000000005", 4);
// The area tape starts with the #741 area lookup the service makes from the ad set's current area.
const area = (tape = areaTape as Exchange[]) => {
  const scene = scenario(tape.slice(1), "120253724507960526", 4);
  return { ...scene, tape: [...scene.tape, tape[0]] };
};

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

function stored(scene: { campaignId: string; adSetId: string; adId: string }, values: Row = {}) {
  const row = {
    id: STORED, business_id: BUSINESS, name: "Solaride audience", objective: "leads", status: "paused", daily_budget: 200,
    meta_ad_account_id: ACCOUNT, meta_page_id: PAGE, meta_connection_generation: GENERATION,
    meta_campaign_id: scene.campaignId, meta_adset_id: scene.adSetId, meta_ad_ids: [scene.adId],
    raw: { source: "campaign_operation", metaResult: { campaignId: scene.campaignId, adSetIds: [scene.adSetId], adIds: [scene.adId] } }, ...values,
  };
  (store.state.tables.campaigns ??= []).push(row);
}

const mirror = () => store.state.tables.campaigns[0];
const operations = () => store.state.tables.campaign_edit_operations ?? [];
async function edit(body: Row = {}) {
  const { POST } = await import("@/app/api/campaigns/[id]/audience/route");
  const response = await POST(new Request(`http://localhost/api/campaigns/${STORED}/audience`, {
    method: "POST", body: JSON.stringify({ change: CHANGE, idempotencyKey: "edit-key-0001", ...body }),
  }), { params: Promise.resolve({ id: STORED }) });
  return { status: response.status, body: await response.json() as Row };
}
const writes = () => graph.sent.filter(call => call.method === "POST");

beforeEach(async () => {
  vi.resetModules();
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: "https://core-test.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    META_CONNECT_ROLLOUT: "enabled", META_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), MANAGED_ACCOUNTS_ENABLED: "",
  })) vi.stubEnv(name, value);
  Object.assign(store.state, { tables: {}, user: { id: OWNER }, log: [], inserted: 0, rpc: {
    append_verified_audit_event: (args: Row) => { audit.push(args); return { data: null, error: null }; },
  } });
  audit.length = 0;
  capabilities.verify.mockImplementation(async (_meta: unknown, connection: Row) => connection.capabilities);
  await connect();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("core: edit a launched campaign's audience (#773)", () => {
  it("rebuilds an ad set with interests on the recorded tape and mirrors the new ids only after Meta confirms", async () => {
    const scene = rebuild();
    stored(scene);
    replay(scene.tape);
    const { status, body } = await edit();
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, result: { count: 1, replay: false, consequence: "This restarts Meta's learning; results may be slower for 2–3 days.", adSets: [{ adSetId: scene.newAdSetId, mode: "rebuild", previousAdSetId: scene.adSetId }] } });
    expect(graph.pending).toEqual([]);
    expect(mirror()).toMatchObject({ meta_adset_id: scene.newAdSetId, meta_ad_ids: [scene.newAdId] });
    expect(mirror().raw).toMatchObject({ metaResult: { adSetIds: [scene.newAdSetId], adIds: [scene.newAdId] } });
    expect(operations()).toMatchObject([{ kind: "audience", state: "succeeded", phase: "complete", transmitted: true }]);
    expect(JSON.stringify(audit)).toContain("campaign.edit");
  });

  // #890 (Reviewer): a `raw` key written while Meta is being edited (the refresh cron's health, a budget
  // or ad edit) survives the mirror; only the children change.
  it("keeps raw written during the Meta round trips when it mirrors the new ids", async () => {
    const scene = rebuild();
    stored(scene);
    replay(scene.tape);
    const answer = vi.mocked(globalThis.fetch).getMockImplementation()!;
    const health = { checkedAt: "2026-10-26T13:00:00.000Z", flags: [] };
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      if (init?.method === "POST" && String(input).includes("/copies")) mirror().raw = { ...mirror().raw as Row, health };
      return answer(input, init);
    });
    const { status } = await edit();
    expect(status).toBe(200);
    expect(mirror()).toMatchObject({ meta_adset_id: scene.newAdSetId, meta_ad_ids: [scene.newAdId] });
    expect(mirror().raw).toMatchObject({ health, source: "campaign_operation", metaResult: { adSetIds: [scene.newAdSetId], adIds: [scene.newAdId] } });
  });

  it("previews a rebuild with validate_only and changes nothing", async () => {
    const scene = rebuild();
    stored(scene);
    replay(scene.tape);
    const { status, body } = await edit({ preview: true });
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, preview: { adSets: [{ adSetId: scene.adSetId, mode: "rebuild", validated: true }], consequence: expect.stringContaining("restarts Meta's learning") } });
    expect(writes()).toHaveLength(1);
    expect(mirror()).toMatchObject({ meta_adset_id: scene.adSetId });
    expect(operations()).toEqual([]);
  });

  // #912: a WhatsApp ad set has no interests but can't be patched; the service plans a rebuild and says so.
  it("plans a rebuild for a WhatsApp ad set without interests", async () => {
    const adId = (whatsappTape as Exchange[]).find(exchange => exchange.path.endsWith("/copies"))!.path.split("/")[0];
    const scene = scenario(whatsappTape as Exchange[], adId);
    stored(scene);
    replay(scene.tape);
    const { status, body } = await edit({ preview: true });
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, preview: { adSets: [{ adSetId: scene.adSetId, mode: "rebuild", validated: true }], consequence: expect.stringContaining("restarts Meta's learning") } });
    expect(writes()).toHaveLength(1);
  });

  it("rebuilds a WhatsApp ad set end to end and moves the stored ids to the new ad set and ad", async () => {
    const adId = (whatsappTape as Exchange[]).find(exchange => exchange.path.endsWith("/copies"))!.path.split("/")[0];
    const scene = scenario(whatsappTape as Exchange[], adId);
    const newAdSetId = ((whatsappTape as Exchange[]).find(exchange => exchange.method === "POST" && /^act_\d+\/adsets$/.test(exchange.path) && (exchange.body as { id?: string }).id)!.body as { id: string }).id;
    const newAdId = ((whatsappTape as Exchange[]).find(exchange => exchange.path.endsWith("/copies"))!.body as { copied_ad_id: string }).copied_ad_id;
    stored(scene);
    replay(scene.tape);
    const { status, body } = await edit();
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, result: { count: 1, adSets: [{ adSetId: newAdSetId, mode: "rebuild", previousAdSetId: scene.adSetId }] } });
    expect(graph.pending).toEqual([]);
    expect(mirror()).toMatchObject({ meta_adset_id: newAdSetId, meta_ad_ids: [newAdId] });
    expect(mirror().raw).toMatchObject({ metaResult: { adSetIds: [newAdSetId], adIds: [newAdId] } });
  });

  it("patches an ad set without interests in place and keeps the ids", async () => {
    const scene = patch();
    stored(scene);
    replay(scene.tape);
    const { status, body } = await edit();
    expect(status).toBe(200);
    expect(body).toMatchObject({ result: { count: 1, consequence: null, adSets: [{ adSetId: scene.adSetId, mode: "patch", previousAdSetId: null }] } });
    expect(mirror()).toMatchObject({ meta_adset_id: scene.adSetId, meta_ad_ids: [scene.adId] });
    expect(operations()).toMatchObject([{ state: "succeeded", transmitted: true }]);
  });

  it("changes only the language through the route, patched in place and audited", async () => {
    const scene = language();
    stored(scene);
    replay(scene.tape);
    const { status, body } = await edit({ change: { languages: [1001, 46] } });
    expect(status).toBe(200);
    expect(body).toMatchObject({ result: { count: 1, consequence: null, adSets: [{ adSetId: scene.adSetId, mode: "patch" }] } });
    expect(operations()).toMatchObject([{ state: "succeeded", transmitted: true, change: { languages: [1001, 46] } }]);
    expect(JSON.stringify(audit)).toContain("(language)");
    expect(graph.pending).toEqual([]);
  });

  // #746: a tree launched before #741 (no out-of-area exclusions) can't be turned on; this adds its area's exclusions.
  it("adds the missing out-of-area exclusions from the ad set's own area, so activation's gate passes", async () => {
    const scene = area();
    stored(scene);
    replay(scene.tape);
    const source = (areaTape as Exchange[])[3].body as { targeting: unknown };
    expect(lacksAreaExclusions(source.targeting)).toBe(true);
    const { status, body } = await edit({ change: { areaExclusions: true } });
    expect(status).toBe(200);
    expect(body).toMatchObject({ result: { count: 1, consequence: null, adSets: [{ adSetId: scene.adSetId, mode: "patch" }] } });
    expect(graph.forms).toHaveLength(1);
    const sent = JSON.parse(graph.forms[0].targeting);
    const readBack = (areaTape as Exchange[]).at(-1)!.body as { targeting: { excluded_geo_locations: { regions: Array<{ key: string }> } } };
    expect(lacksAreaExclusions(readBack.targeting)).toBe(false);
    // Chandigarh's own UT stays in; every other state and UT is left out.
    expect(readBack.targeting.excluded_geo_locations.regions).toHaveLength(35);
    expect(readBack.targeting.excluded_geo_locations.regions.map(region => region.key)).not.toContain("1726");
    expect(sent.excluded_geo_locations.regions.map((region: { key: string }) => region.key))
      .toEqual(readBack.targeting.excluded_geo_locations.regions.map(region => region.key));
    expect(sent.geo_locations).toEqual((source.targeting as { geo_locations: unknown }).geo_locations);
    expect(JSON.stringify(audit)).toContain("(out-of-area exclusions)");
    expect(graph.pending).toEqual([]);
  });

  it("refuses to add area exclusions to a country-wide campaign before any write", async () => {
    const tape = structuredClone(areaTape) as Exchange[];
    (tape[3].body as { targeting: { geo_locations: unknown } }).targeting.geo_locations = { countries: ["IN"], location_types: ["home", "recent"] };
    const scene = area(tape);
    stored(scene);
    replay(scene.tape);
    const { status, body } = await edit({ change: { areaExclusions: true } });
    expect(status).toBe(409);
    expect(body.error).toBe("This campaign covers a whole country, so there are no out-of-area places to leave out.");
    expect(writes()).toEqual([]);
  });

  // The recorded read-back is the ad set after the one-click: it already leaves out every out-of-area place.
  const covered = () => ((areaTape as Exchange[]).at(-1)!.body as { targeting: { excluded_geo_locations: unknown } }).targeting.excluded_geo_locations;

  it("refuses the one-click before any write when the ad set already has every out-of-area exclusion", async () => {
    const tape = structuredClone(areaTape) as Exchange[];
    (tape[3].body as { targeting: Row }).targeting.excluded_geo_locations = covered();
    const scene = area(tape);
    stored(scene);
    replay(scene.tape);
    const { status, body } = await edit({ change: { areaExclusions: true } });
    expect(status).toBe(409);
    expect(body.error).toBe("Every ad set already leaves out the places outside its area. Nothing to change.");
    expect(writes()).toEqual([]);
  });

  // #157's tree: one ad set built before #741, its sibling after. Only the bare one is changed (no needless review).
  it("leaves an ad set that already has the exclusions alone and changes only the one that lacks them", async () => {
    const scene = area();
    const sibling = { id: "120253724506000999", adId: "120253724507960999" };
    const [campaignRead, adSetsRead, adsRead, ...rest] = scene.tape;
    const bare = (adSetsRead.body as { data: Array<Row & { targeting: Row }> }).data[0];
    const tree = [
      campaignRead,
      { ...adSetsRead, body: { data: [bare, { ...bare, id: sibling.id, targeting: { ...bare.targeting, excluded_geo_locations: covered() } }] } },
      { ...adsRead, body: { data: [...(adsRead.body as { data: Row[] }).data, { id: sibling.adId, status: "PAUSED", effective_status: "PAUSED", adset_id: sibling.id, creative: { id: "1148404661464451" } }] } },
      ...rest, rest.at(-1)!,
    ];
    stored(scene, {
      meta_ad_ids: [scene.adId, sibling.adId],
      raw: { source: "campaign_operation", metaResult: { campaignId: scene.campaignId, adSetIds: [scene.adSetId, sibling.id], adIds: [scene.adId, sibling.adId] } },
    });
    replay(tree);
    const { status, body } = await edit({ change: { areaExclusions: true } });
    expect(status).toBe(200);
    expect(body).toMatchObject({ result: { count: 1, adSets: [{ adSetId: scene.adSetId, mode: "patch" }] } });
    expect(writes().map(call => call.path.split("?")[0])).toEqual([scene.adSetId]);
    expect(graph.sent.some(call => call.path.startsWith(sibling.id))).toBe(false);
  });

  it("turns Meta's 613 on the patch into a retryable failure before any write, leaving the mirror alone", async () => {
    const scene = limited();
    stored(scene);
    replay(scene.tape);
    const before = structuredClone(mirror());
    const { status, body } = await edit();
    expect(status).toBe(429);
    expect(body).toMatchObject({ error: "Meta needs 30 seconds between audience changes. Try again in a moment.", retryable: true });
    expect(operations()).toMatchObject([{ state: "failed", transmitted: false }]);
    expect(mirror()).toEqual(before);
  });

  // #765: a running campaign. The tree reads are synthesised with status ACTIVE; the running tape's ad set reads,
  // patch and read-back are Meta's real answers for an ACTIVE ad set.
  const live = (tape: Exchange[], scope: "tree" | "all" = "all", campaignToo = true) => structuredClone(tape).map((exchange, index) => {
    const body = exchange.body as { status?: string; effective_status?: string; data?: Array<{ status?: string; effective_status?: string }> };
    if (index === 0 && campaignToo) Object.assign(body, { status: "ACTIVE", effective_status: "ACTIVE" });
    if (index === 1) body.data?.forEach(adSet => Object.assign(adSet, { status: "ACTIVE", effective_status: "ACTIVE" }));
    if (scope === "all" && index > 2 && exchange.method === "GET" && body.status === "PAUSED") body.status = "ACTIVE";
    return exchange;
  });

  it("patches a running lead-form campaign in place: it keeps running and learning restarts", async () => {
    const scene = running();
    expect(((runningTape as Exchange[])[6].body as { status: string }).status).toBe("ACTIVE");
    expect(((runningTape as Exchange[]).at(-1)!.body as { status: string }).status).toBe("ACTIVE");
    stored(scene, { status: "active" });
    replay(live(scene.tape, "tree"));
    const { status, body } = await edit();
    expect(status).toBe(200);
    expect(body).toMatchObject({ result: { count: 1, consequence: "This restarts Meta's learning; results may be slower for 2–3 days.", adSets: [{ adSetId: scene.adSetId, mode: "patch", previousAdSetId: null }] } });
    expect(writes().map(call => call.path)).toEqual([scene.adSetId]);
    expect(mirror()).toMatchObject({ status: "active", meta_adset_id: scene.adSetId, meta_ad_ids: [scene.adId] });
  });

  it("asks before copying a running WhatsApp or interest-based ad set, and writes nothing without the OK", async () => {
    const scene = rebuild();
    stored(scene, { status: "active" });
    replay(live(scene.tape, "tree"));
    const { status, body } = await edit();
    expect(status).toBe(409);
    expect(body).toMatchObject({ code: "needs_copy", error: "Meta doesn't allow this change on a running campaign. We'll make a fresh copy with your change (paused, back to review, learning restarts) and stop the old one when you turn the new one on." });
    expect(writes()).toEqual([]);
  });

  // #765 (b): Check with Meta on a running rebuild reports a copy (validated) instead of refusing.
  it("previews a running rebuild as a copy, validated by Meta, with nothing written", async () => {
    const scene = rebuild();
    stored(scene, { status: "active" });
    replay(live(scene.tape, "tree"));
    const { status, body } = await edit({ preview: true });
    expect(status).toBe(200);
    expect(body.preview).toMatchObject({ adSets: [{ adSetId: scene.adSetId, mode: "copy", validated: true }] });
    expect(writes().every(call => graph.forms[graph.sent.filter(sent => sent.method === "POST").indexOf(call)]?.execution_options)).toBe(true);
  });

  it("with the owner's OK, builds a PAUSED copy, keeps the old ad set running and the mirror unchanged, and waits", async () => {
    const scene = rebuild();
    stored(scene, { status: "active" });
    replay(live(scene.tape, "tree"));
    const before = structuredClone(mirror());
    const { status, body } = await edit({ copy: true });
    expect(status).toBe(200);
    const result = body.result as { adSets: unknown[]; awaitingSwitch: { operationId: string; pending: Array<{ from: { adSetId: string }; to: { adSetId: string; adIds: string[] } }> } };
    expect(result.adSets).toEqual([{ adSetId: scene.newAdSetId, previousAdSetId: scene.adSetId, mode: "copy" }]);
    expect(result.awaitingSwitch.pending).toEqual([{ from: { adSetId: scene.adSetId, adIds: [scene.adId] }, to: { adSetId: scene.newAdSetId, adIds: [scene.newAdId] } }]);
    // The old ad set is never paused or archived by the copy.
    expect(graph.forms.some(form => form.status === "ARCHIVED" || form.status === "PAUSED" && !form.name)).toBe(false);
    expect(mirror()).toEqual(before);
    expect(operations()).toMatchObject([{ id: result.awaitingSwitch.operationId, state: "awaiting_switch", phase: "copy", transmitted: true }]);
    expect(JSON.stringify(audit)).toContain("waiting to be turned on");

    // A retry with the same key replays the waiting copy instead of building a second one.
    const calls = graph.sent.length;
    expect((await edit({ copy: true })).body).toMatchObject({ result: { awaitingSwitch: { operationId: result.awaitingSwitch.operationId }, replay: true } });
    expect(graph.sent).toHaveLength(calls);
    // Any other edit waits for the switch or cancel, before calling Meta.
    const other = await edit({ change: { age: { min: 25, max: 40 } }, idempotencyKey: "edit-key-0002" });
    expect(other).toMatchObject({ status: 409, body: { code: "switch_pending", error: "A new audience is waiting for this campaign. Turn it on or cancel it first." } });
    expect(graph.sent).toHaveLength(calls);
  });

  it("asks to pause first when a paused campaign still has a live ad set in Meta", async () => {
    const scene = patch();
    stored(scene);
    replay(live(scene.tape, "tree", false));
    const { status, body } = await edit();
    expect(status).toBe(409);
    expect(body.error).toBe("Part of this campaign is still running in Meta. Pause the campaign, then edit the audience.");
    expect(writes()).toEqual([]);
  });

  it("replays a finished edit by its idempotency key without calling Meta again, and refuses the key for another change", async () => {
    const scene = patch();
    stored(scene);
    replay(scene.tape);
    const first = await edit();
    const calls = graph.sent.length;
    const again = await edit();
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ result: { ...(first.body.result as Row), replay: true } });
    expect(graph.sent).toHaveLength(calls);
    const other = await edit({ change: { age: { min: 25, max: 40 } } });
    expect(other.status).toBe(409);
    expect(graph.sent).toHaveLength(calls);
  });

  it("answers 401 without a session, 404 for another owner's campaign and 400 for an empty change", async () => {
    const scene = patch();
    stored(scene);
    replay([]);
    expect((await edit({ change: {} })).status).toBe(400);
    expect((await edit({ change: { languages: [9999] } })).status).toBe(400);
    expect((await edit({ change: { languages: [46, 46] } })).status).toBe(400);
    expect((await edit({ change: { areaExclusions: true, location: { countries: ["IN"] } } })).status).toBe(400);
    store.state.user = null;
    expect((await edit()).status).toBe(401);
    store.state.user = { id: OWNER };
    store.state.tables.campaigns = [];
    expect((await edit()).status).toBe(404);
    expect(graph.sent).toEqual([]);
  });
});

describe("core: the mirror keeps intendedCampaignChildren valid after an edit (#773)", () => {
  it("moves a rebuilt ad set and its ads in place, and keeps a rebuilt capped ad set capped", async () => {
    const { mirroredChildren } = await import("@/lib/campaign/edit-service");
    const { intendedCampaignChildren } = await import("@/lib/campaign/activation");
    const campaign = {
      meta_campaign_id: "100", meta_adset_id: "1", meta_ad_ids: ["11", "12"],
      raw: { source: "campaign_operation", metaResult: { campaignId: "100", adSetIds: ["1", "2"], adIds: ["11", "12"] }, cappedAdSetIds: ["2"], cap: { adSetId: "2", spendCapRupees: 500 } },
    } as never;
    const next = mirroredChildren(campaign, [
      { from: { adSetId: "1", adIds: ["11"] }, to: { mode: "rebuild", validated: false, adSetId: "3", adIds: ["13"], retiredAdSetId: "1" } },
      { from: { adSetId: "2", adIds: ["12"] }, to: { mode: "rebuild", validated: false, adSetId: "4", adIds: ["14"], retiredAdSetId: "2" } },
    ]);
    expect(next).toMatchObject({ meta_adset_id: "3", meta_ad_ids: ["13", "14"], raw: { metaResult: { adSetIds: ["3", "4"], adIds: ["13", "14"] }, cappedAdSetIds: ["4"], cap: { adSetId: "4", spendCapRupees: 500 } } });
    expect(intendedCampaignChildren({ meta_campaign_id: "100", ...next })).toMatchObject({ adSetIds: ["3", "4"], cappedAdSetIds: ["4"] });
  });

  it("leaves patched ad sets exactly as stored", async () => {
    const { mirroredChildren } = await import("@/lib/campaign/edit-service");
    const campaign = { meta_campaign_id: "100", meta_adset_id: "1", meta_ad_ids: ["11"], raw: { source: "campaign_operation", metaResult: { campaignId: "100", adSetIds: ["1"], adIds: ["11"] } } } as never;
    expect(mirroredChildren(campaign, [{ from: { adSetId: "1", adIds: ["11"] }, to: { mode: "patch", validated: false, adSetId: "1", adIds: ["11"], retiredAdSetId: null } }]))
      .toMatchObject({ meta_adset_id: "1", meta_ad_ids: ["11"], raw: { metaResult: { adSetIds: ["1"], adIds: ["11"] } } });
  });
});

// #765 (b): turning a waiting copy on, or cancelling it. A scripted Graph until the switch recording lands.
describe("core: switch to or cancel a waiting new audience (#765 b)", () => {
  const NEW_AD_SET = "900000000000000006", NEW_AD = "900000000000000007";
  type Node = { id: string; campaign_id: string; status: string; lifetime_budget?: string; budget_remaining?: string };
  function scripted(scene: { campaignId: string; adSetId: string; adId: string }, options: { refuseActivation?: boolean } = {}) {
    const nodes = new Map<string, Node>([
      [scene.adSetId, { id: scene.adSetId, campaign_id: scene.campaignId, status: "ACTIVE", lifetime_budget: "0" }],
      [NEW_AD_SET, { id: NEW_AD_SET, campaign_id: scene.campaignId, status: "PAUSED", lifetime_budget: "0" }],
      [NEW_AD, { id: NEW_AD, campaign_id: scene.campaignId, status: "PAUSED" }],
    ]);
    const writes: Array<{ id: string; form: Record<string, string>; method: string }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      const [id, edge] = url.pathname.split("/").slice(2);
      const method = init?.method ?? "GET";
      if (method === "GET") {
        if (edge === "ads") return Response.json({ data: [{ id: NEW_AD, status: nodes.get(NEW_AD)!.status, adset_id: NEW_AD_SET }] });
        return nodes.has(id) ? Response.json(nodes.get(id)) : Response.json({ error: { message: "Unknown node", code: 100 } }, { status: 400 });
      }
      const form = init?.body instanceof URLSearchParams ? Object.fromEntries([...init.body].filter(([key]) => key !== "access_token")) : {};
      writes.push({ id, form, method });
      if (options.refuseActivation && id === NEW_AD_SET && form.status === "ACTIVE" && !form.execution_options) return Response.json({ error: { message: "Ad set refused", code: 100 } }, { status: 400 });
      if (method === "DELETE") nodes.delete(id);
      else if (!form.execution_options && form.status) nodes.get(id)!.status = form.status;
      return Response.json({ success: true });
    });
    return { nodes, writes };
  }
  function waiting(scene: { adSetId: string; adId: string }) {
    const pending = [{ from: { adSetId: scene.adSetId, adIds: [scene.adId] }, to: { adSetId: NEW_AD_SET, adIds: [NEW_AD] } }];
    const id = "00000000-0000-4000-9000-00000000a765";
    store.state.tables.campaign_edit_operations = [{
      id, business_id: BUSINESS, campaign_id: STORED, kind: "audience", idempotency_key: "edit-key-0001", request_hash: "a".repeat(64),
      state: "awaiting_switch", phase: "copy", transmitted: true,
      result: { adSets: [{ adSetId: NEW_AD_SET, previousAdSetId: scene.adSetId, mode: "copy" }], count: 1, consequence: null, awaitingSwitch: { operationId: id, pending } },
    }];
    return id;
  }
  async function act(operationId: string, action: "switch" | "cancel") {
    const { POST } = await import("@/app/api/campaigns/[id]/audience/switch/route");
    const response = await POST(new Request(`http://localhost/api/campaigns/${STORED}/audience/switch`, { method: "POST", body: JSON.stringify({ operationId, action }) }), { params: Promise.resolve({ id: STORED }) });
    return { status: response.status, body: await response.json() as Row };
  }

  it("switches: the old ad set is paused before the copy goes ACTIVE, then retired; the mirror moves to the copy", async () => {
    const scene = rebuild();
    stored(scene, { status: "active" });
    const meta = scripted(scene);
    const operationId = waiting(scene);
    const { status, body } = await act(operationId, "switch");
    expect(status).toBe(200);
    expect(body.result).toMatchObject({ action: "switch", adSets: [{ adSetId: NEW_AD_SET, previousAdSetId: scene.adSetId }] });
    expect(meta.writes.map(write => `${write.id}:${write.form.status}${write.form.execution_options ? ":validate" : ""}`)).toEqual([
      `${NEW_AD_SET}:ACTIVE:validate`, `${scene.adSetId}:PAUSED`, `${NEW_AD}:ACTIVE`, `${NEW_AD_SET}:ACTIVE`, `${scene.adSetId}:ARCHIVED`,
    ]);
    expect(mirror()).toMatchObject({ meta_adset_id: NEW_AD_SET, meta_ad_ids: [NEW_AD], raw: { metaResult: { adSetIds: [NEW_AD_SET], adIds: [NEW_AD] } } });
    expect(operations()).toMatchObject([{ state: "succeeded", phase: "complete" }]);
    // Replays by operation, without calling Meta again.
    const calls = meta.writes.length;
    expect((await act(operationId, "switch")).body).toMatchObject({ result: { replay: true } });
    expect(meta.writes).toHaveLength(calls);
  });

  it("keeps waiting (retryable) when Meta refuses the copy after the pause, with the old ad set running again", async () => {
    const scene = rebuild();
    stored(scene, { status: "active" });
    const before = structuredClone(mirror());
    const meta = scripted(scene, { refuseActivation: true });
    const operationId = waiting(scene);
    const { status, body } = await act(operationId, "switch");
    expect(status).toBe(409);
    expect(body).toMatchObject({ retryable: true });
    expect(String(body.error)).toContain("The old audience is running again.");
    expect(meta.nodes.get(scene.adSetId)!.status).toBe("ACTIVE");
    expect(meta.nodes.get(NEW_AD_SET)!.status).toBe("PAUSED");
    expect(mirror()).toEqual(before);
    expect(operations()).toMatchObject([{ state: "awaiting_switch", phase: "copy" }]);
  });

  it("cancels: deletes only the copy, never writes the running ad set, and the campaign can be edited again", async () => {
    const scene = rebuild();
    stored(scene, { status: "active" });
    const before = structuredClone(mirror());
    const meta = scripted(scene);
    const operationId = waiting(scene);
    const { status, body } = await act(operationId, "cancel");
    expect(status).toBe(200);
    expect(body.result).toMatchObject({ action: "cancel", adSets: [{ adSetId: NEW_AD_SET, previousAdSetId: scene.adSetId }] });
    expect(meta.writes).toEqual([{ id: NEW_AD_SET, form: {}, method: "DELETE" }]);
    expect(meta.nodes.get(scene.adSetId)!.status).toBe("ACTIVE");
    expect(mirror()).toEqual(before);
    expect(operations()).toMatchObject([{ state: "cancelled" }]);
    expect((await act(operationId, "switch")).status).toBe(409);
  });

  it("answers 404 for another campaign's operation and 400 for a bad action", async () => {
    const scene = rebuild();
    stored(scene, { status: "active" });
    scripted(scene);
    waiting(scene);
    expect((await act("00000000-0000-4000-9000-0000000000ff", "switch")).status).toBe(404);
    const { POST } = await import("@/app/api/campaigns/[id]/audience/switch/route");
    const bad = await POST(new Request(`http://localhost/api/campaigns/${STORED}/audience/switch`, { method: "POST", body: JSON.stringify({ operationId: "x", action: "go" }) }), { params: Promise.resolve({ id: STORED }) });
    expect(bad.status).toBe(400);
  });
});
