import { beforeEach, describe, expect, it, vi } from "vitest";
import { GRACE_MINUTES, WORKFLOWS, isOverdue } from "@/app/api/cron/dispatch-workflows/workflows";

const mocks = vi.hoisted(() => ({
  env: { CRON_SECRET: "cron-secret", GITHUB_DISPATCH_TOKEN: "gh-token" } as Record<string, string>,
  lastRun: {} as Record<string, string | null>,
  runsStatus: 200,
  dispatchStatus: 204,
  calls: [] as Array<{ url: string; method: string; body?: unknown; auth?: string }>,
}));

vi.mock("@/lib/env", () => ({ getEnv: () => mocks.env }));

const API = "https://api.github.com/repos/vanshulgoyal101/adbrain/actions/workflows/";
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
const call = async (authorization = "Bearer cron-secret") => {
  const { GET } = await import("@/app/api/cron/dispatch-workflows/route");
  const response = await GET(new Request("http://localhost/api/cron/dispatch-workflows", { headers: { authorization } }));
  const text = await response.text();
  return { status: response.status, body: JSON.parse(text), text };
};
const dispatched = () => mocks.calls.filter(({ method }) => method === "POST");

beforeEach(() => {
  mocks.env = { CRON_SECRET: "cron-secret", GITHUB_DISPATCH_TOKEN: "gh-token" };
  mocks.lastRun = { "create-smoke.yml": hoursAgo(1), "db-backup.yml": hoursAgo(20), "production-guard.yml": hoursAgo(2) };
  mocks.runsStatus = 200;
  mocks.dispatchStatus = 204;
  mocks.calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const auth = (init.headers as Record<string, string>).Authorization;
    mocks.calls.push({ url: input, method, auth, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (method === "POST") return new Response(null, { status: mocks.dispatchStatus });
    const workflow = input.slice(API.length).split("/")[0];
    const created = mocks.lastRun[workflow];
    return new Response(JSON.stringify({ workflow_runs: created ? [{ created_at: created }] : [] }), { status: mocks.runsStatus });
  }));
});

describe("GET /api/cron/dispatch-workflows (#2593)", () => {
  it("requires the cron secret and calls GitHub for nothing else", async () => {
    expect((await call("Bearer wrong")).status).toBe(401);
    mocks.env.CRON_SECRET = "";
    expect((await call()).status).toBe(404);
    expect(mocks.calls).toEqual([]);
  });

  it("is a 503 without the token and never calls GitHub", async () => {
    mocks.env.GITHUB_DISPATCH_TOKEN = "";
    const { status, body } = await call();
    expect(status).toBe(503);
    expect(body).toEqual({ ok: false, error: "GITHUB_DISPATCH_TOKEN is not set." });
    expect(mocks.calls).toEqual([]);
  });

  it("dispatches nothing while every workflow ran within its interval plus the grace", async () => {
    mocks.lastRun["create-smoke.yml"] = hoursAgo(6); // a slot ~2 h late is not doubled
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, workflows: [
      { workflow: "create-smoke.yml", lastRunMinutesAgo: 360, dispatched: false },
      { workflow: "db-backup.yml", lastRunMinutesAgo: 1200, dispatched: false },
      { workflow: "production-guard.yml", lastRunMinutesAgo: 120, dispatched: false },
    ] });
    expect(dispatched()).toEqual([]);
    expect(mocks.calls.map(({ url }) => url)).toEqual(WORKFLOWS.map(({ workflow }) => `${API}${workflow}/runs?per_page=1`));
    expect(mocks.calls.every(({ auth }) => auth === "Bearer gh-token")).toBe(true);
  });

  it("dispatches only an overdue allowlisted workflow, on main, create-smoke as `auto`", async () => {
    mocks.lastRun["create-smoke.yml"] = hoursAgo(7);
    mocks.lastRun["db-backup.yml"] = null;
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.workflows.map(({ dispatched }: { dispatched: boolean }) => dispatched)).toEqual([true, true, false]);
    expect(dispatched()).toEqual([
      { url: `${API}create-smoke.yml/dispatches`, method: "POST", auth: "Bearer gh-token", body: { ref: "main", inputs: { mode: "auto" } } },
      { url: `${API}db-backup.yml/dispatches`, method: "POST", auth: "Bearer gh-token", body: { ref: "main" } },
    ]);
    expect(mocks.calls.every(({ url }) => WORKFLOWS.some(({ workflow }) => url.startsWith(`${API}${workflow}/`)))).toBe(true);
  });

  it("reports GitHub failures per workflow as a 503 without the token, and does not dispatch blind", async () => {
    mocks.runsStatus = 401;
    let result = await call();
    expect(result.status).toBe(503);
    expect(result.body.workflows[0]).toEqual({ workflow: "create-smoke.yml", lastRunMinutesAgo: null, dispatched: false, error: "Could not read runs (401)." });
    expect(dispatched()).toEqual([]);
    expect(result.text).not.toContain("gh-token");

    mocks.runsStatus = 200;
    mocks.dispatchStatus = 422;
    mocks.lastRun["production-guard.yml"] = hoursAgo(30);
    result = await call();
    expect(result.status).toBe(503);
    expect(result.body.workflows[2]).toEqual({ workflow: "production-guard.yml", lastRunMinutesAgo: 1800, dispatched: false, error: "Could not dispatch (422)." });
  });
});

describe("isOverdue", () => {
  const now = Date.parse("2026-11-02T12:00:00Z");
  it("waits the interval plus the grace, and treats no run or an unreadable date as overdue", () => {
    const at = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
    expect(isOverdue(240, at(240 + GRACE_MINUTES), now)).toBe(false);
    expect(isOverdue(240, at(240 + GRACE_MINUTES + 1), now)).toBe(true);
    expect(isOverdue(240, null, now)).toBe(true);
    expect(isOverdue(240, "not a date", now)).toBe(true);
  });
});
