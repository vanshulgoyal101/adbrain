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
  "business.update",
  "brand.autofill",
  "campaign.plan",
  "creative.batch",
  "campaign.review",
  "meta.create_paused",
  "campaign.refresh",
  "meta.read_insights",
  // #1242 north-star baselines (#1226).
  "campaign.resume",
  "page.view",
  "ui.action",
  "ui.tap",
] as const;
/** #1242: first sign-ins that created the account (`auth.sign_up.<method>`); the script matches the prefix. */
export const SCOREBOARD_SIGN_UP_PREFIX = "auth.sign_up.";
/** #1226 weekly return: the screens where an owner sees results. */
export const RESULTS_PAGES = ["/dashboard", "/campaigns"] as const;
export const SCOREBOARD_PLAN_ROUTE = "/api/campaigns/plan";
export const SCOREBOARD_AI_ROUTES = ["brand.autofill", "creatives.generate", "creatives.regenerate", "creatives.assistant"] as const;

const percent = (part: number, whole: number) => (whole ? (100 * part) / whole : 0);
const fmtPct = (value: number) => `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

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
  /** #1242: who owns each business, so a sign-up is matched to its own first live campaign. */
  businessOwners?: Array<{ id: string; owner_id: string }>;
  /** #1242: internal and demo accounts, left out of the owner rows (sign-up, taps, weekly return). */
  internalUserIds?: string[];
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
    const creates = named("business.create");
    // #1136: minutes from creating the business to its first save with what Prepare needs (brand/usable.ts).
    const saves = [...creates, ...named("business.update")];
    const measured = saves.some((event) => typeof event.attributes?.brandUsable === "boolean");
    const minutes = creates.flatMap((create) => {
      const start = Date.parse(create.created_at);
      const usable = saves.filter((save) => save.business_id === create.business_id && save.attributes?.brandUsable === true
        && Date.parse(save.created_at) >= start).map((save) => Date.parse(save.created_at));
      return usable.length ? [(Math.min(...usable) - start) / 60_000] : [];
    });
    const slowestUsable = p90(minutes);
    const usable = !creates.length ? "" : !measured ? " (usable: not measured yet)"
      : `: ${fmtPct(Math.round(percent(minutes.length, creates.length)))} usable${slowestUsable === null ? "" : `, p90 ${slowestUsable.toFixed(1)} min`}`;
    // #1025: the route's own event counts first-setup autofills (no business yet, so no usage row).
    const autofill = named("brand.autofill");
    const failed = autofill.filter((event) => event.outcome !== "success").length;
    const slowest = p90(autofill.filter((event) => event.outcome === "success" && typeof event.duration_ms === "number").map((event) => event.duration_ms!));
    rows.push({
      step: "Brand",
      now: `${plural(creates.length, "new business", "new businesses")}${usable}; autofill ${plural(autofill.length, "call")} (${failed} failed${slowest === null ? "" : `, p90 ${(slowest / 1000).toFixed(1)} s`})`,
      target: "new business usable (name, category, area, phone, offer) in < 2 min on a phone",
      met: creates.length && measured ? slowestUsable !== null && slowestUsable < 2 : null,
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

  rows.push(...northStarRows(events, input));

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

const istDay = (iso: string) => new Date(Date.parse(iso) + 5.5 * 3_600_000).toISOString().slice(0, 10);

/**
 * #1242: today's baselines for #1226's north-star metrics, owners only (smoke, internal and demo accounts left out).
 * 1. Sign-up → first campaign live: minutes from `auth.sign_up.*` to the first `campaign.resume` (the owner turning a
 *    campaign on) for a business the new user owns.
 * 2. Taps from Create to Live: `ui.tap` events from the last Create page view before the owner's first ad batch to
 *    their first `campaign.resume` after it.
 * 3. Weekly return: distinct days (IST) with a Home or Campaigns view, per owner, scaled to a week.
 */
export function northStarRows(events: ScoreEvent[], input: {
  businessOwners?: Array<{ id: string; owner_id: string }>; internalUserIds?: string[]; since: Date; until: Date;
}): ScoreRow[] {
  const internal = new Set(input.internalUserIds ?? []);
  const owned = events.filter((event) => event.user_id && !internal.has(event.user_id))
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const by = (user: string, test: (event: ScoreEvent) => boolean) => owned.filter((event) => event.user_id === user && test(event));
  const live = (event: ScoreEvent) => event.name === "campaign.resume" && event.outcome === "success";
  const rows: ScoreRow[] = [];

  {
    const ownerOf = new Map((input.businessOwners ?? []).map((business) => [business.id, business.owner_id]));
    const signUps = owned.filter((event) => event.name.startsWith(SCOREBOARD_SIGN_UP_PREFIX));
    const minutes = signUps.flatMap((signUp) => {
      const first = owned.find((event) => live(event) && event.business_id && ownerOf.get(event.business_id) === signUp.user_id
        && Date.parse(event.created_at) >= Date.parse(signUp.created_at));
      return first ? [(Date.parse(first.created_at) - Date.parse(signUp.created_at)) / 60_000] : [];
    });
    const middle = median(minutes);
    rows.push({
      step: "Sign-up → first campaign live",
      now: signUps.length
        ? `${plural(signUps.length, "sign-up")}: ${minutes.length} live${middle === null ? "" : `, median ${middle < 120 ? `${Math.round(middle)} min` : `${(middle / 60).toFixed(1)} h`}`}`
        : "no sign-ups",
      target: "median ≤ 10 min (#1226)",
      met: middle === null ? null : middle <= 10,
    });
  }

  {
    const users = [...new Set(owned.filter((event) => event.name === "creative.batch").map((event) => event.user_id!))];
    const measured = owned.some((event) => event.name === "ui.tap");
    const taps = users.flatMap((user) => {
      const batch = by(user, (event) => event.name === "creative.batch")[0];
      const start = by(user, (event) => event.name === "page.view" && event.attributes?.route === "/create"
        && Date.parse(event.created_at) <= Date.parse(batch.created_at)).at(-1) ?? batch;
      const end = by(user, (event) => live(event) && Date.parse(event.created_at) >= Date.parse(batch.created_at))[0];
      if (!end) return [];
      return [by(user, (event) => event.name === "ui.tap" && event.created_at >= start.created_at && event.created_at <= end.created_at).length];
    });
    const middle = median(taps);
    rows.push({
      step: "Taps, Create → live",
      now: !measured ? "not measured yet (`ui.tap` events start with #1242)"
        : taps.length ? `${plural(taps.length, "owner")} reached live: median ${Math.round(middle!)} taps` : `no owner reached live (${plural(users.length, "owner")} made ads)`,
      target: "≤ 12 taps (#1226)",
      met: measured && middle !== null ? middle <= 12 : null,
    });
  }

  {
    const resultsView = (event: ScoreEvent) => event.name === "page.view" && (RESULTS_PAGES as readonly unknown[]).includes(event.attributes?.route);
    const views = owned.filter(resultsView);
    const teamViewers = new Set(events.filter((event) => resultsView(event) && event.user_id && internal.has(event.user_id)).map((event) => event.user_id)).size;
    const days = new Map<string, Set<string>>();
    for (const view of views) days.set(view.user_id!, (days.get(view.user_id!) ?? new Set()).add(istDay(view.created_at)));
    const windowDays = Math.max(1, (input.until.getTime() - input.since.getTime()) / 86_400_000);
    const perWeek = [...days.values()].map((set) => Math.min(7, (set.size * 7) / Math.max(7, windowDays)));
    const middle = median(perWeek);
    rows.push({
      step: "Weekly return (results views)",
      now: days.size
        ? `${plural(days.size, "owner")}: median ${middle!.toFixed(1)} days/week${windowDays < 7 ? ` (only ${Math.round(windowDays * 24)} h of data; run with --hours 168)` : ""}`
        : `no owner opened Home or Campaigns${teamViewers ? ` (team accounts: ${teamViewers})` : ""}`,
      target: "≥ 3 days/week (#1226)",
      met: middle === null || windowDays < 7 ? null : middle >= 3,
    });
  }
  return rows;
}
