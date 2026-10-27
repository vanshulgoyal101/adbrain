/**
 * Daily core scoreboard (#681): one row per core step with the current number and its Nov 2 target,
 * from `product_events` and `llm_usage_events`, with the production smoke left out (by its auth user
 * id and the businesses it owns). Pure: the cron route fetches the rows, this turns them into numbers.
 * Create is split by image path: internal accounts make free Pollinations images (spend-policy.ts),
 * customers the paid route, and only the customer path is held to the target.
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
};

/** One launch attempt (`campaign_operations`): the create itself, not the reads that share its Meta purpose. */
export type ScoreLaunch = { business_id: string; state: string; created_at: string };

/** An active, Meta-bound campaign and its newest `campaign_results.fetched_at` in the window (null: none). */
export type ScoreActiveResult = { business_id: string; fetched_at: string | null };

/** Newest result per active campaign, from `campaign_results` rows read for the window. */
export function newestResults(campaigns: Array<{ id: string; business_id: string }>, results: Array<{ campaign_id: string; fetched_at: string }>): ScoreActiveResult[] {
  const newest = new Map<string, string>();
  for (const row of results) {
    const seen = newest.get(row.campaign_id);
    if (!seen || Date.parse(row.fetched_at) > Date.parse(seen)) newest.set(row.campaign_id, row.fetched_at);
  }
  return campaigns.map((campaign) => ({ business_id: campaign.business_id, fetched_at: newest.get(campaign.id) ?? null }));
}

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
  const requests = new Map<string, { ok: boolean; start: number; end: number }>();
  calls.forEach((call, index) => {
    const key = call.request_id ?? `call-${index}`;
    const end = Date.parse(call.created_at);
    const start = end - (call.latency_ms ?? 0);
    const ok = call.status === "success";
    const current = requests.get(key);
    requests.set(key, current
      ? { ok: current.ok || ok, start: Math.min(current.start, start), end: Math.max(current.end, end) }
      : { ok, start, end });
  });
  return [...requests.values()];
}

const hoursOf = (input: { since: Date; until: Date }) => Math.round((input.until.getTime() - input.since.getTime()) / 3_600_000);

export function buildScoreboard(input: {
  events: ScoreEvent[];
  aiCalls: ScoreAiCall[];
  launches: ScoreLaunch[];
  /** Active campaigns now (#992): Manage scores how old their newest results are, not when someone last read them. */
  activeResults: ScoreActiveResult[];
  /** Users whose ads use free images (`freeImagesOnly`): internal accounts not exempt. */
  freeImageUserIds: string[];
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
    // #821: the plan event's own duration once it carries one; the plan route's request time before that.
    const planned = plans.filter((event) => typeof event.duration_ms === "number").map((event) => event.duration_ms as number);
    const ms = p90(planned.length ? planned : named("http.request")
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

  const free = new Set(input.freeImageUserIds);
  const onFreePath = (row: { user_id: string | null }) => Boolean(row.user_id && free.has(row.user_id));
  for (const [step, freePath] of [["Create (customers, paid images)", false], ["Create (internal, free images)", true]] as const) {
    const batches = named("creative.batch").filter((event) => onFreePath(event) === freePath);
    const full = batches.filter((event) => event.outcome === "success" && Number(event.attributes?.count ?? 0) >= 3).length;
    const rate = percent(full, batches.length);
    const calls = ai("creatives.generate").filter((call) => onFreePath(call) === freePath);
    const failedCalls = calls.filter((call) => call.status !== "success").length;
    const seconds = p90(requestOutcomes(calls).map((request) => (request.end - request.start) / 1000));
    rows.push({
      step,
      now: batches.length
        ? `${plural(batches.length, "batch", "batches")}: ${fmtPct(rate)} gave 3 ads; AI calls ${failedCalls}/${calls.length} failed; p90 ${seconds === null ? "n/a" : `${Math.round(seconds)} s`}`
        : "no batches",
      target: freePath ? "not a target: free Pollinations images, internal only" : "≥ 95% of batches give 3 usable ads, p90 < 30 s",
      met: freePath || !batches.length ? null : rate >= 95 && seconds !== null && seconds < 30,
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
    // Settled launches only: a running one is neither a success nor a failure yet.
    const launches = input.launches.filter((launch) => !businesses.has(launch.business_id));
    const settled = launches.filter((launch) => !["pending", "running"].includes(launch.state));
    const succeeded = settled.filter((launch) => launch.state === "succeeded").length;
    const states = new Map<string, number>();
    for (const launch of settled) if (launch.state !== "succeeded") states.set(launch.state, (states.get(launch.state) ?? 0) + 1);
    const rate = percent(succeeded, settled.length);
    // `create_paused` is also the purpose of Prepare, lead-form, preflight and WhatsApp-status reads (#615): context, not the score.
    const calls = named("meta.create_paused");
    const failedCalls = calls.filter((event) => event.outcome !== "success");
    const running = launches.length - settled.length;
    rows.push({
      step: "Launch",
      now: `${settled.length ? `${plural(settled.length, "launch", "launches")}: ${fmtPct(rate)} succeeded${states.size ? ` (${[...states].map(([state, n]) => `${state} ×${n}`).join(", ")})` : ""}` : "no launches"}${running ? `, ${running} running` : ""}; Meta calls under \`create_paused\` ${failedCalls.length}/${calls.length} failed${failedCalls.length ? ` (${topCodes(failedCalls)})` : ""}`,
      target: "≥ 99.5%",
      met: settled.length ? rate >= 99.5 : null,
    });
  }

  {
    const refreshes = named("campaign.refresh");
    const reads = named("meta.read_insights");
    const failed = [...refreshes, ...reads].filter((event) => event.outcome !== "success").length;
    // #992: the age of the data on screen (newest `fetched_at` per active campaign), the oldest one scored.
    const live = input.activeResults.filter((campaign) => !businesses.has(campaign.business_id));
    const missing = live.filter((campaign) => campaign.fetched_at === null).length;
    const oldest = Math.max(0, ...live.filter((campaign) => campaign.fetched_at !== null)
      .map((campaign) => Math.floor((input.until.getTime() - Date.parse(campaign.fetched_at as string)) / 60_000)));
    const age = !live.length ? "no active campaigns"
      : missing ? `${plural(live.length, "active campaign")}: ${missing} with no results in ${hoursOf(input)} h`
        : `${plural(live.length, "active campaign")}: oldest results ${oldest} min old`;
    rows.push({
      step: "Manage",
      now: `${age}; ${plural(refreshes.length, "sync")}, ${plural(reads.length, "results read")} (${failed} failed)`,
      target: "results ≤ 15 min old, always say when",
      met: live.length ? missing === 0 && oldest <= 15 : null,
    });
  }

  const hours = hoursOf(input);
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
