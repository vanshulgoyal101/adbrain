import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  secret: "cron-secret" as string | undefined,
  rows: [] as unknown[],
  error: null as unknown,
  users: {} as Record<string, { id: string; email: string; email_confirmed_at: string | null } | undefined>,
  filters: [] as unknown[][],
}));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ CRON_SECRET: mocks.secret }) }));
vi.mock("@/lib/internal-accounts", () => ({ isInternalUser: (user: { email?: string } | null) => Boolean(user?.email?.endsWith("@team.test")) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const query = {
      select: () => query,
      eq: (...args: unknown[]) => { mocks.filters.push(args); return query; },
      gte: () => query,
      order: () => query,
      limit: () => query,
      abortSignal: async () => ({ data: mocks.error ? null : mocks.rows, error: mocks.error }),
    };
    return {
      from: () => query,
      auth: { admin: { getUserById: async (id: string) => mocks.users[id]
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
  mocks.secret = "cron-secret"; mocks.error = null; mocks.rows = []; mocks.users = {}; mocks.filters = [];
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
    expect(body).toEqual({ ok: true, requests: [{ key: key("owner-outside-1"), hours: 1 }] });
    expect(JSON.stringify(body)).not.toMatch(/owner-|example\.com/);
  });

  it("keeps a request whose account can't be read, rather than drop a lead", async () => {
    mocks.rows = [{ user_id: "owner-unknown-1", created_at: ago(0) }];
    expect((await call()).body.requests).toEqual([{ key: key("owner-unknown-1"), hours: 0 }]);
  });

  it("returns 503 without database details", async () => {
    mocks.error = { message: "private details" };
    expect(await call()).toEqual({ status: 503, body: { ok: false, error: "Access requests are unavailable." } });
  });
});
