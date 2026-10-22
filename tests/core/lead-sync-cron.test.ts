import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import leadsTape from "./fixtures/meta/leads.json";

// Graph lead-form and lead pages recorded read-only from the Solaride Page by
// scripts/record-meta-lead-fixtures.ts, with one Meta test lead (#165).
type Exchange = { method: string; path: string; status: number; body: unknown };
type Progress = { formsDone: boolean; pending: unknown[] } & Record<string, unknown>;
type SyncRun = { id: string; version: number; state: "partial" | "complete"; progress: Progress };

const SECRET = "cron-secret-value";
const businessId = "816aaafb-7ebc-4ad7-bbda-001beff172f8";
const creds = { adAccountId: "act_2398686420592052", pageId: "885223068001054", accessToken: "test-token" };
const testLead = "1751001369523985";

const db = vi.hoisted(() => ({
  runs: new Map<string, SyncRun>(),
  leads: new Map<string, Record<string, unknown>>(),
  connections: [] as { business_id: string }[],
  runCount: 0,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      expect(table).toBe("meta_connections");
      let after = false;
      const query = {
        select: () => query, eq: () => query, not: () => query, order: () => query, limit: () => query,
        gt: () => { after = true; return query; },
        then: (resolve: (value: unknown) => unknown) => resolve({ data: after ? [] : db.connections, error: null }),
      };
      return query;
    },
    rpc: (name: string, args: { p_business_id: string; p_sync_id: string | null; p_version: number; p_rows: Record<string, unknown>[]; p_progress: Progress }) => ({
      abortSignal: async () => {
        let run = db.runs.get(args.p_business_id);
        if (name === "lead_sync_start") {
          if (!run || run.state === "complete") {
            run = {
              id: `00000000-0000-4000-8000-${String(++db.runCount).padStart(12, "0")}`, version: 0, state: "partial",
              progress: { formsDone: false, formsAfter: null, formsSeen: [], formIds: [], pending: [], discover: true },
            };
            db.runs.set(args.p_business_id, run);
          }
          return { data: [structuredClone(run)], error: null };
        }
        if (!run || run.id !== args.p_sync_id || run.version !== args.p_version) return { error: { code: "40001" } };
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

vi.mock("@/lib/meta/connection-access", async () => {
  const { MetaClient } = await import("@/lib/meta/client");
  return {
    requireScheduledBusiness: async (id: string) => ({ businessId: id, userId: "owner-1" }),
    withMetaConnection: async (_context: unknown, options: { purpose: string; signal?: AbortSignal }, execute: (meta: unknown, connection: unknown) => unknown) => {
      expect(options.purpose).toBe("read_leads");
      return execute(new MetaClient(creds, options.signal), { generation: 1, selected: { adAccountId: creds.adAccountId, pageId: creds.pageId } });
    },
  };
});

function replay(fail?: (path: string) => boolean) {
  const sent: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    expect(url.origin + url.pathname.slice(0, 7)).toBe("https://graph.facebook.com/v21.0/");
    expect(init?.method ?? "GET").toBe("GET");
    url.searchParams.delete("access_token");
    const path = url.pathname.replace("/v21.0/", "") + url.search;
    sent.push(path);
    if (fail?.(path)) return Response.json({ error: { message: "Service temporarily unavailable", code: 2 } }, { status: 503 });
    const exchange = (leadsTape as Exchange[]).find(item => item.path === path);
    if (!exchange) throw new Error(`Unrecorded Graph call: GET ${path}`);
    return Response.json(exchange.body, { status: exchange.status });
  });
  return sent;
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
  db.runCount = 0;
  db.connections = [{ business_id: businessId }];
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("CRON_SECRET", SECRET);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("core: scheduled lead sync against recorded Graph pages (#165)", () => {
  it("rejects calls without the scheduler secret before reading anything", async () => {
    const sent = replay();
    expect((await run(null)).status).toBe(401);
    expect((await run("Bearer wrong-secret")).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    vi.resetModules();
    expect((await run()).status).toBe(404);
    expect(sent).toEqual([]);
    expect(db.leads.size).toBe(0);
  });

  it("imports the recorded test lead exactly once, and a second run imports nothing new", async () => {
    const sent = replay();
    const first = await run();
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      ok: true, imported: 1,
      businesses: [{ businessId, imported: 1, failedForms: 0, sync: { state: "complete", hasMore: false } }],
    });
    expect([...db.leads.values()]).toEqual([expect.objectContaining({
      business_id: businessId, meta_lead_id: testLead, form_id: "1732372914636573",
      full_name: "<test lead: dummy data for full_name>", created_time: "2026-10-22T05:39:35+0000",
    })]);
    expect(sent.filter(path => path.includes("/leads?"))).toHaveLength(5);

    const second = await run();
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ ok: true, imported: 0, businesses: [{ businessId, imported: 0 }] });
    expect(db.leads.size).toBe(1);
  });

  it("fails red with saved progress when Meta cannot be read, never a silent empty import", async () => {
    replay(path => path.startsWith("1732372914636573/leads"));
    const failed = await run();
    expect(failed.status).toBe(503);
    expect(failed.body).toMatchObject({
      ok: false, imported: 0,
      businesses: [{ businessId, imported: 0, failedForms: 1, sync: { state: "partial", hasMore: true }, error: expect.stringContaining("Could not read all Meta enquiries") }],
    });

    replay();
    const retried = await run();
    expect(retried.body).toMatchObject({ ok: true, imported: 1 });
    expect(db.leads.size).toBe(1);
  });
});
