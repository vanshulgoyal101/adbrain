import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import leadsTape from "./fixtures/meta/leads.json";

// Graph lead-form and lead pages recorded read-only from the Solaride Page by
// scripts/record-meta-lead-fixtures.ts, with one Meta test lead (#165).
type Exchange = { method: string; path: string; status: number; body: unknown };
type Progress = { formsDone: boolean; pending: unknown[] } & Record<string, unknown>;
type SyncRun = { id: string; version: number; state: "partial" | "complete"; progress: Progress };

const SECRET = "cron-secret-value";
const businessId = "816aaafb-7ebc-4ad7-bbda-001beff172f8";
const creds = { adAccountId: "act_9000000000000001", pageId: "900000000000002", accessToken: "test-token" };
const testLead = "1751001369523985";

const db = vi.hoisted(() => ({
  runs: new Map<string, SyncRun>(),
  leads: new Map<string, Record<string, unknown>>(),
  connections: [] as { business_id: string }[],
  runCount: 0,
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
    rpc: (name: string, args: { p_business_id: string; p_sync_id: string | null; p_version: number; p_rows: Record<string, unknown>[]; p_progress: Progress }) => name.startsWith("owner_alert_") ? Promise.resolve(alertRpc(name, args)) : ({
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

vi.mock("@/lib/meta/managed-account", () => ({ getManagedAccount: async () => null }));
const deadBusiness = "0b7f1d2e-0000-4000-8000-00000000dead";
// #758: Meta's answer for a token whose session was invalidated (Graph 190/460).
const graph190 = { error: { message: "Error validating access token: The session has been invalidated because the user changed their password or Facebook has changed the session for security reasons.", type: "OAuthException", code: 190, error_subcode: 460, fbtrace_id: "A1" } };

vi.mock("@/lib/meta/connection-access", async () => {
  const { MetaClient } = await import("@/lib/meta/client");
  return {
    requireScheduledBusiness: async (id: string) => ({ businessId: id, userId: "owner-1" }),
    withMetaConnection: async (context: { businessId: string }, options: { purpose: string; signal?: AbortSignal }, execute: (meta: unknown, connection: unknown) => unknown) => {
      expect(options.purpose).toBe("read_leads");
      const accessToken = context.businessId === deadBusiness ? "dead-token" : creds.accessToken;
      return execute(new MetaClient({ ...creds, accessToken }, options.signal), { generation: 1, selected: { adAccountId: creds.adAccountId, pageId: creds.pageId } });
    },
  };
});

// Cloud API's documented answer to a template send (#701); recorded once AdBrain's WABA exists.
const CLOUD_ACCEPTED = { messaging_product: "whatsapp", contacts: [{ input: "919999999001", wa_id: "919999999001" }], messages: [{ id: "wamid.HBgMOTE5OTk5OTk5MDAxFQIAERgSQUJDREVGMDEyMzQ1Njc4OQA=" }] };

function replay(fail?: (path: string) => boolean, edit?: (path: string, body: unknown) => unknown, whatsapp: unknown[] = []) {
  const sent: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (init?.method === "POST" && url.pathname === "/v26.0/106540352242922/messages") {
      whatsapp.push(JSON.parse(String(init.body)));
      return Response.json(CLOUD_ACCEPTED);
    }
    expect(url.origin + url.pathname.slice(0, 7)).toBe("https://graph.facebook.com/v26.0/");
    // #1649: the token rides in the Authorization header.
    if (new Headers(init?.headers).get("authorization")?.replace(/^Bearer /, "") === "dead-token") return Response.json(graph190, { status: 400 });
    expect(init?.method ?? "GET").toBe("GET");
    url.searchParams.delete("appsecret_proof");
    const path = url.pathname.replace("/v26.0/", "") + url.search;
    sent.push(path);
    if (fail?.(path)) return Response.json({ error: { message: "Service temporarily unavailable", code: 2 } }, { status: 503 });
    const exchange = (leadsTape as Exchange[]).find(item => item.path === path);
    if (!exchange) throw new Error(`Unrecorded Graph call: GET ${path}`);
    return Response.json(edit ? edit(path, structuredClone(exchange.body)) : exchange.body, { status: exchange.status });
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
      // #680: Meta answers a test lead without campaign_id (recorded); it stays unlinked.
      meta_campaign_id: null,
    })]);
    expect(sent.filter(path => path.includes("/leads?")).every(path => path.includes("campaign_id"))).toBe(true);
    expect(sent.filter(path => path.includes("/leads?"))).toHaveLength(5);

    const second = await run();
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ ok: true, imported: 0, businesses: [{ businessId, imported: 0 }] });
    expect(db.leads.size).toBe(1);
  });

  it("#680: passes an ad lead's Meta campaign id to the checkpoint, and drops a malformed one", async () => {
    for (const [campaignId, expected] of [["120253707024160526", "120253707024160526"], ["act_1; drop", null]] as const) {
      db.runs.clear();
      db.leads.clear();
      replay(undefined, (path, body) => {
        if (!path.startsWith("1732372914636573/leads")) return body;
        const page = body as { data: Record<string, unknown>[] };
        return { ...page, data: page.data.map(lead => ({ ...lead, campaign_id: campaignId })) };
      });
      expect((await run()).status).toBe(200);
      expect([...db.leads.values()]).toEqual([expect.objectContaining({ meta_lead_id: testLead, meta_campaign_id: expected })]);
      vi.restoreAllMocks();
    }
  });

  it("#758: one owner's dead token is listed by opaque key; the healthy business still imports and the run stays green", async () => {
    const { createHash } = await import("node:crypto");
    db.connections = [{ business_id: deadBusiness }, { business_id: businessId }];
    replay();
    const result = await run();
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, imported: 1, businesses: [{ businessId, imported: 1 }] });
    expect(result.body.reauth).toEqual([{ key: createHash("sha256").update(deadBusiness).digest("hex").slice(0, 12), since: expect.any(String), activeCampaigns: expect.any(Number) }]);
    expect(JSON.stringify(result.body.reauth)).not.toContain(deadBusiness);
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

  it("#2503: two overlapping runs both return 200; the one that lost the checkpoint is skipped and the lead lands once", async () => {
    replay();
    const outcomes = await Promise.all([run(), run()]);
    expect(outcomes.map(({ status }) => status)).toEqual([200, 200]);
    const businesses = outcomes.map(({ body }) => body.businesses[0]);
    expect(businesses.filter((business) => business.skipped === "Another run is syncing.")).toHaveLength(1);
    expect(businesses.every((business) => !business.error)).toBe(true);
    expect(db.leads.size).toBe(1);
  });

  describe("#701 v1: the owner's WhatsApp lead alert after the import", () => {
    beforeEach(() => {
      // The recorded test lead arrived at 05:39:35Z; the run is 20 minutes later.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-22T06:00:00Z"));
      vi.stubEnv("OWNER_ALERTS_ENABLED", "true");
      vi.stubEnv("ALERTS_WHATSAPP_PHONE_ID", "106540352242922");
      vi.stubEnv("ALERTS_WHATSAPP_TOKEN", "alerts-token");
      db.prefs = { lead_alerts: true };
    });

    it("alerts once for the new lead, and a re-sync sends nothing", async () => {
      const whatsapp: unknown[] = [];
      replay(undefined, undefined, whatsapp);
      const first = await run();
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ ok: true, imported: 1, businesses: [{ businessId, imported: 1, alerts: { sent: 1, skipped: {} } }] });
      expect(whatsapp).toEqual([{
        messaging_product: "whatsapp", recipient_type: "individual", to: "919999999001", type: "template",
        template: { name: "adbrain_lead_alert", language: { code: "en" }, components: [{ type: "body", parameters: [
          { type: "text", text: "Solaride" },
          { type: "text", text: "<test lead: dummy data for full_name>" },
          { type: "text", text: expect.stringMatching(/^(\+91 \d{5} \d{5}|\+?\d+|not given)$/) },
          { type: "text", text: expect.any(String) },
          { type: "text", text: expect.any(String) },
        ] }] },
      }]);
      expect(db.sends).toEqual([{ id: 1, dedupe_key: testLead, state: "sent", wa_message_id: CLOUD_ACCEPTED.messages[0].id }]);

      const second = await run();
      expect(second.body).toMatchObject({ ok: true, imported: 0, businesses: [{ alerts: { sent: 0 } }] });
      expect(whatsapp).toHaveLength(1);
    });

    it("sends nothing for a lead older than 24 h, or when the owner's lead alerts are off", async () => {
      const whatsapp: unknown[] = [];
      vi.setSystemTime(new Date("2026-10-23T05:40:00Z"));
      replay(undefined, undefined, whatsapp);
      expect((await run()).body).toMatchObject({ ok: true, imported: 1, businesses: [{ alerts: { sent: 0 } }] });
      db.leads.clear(); db.runs.clear();
      vi.setSystemTime(new Date("2026-10-22T06:00:00Z"));
      db.prefs = null;
      const off = await run();
      expect(off.body).toMatchObject({ ok: true, imported: 1 });
      expect(off.body.businesses[0].alerts).toBeUndefined();
      expect(whatsapp).toEqual([]);
    });

    it("an alert failure is reported but never fails the sync", async () => {
      db.failAlertReads = true;
      replay();
      const result = await run();
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ ok: true, imported: 1, businesses: [{ imported: 1, alerts: { error: "prefs" } }] });
      expect(db.sends).toEqual([]);
    });
  });
});
