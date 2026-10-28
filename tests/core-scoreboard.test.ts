import { describe, expect, it } from "vitest";
import { buildScoreboard, lastIstWeek, median, newestResults, northStarRows, p90, type NorthStarData, type ScoreActiveResult, type ScoreAiCall, type ScoreEvent, type ScoreLaunch } from "@/lib/observability/core-scoreboard";

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

  it("#1468: the median estimated AI cost per Create, from batches that recorded one", () => {
    const batches = [0.012, 0.003, 0.0405].map((usd) => ev("creative.batch", "success", { attributes: { count: 3, costUsd: usd } }));
    const calls = [call("creatives.generate", "success", { request_id: "r1", latency_ms: 10_000 })];
    expect(row(board([...batches, ev("creative.batch", "success", { attributes: { count: 3 } })], calls), "Create (customers, paid images)").now)
      .toBe("4 batches: 100% gave 3 ads; AI calls 0/1 failed; p90 10 s; median $0.0120 (≈₹1.01) per Create");
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
      target: "not a target: free images, internal only",
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
    expect(row(b, "Brand")).toMatchObject({ now: "1 new business (usable: not measured yet); autofill 1 call (1 failed)", met: null });
  });

  // #1025: first-setup autofill has no business, so no usage row; the route's own event counts it, with its p90.
  it("Brand counts autofill from the route's event, with how long successful ones took", () => {
    const runs = [1200, 2800, 3100, 9000].map((ms) => ev("brand.autofill", "success", { duration_ms: ms, business_id: null }));
    const b = board([ev("business.create"), ...runs, ev("brand.autofill", "failed", { attributes: { errorCode: "http.502" } })], [call("brand.autofill")]);
    expect(row(b, "Brand")).toMatchObject({ now: "1 new business (usable: not measured yet); autofill 5 calls (1 failed, p90 9.0 s)", met: null });
  });

  it("Brand times each new business from create to its first usable save (#1136)", () => {
    const usable = (business_id: string, minAgo: number, flag = true) => ev("business.update", "success", { business_id, created_at: at(minAgo), attributes: { brandUsable: flag } });
    const create = (business_id: string, minAgo: number, flag = false) => ev("business.create", "success", { business_id, created_at: at(minAgo), attributes: { brandUsable: flag } });
    // a: usable after 1.5 min (an earlier unusable save doesn't count); b: usable at create; c: never usable;
    // d: a usable save from before its create (another day's business) doesn't count; smoke is left out.
    const b = board([
      create("a", 100), usable("a", 99, false), usable("a", 98.5), usable("a", 90),
      create("b", 80, true),
      create("c", 70), usable("c", 60, false),
      usable("d", 50), create("d", 40),
      create("smoke-biz", 30), usable("smoke-biz", 0),
    ].map((event) => event.business_id === "smoke-biz" ? { ...event, user_id: SMOKE } : event));
    expect(row(b, "Brand")).toMatchObject({ now: "4 new businesses: 50% usable, p90 1.5 min; autofill 0 calls (0 failed)", met: true });
    const slow = board([create("a", 100), usable("a", 95)]);
    expect(row(slow, "Brand")).toMatchObject({ now: "1 new business: 100% usable, p90 5.0 min; autofill 0 calls (0 failed)", met: false });
    expect(row(board([create("a", 100)]), "Brand")).toMatchObject({ now: "1 new business: 0% usable; autofill 0 calls (0 failed)", met: false });
    expect(row(board([]), "Brand")).toMatchObject({ now: "0 new businesses; autofill 0 calls (0 failed)", met: null });
  });

  it("Brand starts a new owner's clock at sign-up and leaves the team's accounts out (#1136)", () => {
    const create = (business_id: string, user_id: string, minAgo: number) => ev("business.create", "success", { business_id, user_id, created_at: at(minAgo), attributes: { brandUsable: true } });
    const events = [create("new", "new-owner", 100), create("old", "old-owner", 90), create("team", "qa", 80), create("late", "late-owner", 70)];
    const b = buildScoreboard({ events, aiCalls: [], launches: [], activeResults: [], freeImageUserIds: [], excludedUserIds: [SMOKE], excludedBusinessIds: [], since, until,
      brandOwners: [
        { id: "new-owner", signedUpAt: at(103), internal: false }, // signed up 3 min before the usable create
        { id: "old-owner", signedUpAt: at(60 * 24 * 30), internal: false }, // an older account: the clock starts at create
        { id: "qa", signedUpAt: at(81), internal: true },
        { id: "late-owner", signedUpAt: at(60), internal: false }, // sign-up after create (clock skew): create starts it
      ] });
    expect(row(b, "Brand")).toMatchObject({ now: "3 new businesses (1 team left out): 100% usable, p90 3.0 min; autofill 0 calls (0 failed)", met: false });
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

// #1242 / #1284: #1226's north-star rows, as the CPO defined them (weeks Mon–Sun IST, owners only).
describe("north-star rows (#1242, #1284)", () => {
  const NOW = new Date("2026-10-28T06:30:00Z"); // Wed 28 Oct, 12:00 IST: the last full week is 19–25 Oct IST
  const OWNER = "owner-1", INTERNAL = "team-1";
  const at = (iso: string) => new Date(iso).toISOString();
  const base: NorthStarData = {
    signUps: [], businesses: [{ id: "b-owner", owner_id: OWNER }, { id: "b-team", owner_id: INTERNAL }],
    campaignChanges: [], campaigns: [], pageViews: [], helpTaps: [], leads: [], internalUserIds: [INTERNAL], now: NOW,
  };
  const rowsOf = (data: Partial<NorthStarData>, events: ScoreEvent[] = []) => northStarRows(events, { ...base, ...data });
  const rowOf = (rows: ReturnType<typeof northStarRows>, step: string) => rows.find((r) => r.step.startsWith(step))!;

  it("finds the last full Monday–Sunday IST week", () => {
    expect(lastIstWeek(NOW)).toEqual({ start: Date.parse("2026-10-18T18:30:00Z"), end: Date.parse("2026-10-25T18:30:00Z") });
    expect(lastIstWeek(new Date("2026-10-25T18:29:00Z")).end).toBe(Date.parse("2026-10-18T18:30:00Z"));
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("sign-up → first live: that week's cohort, the owner's first resume within 14 days, % live, team left out", () => {
    const rows = rowsOf({
      signUps: [{ id: OWNER, created_at: at("2026-10-20T04:00:00Z") }, { id: "slow", created_at: at("2026-10-21T04:00:00Z") },
        { id: "never", created_at: at("2026-10-22T04:00:00Z") }, { id: INTERNAL, created_at: at("2026-10-20T04:00:00Z") },
        { id: "next-week", created_at: at("2026-10-27T04:00:00Z") }],
      businesses: [...base.businesses, { id: "b-slow", owner_id: "slow" }],
      campaignChanges: [
        { campaign_id: "c1", business_id: "b-owner", action: "campaign.resume", created_at: at("2026-10-20T04:08:00Z") },
        { campaign_id: "c1", business_id: "b-owner", action: "campaign.resume", created_at: at("2026-10-23T04:00:00Z") },
        { campaign_id: "c2", business_id: "b-slow", action: "campaign.resume", created_at: at("2026-10-21T05:00:00Z") },
        { campaign_id: "c3", business_id: "b-team", action: "campaign.resume", created_at: at("2026-10-20T04:01:00Z") },
      ],
    });
    expect(rowOf(rows, "Sign-up")).toMatchObject({ now: "week of 19 Oct: 3 sign-ups, 67% live, median 34 min (counting until 8 Nov)", met: false });
  });

  it("owners needing help: help taps before going live, in that week's cohort", () => {
    const rows = rowsOf({
      signUps: [{ id: OWNER, created_at: at("2026-10-20T04:00:00Z") }, { id: "b", created_at: at("2026-10-20T05:00:00Z") }, { id: "c", created_at: at("2026-10-20T06:00:00Z") }],
      campaignChanges: [{ campaign_id: "c1", business_id: "b-owner", action: "campaign.resume", created_at: at("2026-10-20T05:00:00Z") }],
      helpTaps: [{ user_id: OWNER, created_at: at("2026-10-20T06:00:00Z") }, { user_id: "b", created_at: at("2026-10-20T05:30:00Z") }],
    });
    expect(rowOf(rows, "Owners needing help")).toMatchObject({ now: "week of 19 Oct: 1 of 3 new owners tapped Help on WhatsApp before going live (#796 calls not counted)", met: true });
  });

  it("time to first contact: from Meta's created_time when there is one, with % contacted", () => {
    const rows = rowsOf({ leads: [
      { created_time: at("2026-10-27T10:00:00Z"), created_at: at("2026-10-28T04:00:00Z"), first_contacted_at: at("2026-10-27T10:12:00Z") },
      { created_time: null, created_at: at("2026-10-27T11:00:00Z"), first_contacted_at: at("2026-10-27T11:20:00Z") },
      { created_time: null, created_at: at("2026-10-27T12:00:00Z"), first_contacted_at: null },
    ] });
    expect(rowOf(rows, "Time to first contact")).toMatchObject({ now: "3 enquiries in 7 days: 67% contacted, median 16 min", met: false });
  });

  it("weekly return: owners with a campaign live at any point that week, distinct IST days on Home, Campaigns or Enquiries", () => {
    const view = (user: string, iso: string, route = "/dashboard") => ({ user_id: user, route, created_at: at(iso) });
    const rows = rowsOf({
      businesses: [...base.businesses, { id: "b-two", owner_id: "two" }, { id: "b-paused", owner_id: "paused" }],
      campaigns: [{ id: "c1", business_id: "b-owner", status: "paused" }, { id: "c2", business_id: "b-two", status: "active" },
        { id: "c3", business_id: "b-paused", status: "paused" }, { id: "c4", business_id: "b-team", status: "active" }],
      campaignChanges: [
        // Live when the week began, paused mid-week: counts.
        { campaign_id: "c1", business_id: "b-owner", action: "campaign.resume", created_at: at("2026-10-15T04:00:00Z") },
        { campaign_id: "c1", business_id: "b-owner", action: "campaign.pause", created_at: at("2026-10-22T04:00:00Z") },
        // Paused before the week and not resumed in it: doesn't.
        { campaign_id: "c3", business_id: "b-paused", action: "campaign.resume", created_at: at("2026-10-10T04:00:00Z") },
        { campaign_id: "c3", business_id: "b-paused", action: "campaign.pause", created_at: at("2026-10-12T04:00:00Z") },
      ],
      pageViews: [view(OWNER, "2026-10-19T04:00:00Z"), view(OWNER, "2026-10-19T09:00:00Z", "/leads"), view(OWNER, "2026-10-20T04:00:00Z", "/campaigns"),
        view(OWNER, "2026-10-22T19:00:00Z"), view("two", "2026-10-21T04:00:00Z"), view("paused", "2026-10-21T04:00:00Z"), view(INTERNAL, "2026-10-21T04:00:00Z")],
    });
    // owner-1: 19, 20, 23 Oct (IST) = 3 days; "two" (active, no changes on record): 1 day → median 2.
    expect(rowOf(rows, "Weekly return")).toMatchObject({ now: "week of 19 Oct: 2 owners with a live campaign: median 2 days", met: false });
  });

  it("says so plainly when there's nothing to measure", () => {
    const rows = rowsOf({});
    expect(rows.map((row) => [row.step, row.met])).toEqual([
      ["Sign-up → first campaign live", null], ["Taps, Create → live", null], ["Owners needing help", null],
      ["Time to first contact", null], ["Weekly return (results views)", null],
    ]);
    expect(rowOf(rows, "Weekly return").now).toBe("week of 19 Oct: no owner outside the team had a live campaign");
  });

  it("counts taps from the Create page view before the first batch to the first live campaign after it", () => {
    const e = (name: string, user: string, minutes: number, extra: Partial<ScoreEvent> = {}): ScoreEvent =>
      ({ name, outcome: "success", user_id: user, business_id: "b-owner", duration_ms: null, attributes: {}, created_at: new Date(Date.parse("2026-10-27T04:00:00Z") + minutes * 60_000).toISOString(), ...extra });
    const tap = (minutes: number) => e("ui.tap", OWNER, minutes);
    const rows = rowsOf({}, [tap(-30), e("page.view", OWNER, -10, { attributes: { route: "/create" } }), tap(-5), tap(-4),
      e("creative.batch", OWNER, 0), tap(2), tap(3), tap(4), e("campaign.resume", OWNER, 5), tap(6), e("creative.batch", "stuck", 0), e("ui.tap", "stuck", 1)]);
    expect(rowOf(rows, "Taps")).toMatchObject({ now: "1 owner reached live: median 5 taps", met: true });
    expect(rowOf(rowsOf({}, [e("creative.batch", OWNER, 0)]), "Taps")).toMatchObject({ now: expect.stringContaining("not measured yet"), met: null });
  });
});

// #1467: sales prospects (#1317), the demo workspace and the smoke aren't customers; every row leaves them out.
describe("isScoreboardExcluded (#1467)", () => {
  it("leaves out smoke, demo and +prospect accounts, and keeps owners and the team's own walks", async () => {
    const { isScoreboardExcluded } = await import("@/lib/internal-accounts");
    const internal = (await import("@/lib/internal-accounts.json")).default;
    const domain = internal.domains[0];
    const confirmed = "2026-10-28T00:00:00Z";
    expect(isScoreboardExcluded({ id: "p", email: `sales+prospect-sunpeak@${domain}`, email_confirmed_at: confirmed })).toBe(true);
    expect(isScoreboardExcluded({ id: "d", email: "Demo@AdBrain.vanshul.com", email_confirmed_at: confirmed }, "demo@adbrain.vanshul.com")).toBe(true);
    if (internal.smokeUserIds[0]) expect(isScoreboardExcluded({ id: internal.smokeUserIds[0] })).toBe(true);
    expect(isScoreboardExcluded({ id: "o", email: "owner@gmail.com", email_confirmed_at: confirmed })).toBe(false);
    expect(isScoreboardExcluded({ id: "q", email: `qa2+ws1@${domain}`, email_confirmed_at: confirmed })).toBe(false);
    expect(isScoreboardExcluded(null)).toBe(false);
  });
});
