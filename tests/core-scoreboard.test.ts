import { describe, expect, it } from "vitest";
import { buildScoreboard, newestResults, p90, type ScoreActiveResult, type ScoreAiCall, type ScoreEvent, type ScoreLaunch } from "@/lib/observability/core-scoreboard";

const until = new Date("2026-10-26T03:30:00Z");
const since = new Date("2026-10-25T03:30:00Z");
const at = (minAgo: number) => new Date(until.getTime() - minAgo * 60_000).toISOString();
const SMOKE = "smoke-user";
const SMOKE_BIZ = "smoke-business";

const ev = (name: string, outcome = "success", extra: Partial<ScoreEvent> = {}): ScoreEvent => ({
  name, outcome, user_id: "real-user", business_id: "real-business", duration_ms: null, attributes: {}, created_at: at(60), ...extra,
});
const call = (route: string, status = "success", extra: Partial<ScoreAiCall> = {}): ScoreAiCall => ({
  route, status, user_id: "real-user", business_id: "real-business", request_id: null, latency_ms: 1000, created_at: at(60), ...extra,
});
const FREE = "internal-user";
const launch = (state: string, business_id = "real-business"): ScoreLaunch => ({ business_id, state, created_at: at(60) });
const board = (events: ScoreEvent[], aiCalls: ScoreAiCall[] = [], launches: ScoreLaunch[] = [], activeResults: ScoreActiveResult[] = []) =>
  buildScoreboard({ events, aiCalls, launches, activeResults, freeImageUserIds: [FREE], excludedUserIds: [SMOKE], excludedBusinessIds: [SMOKE_BIZ], since, until });
const row = (b: ReturnType<typeof board>, step: string) => b.rows.find((r) => r.step === step)!;

describe("core scoreboard (#681)", () => {
  it("p90 is the nearest-rank 90th percentile", () => {
    expect(p90([])).toBeNull();
    expect(p90([5])).toBe(5);
    expect(p90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(9);
    expect(p90([10, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11])).toBe(10);
  });

  it("leaves out the smoke by user id and, for background rows only, by the business it owns", () => {
    const b = board([
      ev("meta.create_paused", "failed", { user_id: SMOKE }),
      ev("meta.create_paused", "failed", { user_id: null, business_id: SMOKE_BIZ }),
      ev("meta.create_paused"),
      ev("meta.create_paused", "success", { business_id: SMOKE_BIZ }),
    ], [call("creatives.regenerate", "error", { user_id: SMOKE })], [launch("failed", SMOKE_BIZ), launch("succeeded")]);
    expect(b.excluded).toEqual({ events: 2, aiCalls: 1 });
    expect(row(b, "Launch")).toMatchObject({ now: "1 launch: 100% succeeded; Meta calls under `create_paused` 0/2 failed", met: true });
    expect(row(b, "Regenerate")).toMatchObject({ now: "no requests", met: null });
  });

  it("Prepare counts partial plans as planned, names failure codes and takes p90 from the plan route", () => {
    const plans = [
      ...Array.from({ length: 18 }, () => ev("campaign.plan", "partial", { attributes: { errorCode: "PLAN_AUDIENCE_NO_META_INTERESTS" } })),
      ev("campaign.plan", "success"),
      ev("campaign.plan", "failed", { attributes: { errorCode: "PLAN_MODEL_EXHAUSTED_MIXED" } }),
    ];
    const requests = [3000, 4000, 9000].map((ms) => ev("http.request", "success", { duration_ms: ms, attributes: { route: "/api/campaigns/plan" } }));
    const other = ev("http.request", "success", { duration_ms: 60_000, attributes: { route: "/api/other" } });
    expect(row(board([...plans, ...requests, other]), "Prepare")).toEqual({
      step: "Prepare",
      now: "20 runs: 95% planned (18 partial, 1 failed: `PLAN_MODEL_EXHAUSTED_MIXED` ×1); p90 9.0 s",
      target: "≥ 95% success, p90 < 8 s",
      met: false,
    });
    expect(row(board([...plans, ...requests.slice(0, 2)]), "Prepare").met).toBe(true);
  });

  it("Prepare prefers the plan event's own duration once it carries one (#821)", () => {
    const timed = Array.from({ length: 20 }, () => ev("campaign.plan", "success", { duration_ms: 2_500 }));
    const slowRequest = ev("http.request", "success", { duration_ms: 20_000, attributes: { route: "/api/campaigns/plan" } });
    expect(row(board([...timed, slowRequest]), "Prepare")).toMatchObject({ now: "20 runs: 100% planned (0 partial, 0 failed); p90 2.5 s", met: true });
  });

  it("Create needs 3 ads per batch and times a run from its first AI call's start to its last call", () => {
    const batches = [ev("creative.batch", "success", { attributes: { count: 3 } }), ev("creative.batch", "partial", { attributes: { count: 2 } })];
    const calls = [
      call("creatives.generate", "success", { request_id: "r1", created_at: at(60), latency_ms: 10_000 }),
      call("creatives.generate", "error", { request_id: "r1", created_at: at(59.5), latency_ms: 2_000 }),
      call("creatives.generate", "success", { request_id: "r2", created_at: at(30), latency_ms: 12_000 }),
    ];
    const customers = "Create (customers, paid images)";
    expect(row(board(batches, calls), customers)).toMatchObject({ now: "2 batches: 50% gave 3 ads; AI calls 1/3 failed; p90 40 s", met: false });
    expect(row(board([batches[0]], calls.slice(2)), customers).met).toBe(true);
  });

  it("splits Create by image path and holds only the customer path to the target", () => {
    const b = board(
      [ev("creative.batch", "success", { attributes: { count: 3 } }), ev("creative.batch", "success", { user_id: FREE, attributes: { count: 3 } })],
      [call("creatives.generate", "success", { request_id: "c", latency_ms: 20_000 }), call("creatives.generate", "success", { user_id: FREE, request_id: "f", latency_ms: 110_000 })],
    );
    expect(row(b, "Create (customers, paid images)")).toMatchObject({ now: "1 batch: 100% gave 3 ads; AI calls 0/1 failed; p90 20 s", met: true });
    expect(row(b, "Create (internal, free images)")).toEqual({
      step: "Create (internal, free images)",
      now: "1 batch: 100% gave 3 ads; AI calls 0/1 failed; p90 110 s",
      target: "not a target: free Pollinations images, internal only",
      met: null,
    });
  });

  it("Regenerate and the assistant count a request as ok when any of its calls succeeded", () => {
    const b = board([], [
      call("creatives.regenerate", "error", { request_id: "a" }),
      call("creatives.regenerate", "success", { request_id: "a" }),
      call("creatives.regenerate", "error", { request_id: "b" }),
      call("creatives.assistant", "success"),
    ]);
    expect(row(b, "Regenerate")).toMatchObject({ now: "2 requests: 50% succeeded", met: false });
    expect(row(b, "Creative assistant")).toMatchObject({ now: "1 request: 100% succeeded", met: true });
  });

  it("Review and Brand are reported but judged by walks", () => {
    const b = board([ev("campaign.review"), ev("campaign.review", "rejected", { attributes: { errorCode: "PREFLIGHT_BLOCKED" } }), ev("business.create"),
      ev("brand.autofill", "failed", { attributes: { errorCode: "http.502" } })]);
    expect(row(b, "Review")).toMatchObject({ now: "2 reviews: 1 passed, 1 rejected (`PREFLIGHT_BLOCKED` ×1)", met: null });
    expect(row(b, "Brand")).toMatchObject({ now: "1 new business; autofill 1 call (1 failed)", met: null });
  });

  // #1025: first-setup autofill has no business, so no usage row; the route's own event counts it, with its p90.
  it("Brand counts autofill from the route's event, with how long successful ones took", () => {
    const runs = [1200, 2800, 3100, 9000].map((ms) => ev("brand.autofill", "success", { duration_ms: ms, business_id: null }));
    const b = board([ev("business.create"), ...runs, ev("brand.autofill", "failed", { attributes: { errorCode: "http.502" } })], [call("brand.autofill")]);
    expect(row(b, "Brand")).toMatchObject({ now: "1 new business; autofill 5 calls (1 failed, p90 9.0 s)", met: null });
  });

  it("Launch scores settled launches, not the reads that share the create_paused purpose (#615)", () => {
    const reads = [ev("meta.create_paused"), ev("meta.create_paused", "failed", { attributes: { errorCode: "META_OPERATION_FAILED" } })];
    expect(row(board(reads), "Launch")).toMatchObject({
      now: "no launches; Meta calls under `create_paused` 1/2 failed (`META_OPERATION_FAILED` ×1)", met: null,
    });
    const ops = [...Array.from({ length: 199 }, () => launch("succeeded")), launch("needs_reconciliation"), launch("running")];
    expect(row(board(reads, [], ops), "Launch")).toMatchObject({
      now: "200 launches: 99.5% succeeded (needs_reconciliation ×1), 1 running; Meta calls under `create_paused` 1/2 failed (`META_OPERATION_FAILED` ×1)",
      met: true,
    });
    expect(row(board([], [], [launch("succeeded"), launch("failed")]), "Launch").met).toBe(false);
  });

  it("#992: Manage scores the age of active campaigns' newest results, not when someone last read them", () => {
    const live = (minAgo: number | null, business_id = "real-business"): ScoreActiveResult => ({ business_id, fetched_at: minAgo === null ? null : at(minAgo) });
    expect(row(board([ev("meta.read_insights"), ev("campaign.refresh")], [], [], [live(3), live(15)]), "Manage"))
      .toMatchObject({ now: "2 active campaigns: oldest results 15 min old; 1 sync, 1 results read (0 failed)", met: true });
    // A fresh read event can't hide stale data: the scoreboard follows fetched_at.
    expect(row(board([ev("meta.read_insights", "success", { created_at: at(1) })], [], [], [live(40)]), "Manage"))
      .toMatchObject({ now: "1 active campaign: oldest results 40 min old; 0 syncs, 1 results read (0 failed)", met: false });
    expect(row(board([], [], [], [live(2), live(null)]), "Manage"))
      .toMatchObject({ now: "2 active campaigns: 1 with no results in 24 h; 0 syncs, 0 results reads (0 failed)", met: false });
    // The smoke's own campaign is left out; no active campaign means no score.
    expect(row(board([], [], [], [live(90, SMOKE_BIZ)]), "Manage"))
      .toMatchObject({ now: "no active campaigns; 0 syncs, 0 results reads (0 failed)", met: null });
  });

  it("newestResults keeps the newest fetched_at per active campaign", () => {
    expect(newestResults(
      [{ id: "c1", business_id: "b1" }, { id: "c2", business_id: "b2" }],
      [{ campaign_id: "c1", fetched_at: at(30) }, { campaign_id: "c1", fetched_at: at(5) }, { campaign_id: "other", fetched_at: at(1) }],
    )).toEqual([{ business_id: "b1", fetched_at: at(5) }, { business_id: "b2", fetched_at: null }]);
  });

  it("renders one public markdown table without identifiers", () => {
    const b = board([ev("campaign.plan", "failed", { user_id: SMOKE })], [], [launch("succeeded")]);
    expect(b.hours).toBe(24);
    expect(b.markdown).toContain("**Core scoreboard** (production, 24 h to 2026-10-26T03:30Z; smoke excluded: 1 events, 0 AI calls)");
    expect(b.markdown).toContain("| Launch | 1 launch: 100% succeeded; Meta calls under `create_paused` 0/0 failed | ≥ 99.5% | ✅ |");
    expect(b.markdown).toContain("| Prepare | no runs | ≥ 95% success, p90 < 8 s | — |");
    expect(b.markdown).toContain("1 of 1 measured rows meet target");
    expect(b.markdown).not.toMatch(/real-user|real-business|smoke-user|smoke-business/);
  });
});
