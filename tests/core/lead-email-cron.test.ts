import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import leadsTape from "./fixtures/meta/leads.json";

// Same recorded Graph pages as lead-sync-cron.test.ts (#165), now with the enquiry email step (#229).
// The mock database mimics the lead insert trigger: one queue row per newly inserted lead. The 24-hour
// staleness rule and every state change are real SQL, covered by `npm run test:meta-db`.
type Exchange = { method: string; path: string; status: number; body: unknown };
type Progress = { formsDone: boolean; pending: unknown[] } & Record<string, unknown>;
type SyncRun = { id: string; version: number; state: "partial" | "complete"; progress: Progress };
type Queued = { leadId: string; state: "queued" | "sending" | "sent"; row: Record<string, unknown> };

const SECRET = "cron-secret-value";
const businessId = "816aaafb-7ebc-4ad7-bbda-001beff172f8";
const ownerId = "11111111-1111-4111-8111-111111111111";
const creds = { adAccountId: "act_2398686420592052", pageId: "885223068001054", accessToken: "test-token" };

const db = vi.hoisted(() => ({
  runs: new Map<string, SyncRun>(),
  leads: new Map<string, Record<string, unknown>>(),
  queue: [] as Queued[],
  connections: [] as { business_id: string }[],
  runCount: 0,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { getUserById: async () => ({ data: { user: { email: "owner@example.com" } }, error: null }) } },
    from: () => {
      let after = false;
      const query = {
        select: () => query, eq: () => query, not: () => query, order: () => query, limit: () => query,
        gt: () => { after = true; return query; },
        then: (resolve: (value: unknown) => unknown) => resolve({ data: after ? [] : db.connections, error: null }),
      };
      return query;
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      const run_ = async () => {
        if (name === "lead_notifications_claim") {
          const claimed = db.queue.filter(item => item.state === "queued");
          for (const item of claimed) item.state = "sending";
          return { data: claimed.map(item => item.row), error: null };
        }
        if (name === "lead_notification_result") {
          const item = db.queue.find(entry => entry.leadId === args.p_lead_id && entry.state === "sending");
          if (item) item.state = args.p_outcome === "sent" ? "sent" : "queued";
          return { data: null, error: null };
        }
        const sync = args as { p_business_id: string; p_sync_id: string | null; p_version: number; p_rows: Record<string, unknown>[]; p_progress: Progress };
        let run = db.runs.get(sync.p_business_id);
        if (name === "lead_sync_start") {
          if (!run || run.state === "complete") {
            run = { id: `00000000-0000-4000-8000-${String(++db.runCount).padStart(12, "0")}`, version: 0, state: "partial",
              progress: { formsDone: false, formsAfter: null, formsSeen: [], formIds: [], pending: [], discover: true } };
            db.runs.set(sync.p_business_id, run);
          }
          return { data: [structuredClone(run)], error: null };
        }
        if (!run || run.id !== sync.p_sync_id || run.version !== sync.p_version) return { error: { code: "40001" } };
        let imported = 0;
        for (const row of sync.p_rows) {
          const key = `${sync.p_business_id}:${row.meta_lead_id}`;
          if (db.leads.has(key)) continue;
          db.leads.set(key, row);
          const leadId = `44444444-4444-4444-8444-${String(db.leads.size).padStart(12, "0")}`;
          db.queue.push({ leadId, state: "queued", row: { leadId, businessId: sync.p_business_id, ownerId, businessName: "Solaride", fullName: row.full_name,
            phone: row.phone, email: row.email, city: row.city, fields: row.field_data, formName: row.form_name, receivedAt: row.created_time ?? "2026-10-23T09:00:00Z", attempt: 1 } });
          imported++;
        }
        run = { ...run, version: run.version + 1, progress: structuredClone(sync.p_progress),
          state: sync.p_progress.formsDone && sync.p_progress.pending.length === 0 ? "complete" : "partial" };
        db.runs.set(sync.p_business_id, run);
        return { data: { run: structuredClone(run), imported }, error: null };
      };
      return { abortSignal: run_, then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => run_().then(resolve, reject) };
    },
  }),
}));

vi.mock("@/lib/meta/connection-access", async () => {
  const { MetaClient } = await import("@/lib/meta/client");
  return {
    requireScheduledBusiness: async (id: string) => ({ businessId: id, userId: ownerId }),
    withMetaConnection: async (_context: unknown, options: { signal?: AbortSignal }, execute: (meta: unknown, connection: unknown) => unknown) =>
      execute(new MetaClient(creds, options.signal), { generation: 1, selected: { adAccountId: creds.adAccountId, pageId: creds.pageId } }),
  };
});

type Sent = { headers: Record<string, string>; body: { to: string[]; subject: string; html: string; text: string } };
function replay(resend: (sent: Sent) => Response = () => Response.json({ id: "email_1" })) {
  const emails: Sent[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.origin === "https://api.resend.com") {
      const sent = { headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) };
      emails.push(sent);
      return resend(sent);
    }
    url.searchParams.delete("access_token");
    const path = url.pathname.replace("/v21.0/", "") + url.search;
    const exchange = (leadsTape as Exchange[]).find(item => item.path === path);
    if (!exchange) throw new Error(`Unrecorded Graph call: GET ${path}`);
    return Response.json(exchange.body, { status: exchange.status });
  });
  return emails;
}

async function run() {
  const { GET } = await import("@/app/api/cron/sync-leads/route");
  const response = await GET(new Request("https://adbrain.vanshul.com/api/cron/sync-leads", { headers: { authorization: `Bearer ${SECRET}` } }));
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  vi.resetModules();
  db.runs.clear(); db.leads.clear(); db.queue.length = 0; db.runCount = 0;
  db.connections = [{ business_id: businessId }];
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("CRON_SECRET", SECRET);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

function enableEmail() {
  vi.stubEnv("LEAD_EMAIL_ENABLED", "true");
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  vi.stubEnv("LEAD_EMAIL_FROM", "AdBrain <alerts@vanshul.com>");
  vi.stubEnv("EMAIL_LINK_SECRET", "link-secret-of-16+chars");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://adbrain.vanshul.com");
}

describe("core: enquiry emails after the scheduled lead sync, recorded Graph pages (#229)", () => {
  it("emails the owner once for the recorded test lead and never again when it is re-synced", async () => {
    enableEmail();
    const emails = replay();
    const first = await run();
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ ok: true, imported: 1, emails: { claimed: 1, sent: 1, retried: 0, failed: 0 } });
    expect(emails).toHaveLength(1);
    expect(emails[0].body.to).toEqual(["owner@example.com"]);
    expect(emails[0].headers["Idempotency-Key"]).toMatch(/^lead-/);
    expect(emails[0].body.subject).toContain("New enquiry:");
    expect(emails[0].body.html).toContain("Unsubscribe");
    expect(emails[0].body.html).not.toContain("<test lead");

    const second = await run();
    expect(second.body).toMatchObject({ ok: true, imported: 0, emails: { claimed: 0, sent: 0 } });
    expect(emails).toHaveLength(1);
  });

  it("sends nothing while the flag is off", async () => {
    const emails = replay();
    const result = await run();
    expect(result.body).toMatchObject({ ok: true, imported: 1, emails: { enabled: false } });
    expect(emails).toEqual([]);
    expect(db.queue.map(item => item.state)).toEqual(["queued"]);
  });

  it("keeps the lead sync green when the provider is down, and retries on the next run", async () => {
    enableEmail();
    let down = true;
    const emails = replay(() => down ? new Response("{}", { status: 503 }) : Response.json({ id: "email_1" }));
    const failed = await run();
    expect(failed.status).toBe(200);
    expect(failed.body).toMatchObject({ ok: true, imported: 1, emails: { claimed: 1, sent: 0, retried: 1 } });
    down = false;
    const retried = await run();
    expect(retried.body).toMatchObject({ ok: true, imported: 0, emails: { claimed: 1, sent: 1 } });
    expect(emails).toHaveLength(2);
    expect(emails[1].headers["Idempotency-Key"]).toBe(emails[0].headers["Idempotency-Key"]);
  });

  it("does not send when settings are incomplete", async () => {
    enableEmail();
    vi.stubEnv("EMAIL_LINK_SECRET", "");
    const emails = replay();
    expect((await run()).body.emails).toEqual({ enabled: false });
    expect(emails).toEqual([]);
  });
});
