/**
 * Daily core scoreboard (#681): one row per core step with the current number and its Nov 2 target,
 * from `product_events` and `llm_usage_events`, with the production smoke left out (by its auth user
 * id and the businesses it owns). Pure: the cron route fetches the rows, this turns them into numbers.
 * Output is aggregate only (counts, rates, seconds, error codes) because it is posted publicly.
 */

export type ScoreEvent = {
  name: string;
  outcome: string;
  user_id: string | null;
  business_id: string | null;
  duration_ms: number | null;
  attributes: Record<string, unknown> | null;
  created_at: string;
};

export type ScoreAiCall = {
  route: string;
  status: string;
  user_id: string | null;
  business_id: string | null;
  request_id: string | null;
  latency_ms: number | null;
  created_at: string;
  provider?: string | null;
  usage_kind?: string | null;
};

export type ScoreRow = { step: string; now: string; target: string; met: boolean | null };

export type Scoreboard = {
  hours: number;
  since: string;
  until: string;
  excluded: { events: number; aiCalls: number };
  rows: ScoreRow[];
  markdown: string;
};

export const SCOREBOARD_EVENT_NAMES = [
  "business.create",
  "campaign.plan",
  "creative.batch",
  "campaign.review",
  "meta.create_paused",
  "campaign.refresh",
  "meta.read_insights",
] as const;
export const SCOREBOARD_PLAN_ROUTE = "/api/campaigns/plan";
export const SCOREBOARD_AI_ROUTES = ["brand.autofill", "creatives.generate", "creatives.regenerate", "creatives.assistant"] as const;

const percent = (part: number, whole: number) => (whole ? (100 * part) / whole : 0);
const fmtPct = (value: number) => `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

export function p90(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(0.9 * sorted.length) - 1];
}

function topCodes(events: ScoreEvent[], limit = 2): string {
  const counts = new Map<string, number>();
  for (const event of events) {
    const code = typeof event.attributes?.errorCode === "string" ? event.attributes.errorCode : "no code";
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit)
    .map(([code, n]) => `\`${code}\` ×${n}`).join(", ");
}

/** A request succeeds when any of its AI calls succeeded (retries and fallbacks are one request). */
function requestOutcomes(calls: ScoreAiCall[]) {
  const requests = new Map<string, { ok: boolean; start: number; end: number; free: boolean }>();
  calls.forEach((call, index) => {
    const key = call.request_id ?? `call-${index}`;
    const end = Date.parse(call.created_at);
    const start = end - (call.latency_ms ?? 0);
    const ok = call.status === "success";
    // #681: internal accounts make free Pollinations images; customers wait on the paid path.
    const free = call.usage_kind === "image" && call.provider === "pollinations";
    const current = requests.get(key);
    requests.set(key, current
      ? { ok: current.ok || ok, start: Math.min(current.start, start), end: Math.max(current.end, end), free: current.free || free }
      : { ok, start, end, free });
  });
  return [...requests.values()];
}

export function buildScoreboard(input: {
  events: ScoreEvent[];
  aiCalls: ScoreAiCall[];
  excludedUserIds: string[];
  excludedBusinessIds: string[];
  since: Date;
  until: Date;
}): Scoreboard {
  const users = new Set(input.excludedUserIds);
  const businesses = new Set(input.excludedBusinessIds);
  const kept = (row: { user_id: string | null; business_id: string | null }) =>
    row.user_id ? !users.has(row.user_id) : !(row.business_id && businesses.has(row.business_id));
  const events = input.events.filter(kept);
  const aiCalls = input.aiCalls.filter(kept);
  const named = (name: string) => events.filter((event) => event.name === name);
  const ai = (route: string) => aiCalls.filter((call) => call.route === route);
  const rows: ScoreRow[] = [];

  {
    const created = named("business.create").length;
    const autofill = ai("brand.autofill");
    const failed = autofill.filter((call) => call.status !== "success").length;
    rows.push({
      step: "Brand",
      now: `${plural(created, "new business", "new businesses")}; autofill ${plural(autofill.length, "call")} (${failed} failed)`,
      target: "new business filled in < 2 min on a phone (walk)",
      met: null,
    });
  }

  {
    const plans = named("campaign.plan");
    const failed = plans.filter((event) => event.outcome === "failed");
    const partial = plans.filter((event) => event.outcome === "partial").length;
    const rate = percent(plans.length - failed.length, plans.length);
    const ms = p90(named("http.request")
      .filter((event) => event.attributes?.route === SCOREBOARD_PLAN_ROUTE && typeof event.duration_ms === "number")
      .map((event) => event.duration_ms as number));
    rows.push({
      step: "Prepare",
      now: plans.length
        ? `${plural(plans.length, "run")}: ${fmtPct(rate)} planned (${partial} partial, ${failed.length} failed${failed.length ? `: ${topCodes(failed)}` : ""}); p90 ${ms === null ? "n/a" : `${(ms / 1000).toFixed(1)} s`}`
        : "no runs",
      target: "≥ 95% success, p90 < 8 s",
      met: plans.length ? rate >= 95 && ms !== null && ms < 8000 : null,
    });
  }

  {
    const batches = named("creative.batch");
    const full = batches.filter((event) => event.outcome === "success" && Number(event.attributes?.count ?? 0) >= 3).length;
    const rate = percent(full, batches.length);
    const calls = ai("creatives.generate");
    const failedCalls = calls.filter((call) => call.status !== "success").length;
    const requests = requestOutcomes(calls);
    const wall = (free: boolean) => requests.filter((request) => request.free === free).map((request) => (request.end - request.start) / 1000);
    const paid = wall(false);
    const free = wall(true);
    const paidSeconds = p90(paid);
    const freeSeconds = p90(free);
    const show = (value: number | null, n: number) => value === null ? "n/a" : `${Math.round(value)} s (${n})`;
    // The target is the customer path; with no paid runs in the window, the free path stands in.
    const seconds = paid.length ? paidSeconds : freeSeconds;
    rows.push({
      step: "Create",
      now: batches.length
        ? `${plural(batches.length, "batch", "batches")}: ${fmtPct(rate)} gave 3 ads; AI calls ${failedCalls}/${calls.length} failed; p90 customer path ${show(paidSeconds, paid.length)}, internal free path ${show(freeSeconds, free.length)}`
        : "no batches",
      target: "≥ 95% of batches give 3 usable ads, customer-path p90 < 30 s",
      met: batches.length ? rate >= 95 && seconds !== null && seconds < 30 : null,
    });
  }

  for (const [step, route] of [["Regenerate", "creatives.regenerate"], ["Creative assistant", "creatives.assistant"]] as const) {
    const requests = requestOutcomes(ai(route));
    const rate = percent(requests.filter((request) => request.ok).length, requests.length);
    rows.push({
      step,
      now: requests.length ? `${plural(requests.length, "request")}: ${fmtPct(rate)} succeeded` : "no requests",
      target: "≥ 95%",
      met: requests.length ? rate >= 95 : null,
    });
  }

  {
    const reviews = named("campaign.review");
    const rejected = reviews.filter((event) => event.outcome === "rejected");
    rows.push({
      step: "Review",
      now: reviews.length
        ? `${plural(reviews.length, "review")}: ${reviews.length - rejected.length} passed, ${rejected.length} rejected${rejected.length ? ` (${topCodes(rejected)})` : ""}`
        : "no reviews",
      target: "every rejection names the fix; no real user stuck (walk)",
      met: null,
    });
  }

  {
    const launches = named("meta.create_paused");
    const failed = launches.filter((event) => event.outcome !== "success");
    const rate = percent(launches.length - failed.length, launches.length);
    rows.push({
      step: "Launch",
      now: launches.length
        ? `${plural(launches.length, "Meta create call")}: ${fmtPct(rate)} succeeded${failed.length ? ` (${topCodes(failed)})` : ""}`
        : "no Meta create calls",
      target: "≥ 99.5%",
      met: launches.length ? rate >= 99.5 : null,
    });
  }

  {
    const refreshes = named("campaign.refresh");
    const reads = named("meta.read_insights");
    const failed = [...refreshes, ...reads].filter((event) => event.outcome !== "success").length;
    const lastRead = Math.max(...reads.filter((event) => event.outcome === "success").map((event) => Date.parse(event.created_at)));
    const age = Number.isFinite(lastRead) ? Math.floor((input.until.getTime() - lastRead) / 60_000) : null;
    rows.push({
      step: "Manage",
      now: `${plural(refreshes.length, "sync")}, ${plural(reads.length, "results read")} (${failed} failed); last results read ${age === null ? "none" : `${age} min ago`}`,
      target: "results ≤ 15 min old, always say when",
      met: age === null ? null : failed === 0 && age <= 15,
    });
  }

  const hours = Math.round((input.until.getTime() - input.since.getTime()) / 3_600_000);
  const excluded = { events: input.events.length - events.length, aiCalls: input.aiCalls.length - aiCalls.length };
  const mark = (met: boolean | null) => (met === null ? "—" : met ? "✅" : "❌");
  const measured = rows.filter((row) => row.met !== null);
  const markdown = [
    `**Core scoreboard** (production, ${hours} h to ${input.until.toISOString().slice(0, 16)}Z; smoke excluded: ${excluded.events} events, ${excluded.aiCalls} AI calls)`,
    "",
    "| Step | Now | Target | Met |",
    "|---|---|---|---|",
    ...rows.map((row) => `| ${row.step} | ${row.now} | ${row.target} | ${mark(row.met)} |`),
    "",
    `${measured.filter((row) => row.met).length} of ${measured.length} measured rows meet target; — means no data or judged by walks.`,
  ].join("\n");
  return { hours, since: input.since.toISOString(), until: input.until.toISOString(), excluded, rows, markdown };
}
