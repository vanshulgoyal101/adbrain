import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  secret: "cron-secret" as string | undefined,
  rows: [] as unknown[],
  audit: [] as unknown[],
  error: null as unknown,
  lookups: 0,
  users: {} as Record<string, { id: string; email: string; email_confirmed_at: string | null } | undefined>,
  filters: [] as unknown[][],
}));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ CRON_SECRET: mocks.secret }) }));
vi.mock("@/lib/internal-accounts", () => ({ isInternalUser: (user: { email?: string } | null) => Boolean(user?.email?.endsWith("@team.test")) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const query = (table: string) => {
      const q = {
        select: () => q,
        eq: (...args: unknown[]) => { if (table === "product_events") mocks.filters.push(args); return q; },
        gte: () => q,
        order: () => q,
        limit: () => q,
        abortSignal: async () => ({ data: mocks.error ? null : table === "audit_log" ? mocks.audit : mocks.rows, error: mocks.error }),
      };
      return q;
    };
    return {
      from: (table: string) => query(table),
      auth: { admin: { getUserById: async (id: string) => (mocks.lookups++, mocks.users[id])
        ? { data: { user: mocks.users[id] }, error: null }
        : { data: { user: null }, error: { message: "User not found" } } } },
    };
  },
}));

const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000 - 60_000).toISOString();
const key = (id: string) => createHash("sha256").update(id).digest("hex").slice(0, 12);
const call = async (auth = "Bearer cron-secret") => {
  const { GET } = await import("@/app/api/cron/access-requests/route");
  const response = await GET(new Request("http://localhost/api/cron/access-requests", { headers: { authorization: auth } }));
  return { status: response.status, body: await response.json() };
};

beforeEach(() => {
  mocks.secret = "cron-secret"; mocks.error = null; mocks.rows = []; mocks.audit = []; mocks.users = {}; mocks.filters = []; mocks.lookups = 0;
});

describe("GET /api/cron/access-requests (#692)", () => {
  it("requires the cron secret", async () => {
    expect((await call("Bearer wrong")).status).toBe(401);
    mocks.secret = undefined;
    expect((await call()).status).toBe(404);
  });

  it("reads only 'Ask for Facebook access' taps", async () => {
    await call();
    expect(mocks.filters).toEqual([["name", "ui.action"], ["attributes->>action", "meta.access_request"]]);
  });

  it("returns one opaque key per outside owner, however often they tapped, and none for the team", async () => {
    mocks.users = {
      "owner-outside-1": { id: "owner-outside-1", email: "clinic@example.com", email_confirmed_at: null },
      "owner-team-1": { id: "owner-team-1", email: "qa@team.test", email_confirmed_at: ago(100) },
    };
    // Newest first, as the query orders them.
    mocks.rows = [
      { user_id: "owner-outside-1", created_at: ago(1) },
      { user_id: "owner-team-1", created_at: ago(2) },
      { user_id: "owner-outside-1", created_at: ago(5) },
      { user_id: null, created_at: ago(3) },
    ];
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, requests: [{ key: key("owner-outside-1"), hours: 1 }], more: 0 });
    expect(JSON.stringify(body)).not.toMatch(/owner-|example\.com/);
  });

  it("keeps a request whose account can't be read, rather than drop a lead", async () => {
    mocks.rows = [{ user_id: "owner-unknown-1", created_at: ago(0) }];
    expect((await call()).body.requests).toEqual([{ key: key("owner-unknown-1"), hours: 0 }]);
  });

  // #725: the server-side record counts even when the analytics beacon was dropped.
  it("reads the durable audit record when no beacon arrived", async () => {
    mocks.audit = [{ actor_id: "owner-outside-2", created_at: ago(2) }];
    expect((await call()).body.requests).toEqual([{ key: key("owner-outside-2"), hours: 2 }]);
  });

  it("looks up at most 10 accounts a run, newest first, and counts the rest as waiting", async () => {
    mocks.audit = Array.from({ length: 14 }, (_, n) => ({ actor_id: `owner-outside-${n}`, created_at: ago(n) }));
    const { body } = await call();
    expect(mocks.lookups).toBe(10);
    expect(body.requests.map((request: { hours: number }) => request.hours)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(body.more).toBe(4);
  });

  it("returns 503 without database details", async () => {
    mocks.error = { message: "private details" };
    expect(await call()).toEqual({ status: 503, body: { ok: false, error: "Access requests are unavailable." } });
  });
});
