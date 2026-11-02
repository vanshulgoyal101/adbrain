import { afterEach, beforeEach, expect, vi } from "vitest";
import leadsTape from "./fixtures/meta/leads.json";
import revokedToken from "./fixtures/meta/token-revoked.json";

// Graph lead-form and lead pages recorded read-only from the Solaride Page by
// scripts/record-meta-lead-fixtures.ts, with one Meta test lead (#165).
type Exchange = { method: string; path: string; status: number; body: unknown };
type Progress = { formsDone: boolean; pending: unknown[] } & Record<string, unknown>;
type SyncRun = { id: string; version: number; state: "partial" | "complete"; progress: Progress };
type DbFailure = { code: string; message?: string; details: null; hint: null };

const SECRET = "cron-secret-value";
const businessId = "816aaafb-7ebc-4ad7-bbda-001beff172f8";
const creds = { adAccountId: "act_9000000000000001", pageId: "900000000000002", accessToken: "test-token" };
const testLead = "1751001369523985";
const checkpointRace: DbFailure = {
  code: "40001", message: "Sync progress changed; reload and resume", details: null, hint: null,
};

const db = vi.hoisted(() => ({
  runs: new Map<string, SyncRun>(),
  leads: new Map<string, Record<string, unknown>>(),
  connections: [] as { business_id: string }[],
  scopes: [] as Array<{ name: string; businessId: string; ownerId: string; generation: number; adAccountId: string; pageId: string; rowBusinessIds: unknown[] }>,
  runCount: 0,
  startError: null as DbFailure | null,
  checkpointError: null as DbFailure | null,
  checkpointErrorVersion: null as number | null,
  startBarrier: null as null | (() => Promise<void>),
  // #701: the owner's alert prefs and send log (owner_alert_prefs / owner_alert_sends).
  prefs: null as null | { lead_alerts: true },
  sends: [] as { id: number; dedupe_key: string; state: string; wa_message_id: string | null }[],
  failAlertReads: false,
}));

function alertTable(table: string) {
  const filters: { op: string; args: unknown[] }[] = [];
  const rows = (): unknown[] => {
    if (table === "owner_alert_prefs") return db.prefs ? [db.prefs] : [];
    if (table === "businesses") return [{ name: "Solaride" }];
    if (table === "campaigns") return [];
    if (table === "owner_alert_sends") {
      const keys = filters.find(f => f.op === "in")?.args[1] as string[];
      return db.sends.filter(send => send.state !== "retry" && keys.includes(send.dedupe_key));
    }
    expect(table).toBe("leads");
    const since = Date.parse(filters.find(f => f.op === "gte")?.args[1] as string);
    return [...db.leads.values()].map((row, index): Record<string, unknown> => ({ id: `lead-row-${index}`, source: "meta_form", campaign_id: null, ...row }))
      .filter(row => Date.parse(String(row.created_time).replace("+0000", "Z")) >= since);
  };
  const result = () => db.failAlertReads ? { data: null, error: { message: "down" } } : { data: rows(), error: null };
  const query: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown) => resolve(result()),
    maybeSingle: async () => { const r = result(); return { ...r, data: (r.data as unknown[] | null)?.[0] ?? null }; },
  };
  for (const op of ["select", "eq", "not", "is", "gte", "order", "limit", "neq", "in"]) query[op] = (...args: unknown[]) => { filters.push({ op, args }); return query; };
  return query;
}

function alertRpc(name: string, args: Record<string, unknown>) {
  if (name === "owner_alert_claim") {
    if (db.sends.some(send => send.dedupe_key === args.p_key && send.state !== "retry")) return { data: { claimed: false, reason: "duplicate" }, error: null };
    db.sends.push({ id: db.sends.length + 1, dedupe_key: String(args.p_key), state: "pending", wa_message_id: null });
    return { data: { claimed: true, sendId: db.sends.length, phone: "+919999999001", language: "en" }, error: null };
  }
  expect(name).toBe("owner_alert_settle");
  const send = db.sends.find(row => row.id === args.p_send_id)!;
  Object.assign(send, { state: args.p_state, wa_message_id: args.p_wa_message_id });
  return { data: null, error: null };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== "meta_connections") return alertTable(table);
      let after = false;
      const query = {
        select: () => query, eq: () => query, not: () => query, order: () => query, limit: () => query,
        gt: () => { after = true; return query; },
        then: (resolve: (value: unknown) => unknown) => resolve({ data: after ? [] : db.connections, error: null }),
      };
      return query;
    },
    rpc: (name: string, args: { p_business_id: string; p_owner_id: string; p_generation: number; p_ad_account_id: string; p_page_id: string; p_sync_id: string | null; p_version: number; p_rows: Record<string, unknown>[]; p_progress: Progress }) => name.startsWith("owner_alert_") ? Promise.resolve(alertRpc(name, args)) : ({
      abortSignal: async () => {
        db.scopes.push({
          name, businessId: args.p_business_id, ownerId: args.p_owner_id, generation: args.p_generation,
          adAccountId: args.p_ad_account_id, pageId: args.p_page_id, rowBusinessIds: (args.p_rows ?? []).map(row => row.business_id),
        });
        let run = db.runs.get(args.p_business_id);
        if (name === "lead_sync_start") {
          if (db.startError) return { data: null, error: db.startError };
          if (!run || run.state === "complete") {
            run = {
              id: `00000000-0000-4000-8000-${String(++db.runCount).padStart(12, "0")}`, version: 0, state: "partial",
              progress: { formsDone: false, formsAfter: null, formsSeen: [], formIds: [], pending: [], discover: true },
            };
            db.runs.set(args.p_business_id, run);
          }
          const snapshot = structuredClone(run);
          await db.startBarrier?.();
          return { data: [snapshot], error: null };
        }
        if (db.checkpointError && (db.checkpointErrorVersion === null || db.checkpointErrorVersion === args.p_version)) {
          return { data: null, error: db.checkpointError };
        }
        if (!run || run.id !== args.p_sync_id || run.version !== args.p_version) return { data: null, error: checkpointRace };
        let imported = 0;
        for (const row of args.p_rows) {
          const key = `${args.p_business_id}:${row.meta_lead_id}`;
          if (db.leads.has(key)) continue; // on conflict (business_id, meta_lead_id) do nothing
          db.leads.set(key, row);
          imported++;
        }
        run = {
          ...run, version: run.version + 1, progress: structuredClone(args.p_progress),
          state: args.p_progress.formsDone && args.p_progress.pending.length === 0 ? "complete" : "partial",
        };
        db.runs.set(args.p_business_id, run);
        return { data: { run: structuredClone(run), imported }, error: null };
      },
    }),
  }),
}));

vi.mock("@/lib/meta/managed-account", () => ({ getManagedAccount: async () => null }));
const deadBusiness = "0b7f1d2e-0000-4000-8000-00000000dead";

vi.mock("@/lib/meta/connection-access", () => {
  return {
    requireScheduledBusiness: async (id: string) => ({ businessId: id, userId: "owner-1" }),
    withMetaConnection: async (context: { businessId: string }, options: { purpose: string; signal?: AbortSignal }, execute: (meta: unknown, connection: unknown) => unknown) => {
      const { MetaClient } = await import("@/lib/meta/client");
      expect(options.purpose).toBe("read_leads");
      const accessToken = context.businessId === deadBusiness ? "dead-token" : creds.accessToken;
      return execute(new MetaClient({ ...creds, accessToken }, options.signal), { generation: 1, selected: { adAccountId: creds.adAccountId, pageId: creds.pageId } });
    },
  };
});

// Cloud API's documented answer to a template send (#701); recorded once AdBrain's WABA exists.
const CLOUD_ACCEPTED = { messaging_product: "whatsapp", contacts: [{ input: "919999999001", wa_id: "919999999001" }], messages: [{ id: "wamid.HBgMOTE5OTk5OTk5MDAxFQIAERgSQUJDREVGMDEyMzQ1Njc4OQA=" }] };

function replay(
  fail?: (path: string) => boolean, edit?: (path: string, body: unknown) => unknown,
  whatsapp: unknown[] = [], failure?: { status: number; body: unknown } | ((path: string) => { status: number; body: unknown }),
) {
  const sent: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (init?.method === "POST" && url.pathname === "/v26.0/106540352242922/messages") {
      whatsapp.push(JSON.parse(String(init.body)));
      return Response.json(CLOUD_ACCEPTED);
    }
    expect(url.origin + url.pathname.slice(0, 7)).toBe("https://graph.facebook.com/v26.0/");
    // #1649: the token rides in the Authorization header.
    if (new Headers(init?.headers).get("authorization")?.replace(/^Bearer /, "") === "dead-token") return Response.json(revokedToken.body, { status: revokedToken.status });
    expect(init?.method ?? "GET").toBe("GET");
    url.searchParams.delete("appsecret_proof");
    const path = url.pathname.replace("/v26.0/", "") + url.search;
    sent.push(path);
    if (fail?.(path)) {
      const answer = typeof failure === "function" ? failure(path) : failure;
      return Response.json(answer?.body ?? { error: { message: "Service temporarily unavailable", code: 2 } }, { status: answer?.status ?? 503 });
    }
    const exchange = (leadsTape as Exchange[]).find(item => item.path === path);
    if (!exchange) throw new Error(`Unrecorded Graph call: GET ${path}`);
    return Response.json(edit ? edit(path, structuredClone(exchange.body)) : exchange.body, { status: exchange.status });
  });
  return sent;
}

function seedRepeatedCursorRun() {
  db.runs.set(businessId, {
    id: "00000000-0000-4000-8000-000000000001", version: 0, state: "partial",
    progress: {
      formsDone: true, formsAfter: null, formsSeen: [], formIds: ["2531491190682703", "1667547894289050"],
      pending: [
        { id: "2531491190682703", name: "First", after: null, seen: [], failed: false },
        { id: "1667547894289050", name: "Second", after: null, seen: ["repeated"], failed: false },
      ],
      discover: false,
    },
  });
}

function repeatedCursor(path: string, body: unknown) {
  return path.startsWith("1667547894289050/leads")
    ? { ...body as object, paging: { next: "https://graph.facebook.com/next", cursors: { after: "repeated" } } }
    : body;
}

async function run(auth: string | null = `Bearer ${SECRET}`) {
  const { GET } = await import("@/app/api/cron/sync-leads/route");
  const response = await GET(new Request("https://adbrain.vanshul.com/api/cron/sync-leads", {
    headers: auth ? { authorization: auth } : {},
  }));
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  vi.resetModules();
  db.runs.clear();
  db.leads.clear();
  db.scopes = [];
  db.runCount = 0;
  db.startError = null;
  db.checkpointError = null;
  db.checkpointErrorVersion = null;
  db.startBarrier = null;
  db.connections = [{ business_id: businessId }];
  db.prefs = null;
  db.sends = [];
  db.failAlertReads = false;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("CRON_SECRET", SECRET);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

export { businessId, checkpointRace, CLOUD_ACCEPTED, db, deadBusiness, replay, repeatedCursor, run, seedRepeatedCursorRun, testLead };
