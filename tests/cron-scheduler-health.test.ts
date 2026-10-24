import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  secret: "cron-secret" as string | undefined,
  rows: [] as Array<{ created_at: string; outcome: string; route: string }>,
  error: null as { message: string } | null,
  calls: [] as Array<[string, ...unknown[]]>,
}));

vi.mock("@/lib/env", () => ({ getEnv: () => ({ CRON_SECRET: mocks.secret }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      mocks.calls.push(["from", table]);
      const query: Record<string, (...args: unknown[]) => unknown> = {};
      for (const method of ["select", "eq", "in", "gte", "order", "limit"]) {
        query[method] = (...args: unknown[]) => { mocks.calls.push([method, ...args]); return query; };
      }
      query.abortSignal = async () => ({ data: mocks.error ? null : mocks.rows, error: mocks.error });
      return query;
    },
  }),
}));

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000 - 1_000).toISOString();
const run = (route: string, minutes: number, outcome = "success") => ({ route: `/api/cron/${route}`, created_at: minutesAgo(minutes), outcome });
const call = async (authorization = "Bearer cron-secret") => {
  const { GET } = await import("@/app/api/cron/scheduler-health/route");
  const response = await GET(new Request("http://localhost/api/cron/scheduler-health", { headers: { authorization } }));
  return { status: response.status, body: await response.json() };
};

beforeEach(() => {
  mocks.secret = "cron-secret";
  mocks.error = null;
  mocks.calls = [];
  mocks.rows = [run("enforce-spend", 3), run("sync-leads", 8), run("refresh-results", 50)];
});

describe("GET /api/cron/scheduler-health (#274)", () => {
  it("requires the cron secret", async () => {
    expect((await call("Bearer wrong")).status).toBe(401);
    mocks.secret = undefined;
    expect((await call()).status).toBe(404);
    expect(mocks.calls).toEqual([]);
  });

  it("reads each job's runs from the request log and reports all on time", async () => {
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, jobs: [
      { job: "enforce-spend", everyMinutes: 15, lastRunMinutesAgo: 3, lastSuccessMinutesAgo: 3, overdue: false },
      { job: "sync-leads", everyMinutes: 15, lastRunMinutesAgo: 8, lastSuccessMinutesAgo: 8, overdue: false },
      { job: "refresh-results", everyMinutes: 60, lastRunMinutesAgo: 50, lastSuccessMinutesAgo: 50, overdue: false },
    ] });
    expect(mocks.calls).toContainEqual(["from", "product_events"]);
    expect(mocks.calls).toContainEqual(["eq", "name", "http.request"]);
    expect(mocks.calls).toContainEqual(["in", "attributes->>route", ["/api/cron/enforce-spend", "/api/cron/sync-leads", "/api/cron/refresh-results"]]);
  });

  it("flags a job with no successful run in twice its interval, and keeps its last failed attempt for triage", async () => {
    mocks.rows = [run("enforce-spend", 4, "failed"), run("enforce-spend", 31), run("enforce-spend", 45), run("sync-leads", 8), run("refresh-results", 119)];
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.jobs).toEqual([
      { job: "enforce-spend", everyMinutes: 15, lastRunMinutesAgo: 4, lastSuccessMinutesAgo: 31, overdue: true },
      { job: "sync-leads", everyMinutes: 15, lastRunMinutesAgo: 8, lastSuccessMinutesAgo: 8, overdue: false },
      { job: "refresh-results", everyMinutes: 60, lastRunMinutesAgo: 119, lastSuccessMinutesAgo: 119, overdue: false },
    ]);
  });

  it("flags a job that has not run in the last day and ignores rejected (unauthorized) calls", async () => {
    mocks.rows = [run("enforce-spend", 3), run("sync-leads", 2, "rejected"), run("refresh-results", 50)];
    const { body } = await call();
    expect(body.ok).toBe(false);
    expect(body.jobs[1]).toEqual({ job: "sync-leads", everyMinutes: 15, lastRunMinutesAgo: null, lastSuccessMinutesAgo: null, overdue: true });
  });

  it("returns 503 without database details when the log cannot be read", async () => {
    mocks.error = { message: "private connection details" };
    const { status, body } = await call();
    expect(status).toBe(503);
    expect(body).toEqual({ ok: false, error: "Scheduler health is unavailable." });
  });
});
