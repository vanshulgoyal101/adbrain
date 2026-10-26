import { describe, expect, it } from "vitest";
import { buildScoreboard, p90, type ScoreAiCall, type ScoreEvent } from "@/lib/observability/core-scoreboard";

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
const board = (events: ScoreEvent[], aiCalls: ScoreAiCall[] = []) =>
  buildScoreboard({ events, aiCalls, excludedUserIds: [SMOKE], excludedBusinessIds: [SMOKE_BIZ], since, until });
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
    ], [call("creatives.regenerate", "error", { user_id: SMOKE })]);
    expect(b.excluded).toEqual({ events: 2, aiCalls: 1 });
    expect(row(b, "Launch")).toMatchObject({ now: "2 Meta create calls: 100% succeeded", met: true });
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

  it("Create needs 3 ads per batch and times a run from its first AI call's start to its last call", () => {
    const batches = [ev("creative.batch", "success", { attributes: { count: 3 } }), ev("creative.batch", "partial", { attributes: { count: 2 } })];
    const calls = [
      call("creatives.generate", "success", { request_id: "r1", created_at: at(60), latency_ms: 10_000 }),
      call("creatives.generate", "error", { request_id: "r1", created_at: at(59.5), latency_ms: 2_000 }),
      call("creatives.generate", "success", { request_id: "r2", created_at: at(30), latency_ms: 12_000 }),
    ];
    expect(row(board(batches, calls), "Create")).toMatchObject({ now: "2 batches: 50% gave 3 ads; AI calls 1/3 failed; p90 customer path 40 s (2), internal free path n/a", met: false });
    expect(row(board([batches[0]], calls.slice(2)), "Create").met).toBe(true);
  });

  // #681: internal accounts' free Pollinations images made the board read 112 s; customers wait on the paid path.
  it("Create times the customer path apart from the internal free path, and judges the customer path", () => {
    const batches = [ev("creative.batch", "success", { attributes: { count: 3 } })];
    const calls = [
      call("creatives.generate", "success", { request_id: "paid", created_at: at(60), latency_ms: 20_000 }),
      call("creatives.generate", "success", { request_id: "paid", created_at: at(59.98), latency_ms: 14_000, usage_kind: "image", provider: "openrouter-image" }),
      call("creatives.generate", "success", { request_id: "free", created_at: at(30), latency_ms: 14_000 }),
      call("creatives.generate", "success", { request_id: "free", created_at: at(28), latency_ms: 90_000, usage_kind: "image", provider: "pollinations" }),
    ];
    expect(row(board(batches, calls), "Create")).toMatchObject({
      now: "1 batch: 100% gave 3 ads; AI calls 0/4 failed; p90 customer path 21 s (1), internal free path 134 s (1)",
      target: "≥ 95% of batches give 3 usable ads, customer-path p90 < 30 s",
      met: true,
    });
    // With no paid run in the window, the free path stands in.
    expect(row(board(batches, calls.slice(2)), "Create").met).toBe(false);
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
    const b = board([ev("campaign.review"), ev("campaign.review", "rejected", { attributes: { errorCode: "PREFLIGHT_BLOCKED" } }), ev("business.create")],
      [call("brand.autofill", "error")]);
    expect(row(b, "Review")).toMatchObject({ now: "2 reviews: 1 passed, 1 rejected (`PREFLIGHT_BLOCKED` ×1)", met: null });
    expect(row(b, "Brand")).toMatchObject({ now: "1 new business; autofill 1 call (1 failed)", met: null });
  });

  it("Launch must be at least 99.5% and Manage needs fresh results with no failures", () => {
    const launches = [...Array.from({ length: 199 }, () => ev("meta.create_paused")), ev("meta.create_paused", "failed", { attributes: { errorCode: "META_200" } })];
    expect(row(board(launches), "Launch")).toMatchObject({ now: "200 Meta create calls: 99.5% succeeded (`META_200` ×1)", met: true });
    expect(row(board([ev("meta.read_insights", "success", { created_at: at(10) }), ev("campaign.refresh")]), "Manage"))
      .toMatchObject({ now: "1 sync, 1 results read (0 failed); last results read 10 min ago", met: true });
    expect(row(board([ev("meta.read_insights", "success", { created_at: at(40) })]), "Manage").met).toBe(false);
    expect(row(board([]), "Manage")).toMatchObject({ now: "0 syncs, 0 results reads (0 failed); last results read none", met: null });
  });

  it("renders one public markdown table without identifiers", () => {
    const b = board([ev("meta.create_paused"), ev("campaign.plan", "failed", { user_id: SMOKE })]);
    expect(b.hours).toBe(24);
    expect(b.markdown).toContain("**Core scoreboard** (production, 24 h to 2026-10-26T03:30Z; smoke excluded: 1 events, 0 AI calls)");
    expect(b.markdown).toContain("| Launch | 1 Meta create call: 100% succeeded | ≥ 99.5% | ✅ |");
    expect(b.markdown).toContain("| Prepare | no runs | ≥ 95% success, p90 < 8 s | — |");
    expect(b.markdown).toContain("1 of 1 measured rows meet target");
    expect(b.markdown).not.toMatch(/real-user|real-business|smoke-user|smoke-business/);
  });
});
