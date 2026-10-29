/**
 * Daily core scoreboard (#681): one row per core step with the current number and its Nov 2 target,
 * from `product_events` and `llm_usage_events`, with the production smoke left out (by its auth user
 * id and the businesses it owns). Pure: the cron route fetches the rows, this turns them into numbers.
 * Create is split by image path: internal accounts make free images (Cloudflare, then Pollinations) (spend-policy.ts),
 * customers the paid route, and only the customer path is held to the target.
 * Output is aggregate only (counts, rates, seconds, error codes) because it is posted publicly.
 */

import { medianReplyMinutes } from "@/lib/leads/first-reply";
import { isMetaTestLead } from "@/lib/leads/test-lead";

/** #1468: the rupee rate the CEO uses for AI money ($5 ≈ ₹420 on #1129); for reading, never billing. */
const INR_PER_USD = 84;

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
  manage: ManageSnapshot;
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
/** #1284 weekly return: the screens where an owner sees results and enquiries. */
export const RESULTS_PAGES = ["/dashboard", "/campaigns", "/leads"] as const;
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

/** #1543: what each scheduled run stores about Manage (count = active campaigns, failedCount = with no results). */
export type ManageSnapshot = { count: number; failedCount: number; worstMinutes: number; p90Minutes: number };
export type ScoreManageSnapshot = { created_at: string; attributes: Partial<ManageSnapshot> | null };

export function buildScoreboard(input: {
  events: ScoreEvent[];
  aiCalls: ScoreAiCall[];
  launches: ScoreLaunch[];
  /** Active campaigns now (#992): Manage scores how old their newest results are, not when someone last read them. */
  activeResults: ScoreActiveResult[];
  /** Users whose ads use free images (`freeImagesOnly`): internal accounts not exempt. */
  freeImageUserIds: string[];
  excludedUserIds: string[];
  /**
   * #1136: owners of the window's new businesses. Team accounts (`isInternalUser`) are left out of the Brand row,
   * and a new owner's clock starts at sign-up: setup collects the Brand before it creates the business.
   */
  brandOwners?: { id: string; signedUpAt: string | null; internal: boolean }[];
  excludedBusinessIds: string[];
  /** #1242: the north-star rows' own reads; without them those rows are left out. */
  northStar?: NorthStarData;
  /** #1697: the pilot funnel's facts (counts only). */
  pilots?: PilotData;
  /** #1543: earlier runs' Manage snapshots (`scoreboard.manage` events), so past days can be judged. */
  manageHistory?: ScoreManageSnapshot[];
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
    const owners = new Map((input.brandOwners ?? []).map((owner) => [owner.id, owner]));
    const allCreates = named("business.create");
    const creates = allCreates.filter((create) => !(create.user_id && owners.get(create.user_id)?.internal));
    const team = allCreates.length - creates.length;
    // #1136: minutes from sign-up (an owner who signed up in the 24 h before creating it) or else from creating the
    // business, to its first save with what Prepare needs (brand/usable.ts).
    const saves = [...creates, ...named("business.update")];
    const measured = saves.some((event) => typeof event.attributes?.brandUsable === "boolean");
    const minutes = creates.flatMap((create) => {
      const created = Date.parse(create.created_at);
      const signedUp = Date.parse(owners.get(create.user_id ?? "")?.signedUpAt ?? "");
      const start = signedUp <= created && created - signedUp <= 24 * 3_600_000 ? signedUp : created;
      const usable = saves.filter((save) => save.business_id === create.business_id && save.attributes?.brandUsable === true
        && Date.parse(save.created_at) >= created).map((save) => Date.parse(save.created_at));
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
      now: `${plural(creates.length, "new business", "new businesses")}${team ? ` (${team} team left out)` : ""}${usable}; autofill ${plural(autofill.length, "call")} (${failed} failed${slowest === null ? "" : `, p90 ${(slowest / 1000).toFixed(1)} s`})`,
      target: "sign-up to a usable business (name, category, area, phone, offer) in < 2 min on a phone",
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
    // #1468: the median estimated AI cost of a Create, from batches that recorded it.
    const costs = batches.map((event) => event.attributes?.costUsd).filter((usd): usd is number => typeof usd === "number").sort((a, b) => a - b);
    const median = costs.length ? costs[Math.floor((costs.length - 1) / 2)] : null;
    const cost = median === null ? "" : `; median $${median.toFixed(4)} (≈₹${(median * INR_PER_USD).toFixed(2)}) per Create`;
    rows.push({
      step,
      now: batches.length
        ? `${plural(batches.length, "batch", "batches")}: ${fmtPct(rate)} gave 3 ads; AI calls ${failedCalls}/${calls.length} failed; p90 ${seconds === null ? "n/a" : `${Math.round(seconds)} s`}${cost}`
        : "no batches",
      target: freePath ? "not a target: free images, internal only" : "≥ 95% of batches give 3 usable ads, p90 < 30 s",
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

  let manage: ManageSnapshot = { count: 0, failedCount: 0, worstMinutes: 0, p90Minutes: 0 };
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
    const ages = live.filter((campaign) => campaign.fetched_at !== null)
      .map((campaign) => Math.floor((input.until.getTime() - Date.parse(campaign.fetched_at as string)) / 60_000));
    manage = { count: live.length, failedCount: missing, worstMinutes: oldest, p90Minutes: Math.max(0, p90(ages) ?? 0) };
    if (input.manageHistory?.length) rows.push(manageTrendRow(input.manageHistory));
  }

  if (input.northStar) rows.push(...northStarRows(events, input.northStar));
  if (input.pilots) rows.push(...pilotRows(input.pilots));

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
  return { hours, since: input.since.toISOString(), until: input.until.toISOString(), excluded, rows, markdown, manage };
}

/** #1543: one cell per IST day from the stored snapshots, each day judged by its worst run. */
function manageTrendRow(history: ScoreManageSnapshot[]): ScoreRow {
  const days = new Map<string, ManageSnapshot>();
  for (const snapshot of history) {
    const a = snapshot.attributes ?? {};
    const value = { count: a.count ?? 0, failedCount: a.failedCount ?? 0, worstMinutes: a.worstMinutes ?? 0, p90Minutes: a.p90Minutes ?? 0 };
    const day = istDay(snapshot.created_at);
    const seen = days.get(day);
    const worse = !seen || value.failedCount > seen.failedCount || (value.failedCount === seen.failedCount && value.worstMinutes > seen.worstMinutes);
    if (worse) days.set(day, value);
  }
  const label = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const cells = [...days].sort(([a], [b]) => a.localeCompare(b)).map(([day, value]) => {
    if (!value.count) return { text: `${label(day)} none active`, met: null };
    const met = value.failedCount === 0 && value.worstMinutes <= 15;
    const what = value.failedCount ? `${value.failedCount} with no results` : `${value.worstMinutes} min`;
    return { text: `${label(day)} ${what} ${met ? "✅" : "❌"}`, met };
  });
  const measured = cells.filter((cell) => cell.met !== null);
  return {
    step: "Manage, 7 days",
    now: cells.map((cell) => cell.text).join(" · "),
    target: "every day ≤ 15 min (oldest results at the daily run)",
    met: measured.length ? measured.every((cell) => cell.met) : null,
  };
}

/** #1697: hand-over is recorded by the prospect runbook's last step (#1486, #1670) as this product event. */
export const PROSPECT_HANDED_OVER = "prospect.handed_over";

export type PilotData = {
  /** Businesses still owned by a `+prospect` account with at least one creative. */
  prospectBusinessIds: string[];
  /** Businesses with a `prospect.handed_over` event. */
  handedOverBusinessIds: string[];
  /** First `campaigns.launched_at` per business. */
  firstLaunch: Record<string, string>;
  /** Each business's latest `pilot_day7` answer (#1650). */
  day7Answers: Record<string, "yes" | "maybe" | "no">;
  /** #1965: form and logged WhatsApp enquiries (`created_at`), Meta test leads already out. */
  recentEnquiries: { business_id: string; created_at: string }[];
  excludedBusinessIds: string[];
  now: Date;
};

/** #1697: builds PilotData from the raw reads the route and the local script both make. */
export function pilotData({ prospectCreatives, pilotEvents, launchedRows, leads, excludedBusinessIds, now }: {
  prospectCreatives: { business_id: string }[];
  pilotEvents: { business_id: string | null; name: string; attributes: { answer?: string } | null; created_at: string }[];
  launchedRows: { business_id: string; launched_at: string }[];
  /** `meta_form` and `whatsapp_manual` leads from at least the last 24 h. */
  leads: { business_id: string; created_at: string; full_name?: string | null }[];
  excludedBusinessIds: string[];
  now: Date;
}): PilotData {
  const firstLaunch: Record<string, string> = {};
  for (const row of launchedRows) if (!firstLaunch[row.business_id] || row.launched_at < firstLaunch[row.business_id]) firstLaunch[row.business_id] = row.launched_at;
  const day7Answers: PilotData["day7Answers"] = {};
  for (const event of [...pilotEvents].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const answer = event.attributes?.answer;
    if (event.name === "pilot_day7" && event.business_id && (answer === "yes" || answer === "maybe" || answer === "no")) day7Answers[event.business_id] = answer;
  }
  return {
    prospectBusinessIds: [...new Set(prospectCreatives.map((row) => row.business_id))],
    handedOverBusinessIds: [...new Set(pilotEvents.filter((event) => event.name === PROSPECT_HANDED_OVER && event.business_id).map((event) => event.business_id as string))],
    firstLaunch, day7Answers, excludedBusinessIds, now,
    recentEnquiries: leads.filter((lead) => !isMetaTestLead({ full_name: lead.full_name ?? null })).map(({ business_id, created_at }) => ({ business_id, created_at })),
  };
}

/**
 * #1697 (CPO #1685): the pilot funnel, counts only and cumulative: prepared (still with the rep, or handed over) →
 * handed over → live (a handed-over business with a Go live) → Day 7 → its answers; plus how many reach Day 7 in
 * the next 48 h so the rep can book the visit, and (#1965) real enquiries on live pilots in the last 24 h. No names;
 * nothing until the first pilot.
 */
export function pilotRows(data: PilotData): ScoreRow[] {
  const excluded = new Set(data.excludedBusinessIds);
  const handedOver = new Set(data.handedOverBusinessIds.filter((id) => !excluded.has(id)));
  const prepared = new Set([...data.prospectBusinessIds.filter((id) => !excluded.has(id)), ...handedOver]);
  if (!prepared.size) return [];
  const live = [...handedOver].filter((id) => data.firstLaunch[id]);
  const age = (id: string) => data.now.getTime() - Date.parse(data.firstLaunch[id]);
  const day7 = live.filter((id) => age(id) >= 7 * DAY);
  const due = live.filter((id) => age(id) < 7 * DAY && age(id) >= 5 * DAY).length;
  const answers = { yes: 0, maybe: 0, no: 0 };
  for (const id of day7) { const answer = data.day7Answers[id]; if (answer) answers[answer] += 1; }
  const liveIds = new Set(live);
  const enquiries = data.recentEnquiries.filter((lead) => liveIds.has(lead.business_id) && data.now.getTime() - Date.parse(lead.created_at) < DAY).length;
  return [
    {
      step: "Pilots",
      now: `${prepared.size} prepared → ${handedOver.size} handed over → ${live.length} live → ${day7.length} at Day 7 (answers: yes ${answers.yes}, maybe ${answers.maybe}, no ${answers.no})`,
      target: "3 pilots live (#1315)",
      met: null,
    },
    { step: "Pilots: Day 7 due in 48 h", now: String(due), target: "book the Day 7 visit", met: null },
    { step: "Pilots: enquiries in 24 h", now: String(enquiries), target: "real enquiries on live pilots", met: null },
  ];
}

const IST_MS = 5.5 * 3_600_000;
const DAY = 86_400_000;
const istDay = (iso: string) => new Date(Date.parse(iso) + IST_MS).toISOString().slice(0, 10);

/** The last complete Monday 00:00 – Sunday 23:59 IST week before `now`, as instants. */
export function lastIstWeek(now: Date): { start: number; end: number } {
  const ist = now.getTime() + IST_MS;
  const midnight = Math.floor(ist / DAY) * DAY;
  const weekday = (new Date(midnight).getUTCDay() + 6) % 7; // Monday = 0
  const thisMonday = midnight - weekday * DAY - IST_MS;
  return { start: thisMonday - 7 * DAY, end: thisMonday };
}

/** #1242 / #1284: what the north-star rows read beyond the window's events (the script and cron fetch it). */
export type NorthStarData = {
  /** Accounts (`auth.users`) created since the last full week began; internal ones are filtered here. */
  signUps: Array<{ id: string; created_at: string }>;
  businesses: Array<{ id: string; owner_id: string }>;
  /** `audit_log` campaign.resume / campaign.pause / spend.auto_paused rows (entity_id = campaign), oldest first. */
  campaignChanges: Array<{ campaign_id: string; business_id: string; action: string; created_at: string }>;
  /** Current status, for campaigns with no change on record (synced or older ones). */
  campaigns: Array<{ id: string; business_id: string; status: string }>;
  /** `page.view` rows on the results pages during the last full week. */
  pageViews: Array<{ user_id: string; route: string; created_at: string }>;
  /** `ui.action` taps on Help on WhatsApp (`help.whatsapp`) since the cohort week began. */
  helpTaps: Array<{ user_id: string; created_at: string }>;
  /** Leads created in the trailing 7 days (forms and logged WhatsApp chats), Meta test leads and internal businesses left out. */
  leads: Array<{ created_time: string | null; created_at: string; first_contacted_at: string | null }>;
  internalUserIds: string[];
  now: Date;
};

const shortDate = (at: number) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(at);
const duration = (minutes: number) => minutes < 120 ? `${Math.round(minutes)} min` : minutes < 2 * 24 * 60 ? `${(minutes / 60).toFixed(1)} h` : `${(minutes / 1440).toFixed(1)} days`;

/**
 * #1242: #1226's north-star rows, exactly as the CPO defined them on #1284 (QA 2 mapped them to columns). Owners only:
 * internal, demo and smoke accounts and their businesses are left out. Weeks run Monday–Sunday IST.
 */
export function northStarRows(events: ScoreEvent[], data: NorthStarData): ScoreRow[] {
  const internal = new Set(data.internalUserIds);
  const businesses = data.businesses.filter((business) => !internal.has(business.owner_id));
  const ownerOf = new Map(businesses.map((business) => [business.id, business.owner_id]));
  const week = lastIstWeek(data.now);
  const rows: ScoreRow[] = [];
  const firstLive = new Map<string, number>();
  for (const change of data.campaignChanges) {
    const owner = ownerOf.get(change.business_id);
    if (owner && change.action === "campaign.resume" && !firstLive.has(owner)) firstLive.set(owner, Date.parse(change.created_at));
  }
  const cohort = data.signUps.filter((user) => !internal.has(user.id) && Date.parse(user.created_at) >= week.start && Date.parse(user.created_at) < week.end);
  const label = `week of ${shortDate(week.start)}`;
  const matures = week.end + 14 * DAY;

  {
    // A campaign is created paused, so the owner's first resume is the activation; counted up to 14 days after sign-up.
    const minutes = cohort.flatMap((user) => {
      const start = Date.parse(user.created_at);
      const live = firstLive.get(user.id);
      return live !== undefined && live >= start && live - start <= 14 * DAY ? [(live - start) / 60_000] : [];
    });
    const middle = median(minutes);
    rows.push({
      step: "Sign-up → first campaign live",
      now: cohort.length
        ? `${label}: ${plural(cohort.length, "sign-up")}, ${fmtPct(Math.round(percent(minutes.length, cohort.length)))} live${middle === null ? "" : `, median ${duration(middle)}`}${data.now.getTime() < matures ? ` (counting until ${shortDate(matures - 1)})` : ""}`
        : `${label}: no sign-ups`,
      target: "median ≤ 10 min (#1226)",
      met: middle === null ? null : middle <= 10,
    });
  }

  {
    const owned = events.filter((event) => event.user_id && !internal.has(event.user_id)).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    const by = (user: string, test: (event: ScoreEvent) => boolean) => owned.filter((event) => event.user_id === user && test(event));
    const users = [...new Set(owned.filter((event) => event.name === "creative.batch").map((event) => event.user_id!))];
    const measured = owned.some((event) => event.name === "ui.tap");
    const taps = users.flatMap((user) => {
      const batch = by(user, (event) => event.name === "creative.batch")[0];
      const start = by(user, (event) => event.name === "page.view" && event.attributes?.route === "/create"
        && Date.parse(event.created_at) <= Date.parse(batch.created_at)).at(-1) ?? batch;
      const end = by(user, (event) => event.name === "campaign.resume" && event.outcome === "success" && Date.parse(event.created_at) >= Date.parse(batch.created_at))[0];
      if (!end) return [];
      return [by(user, (event) => event.name === "ui.tap" && event.created_at >= start.created_at && event.created_at <= end.created_at).length];
    });
    const middle = median(taps);
    rows.push({
      step: "Taps, Create → live",
      now: !measured ? "not measured yet (`ui.tap` events start with #1242; QA's release walk meanwhile)"
        : taps.length ? `${plural(taps.length, "owner")} reached live: median ${Math.round(middle!)} taps` : `no owner reached live (${plural(users.length, "owner")} made ads)`,
      target: "≤ 12 taps (#1226)",
      met: measured && middle !== null ? middle <= 12 : null,
    });
  }

  {
    // Setup calls logged on #796 aren't in the data; this row counts the in-app help taps only.
    const helped = cohort.filter((user) => {
      const live = firstLive.get(user.id) ?? Infinity;
      return data.helpTaps.some((tap) => tap.user_id === user.id && Date.parse(tap.created_at) < live);
    }).length;
    rows.push({
      step: "Owners needing help",
      now: cohort.length ? `${label}: ${helped} of ${plural(cohort.length, "new owner")} tapped Help on WhatsApp before going live (#796 calls not counted)` : `${label}: no new owners`,
      target: "≤ 1 in 3 pilots (#1226)",
      met: cohort.length ? helped * 3 <= cohort.length : null,
    });
  }

  {
    const contacted = data.leads.filter((lead) => lead.first_contacted_at).length;
    const middle = medianReplyMinutes(data.leads);
    rows.push({
      step: "Time to first contact",
      now: data.leads.length
        ? `${plural(data.leads.length, "enquiry", "enquiries")} in 7 days: ${fmtPct(Math.round(percent(contacted, data.leads.length)))} contacted${middle === null ? "" : `, median ${duration(middle)}`}`
        : "no enquiries in 7 days",
      target: "median ≤ 15 min (#1226)",
      met: middle === null ? null : middle <= 15,
    });
  }

  {
    // Active at any point in the week: active when it began (its last change before then was a resume, or no change on
    // record and it's active now), or resumed during it.
    const changesOf = new Map<string, typeof data.campaignChanges>();
    for (const change of data.campaignChanges) changesOf.set(change.campaign_id, [...(changesOf.get(change.campaign_id) ?? []), change]);
    const activeOwners = new Set(data.campaigns.filter((campaign) => {
      const changes = changesOf.get(campaign.id) ?? [];
      if (!changes.length) return campaign.status === "active";
      const before = changes.filter((change) => Date.parse(change.created_at) < week.start).at(-1);
      const during = changes.some((change) => change.action === "campaign.resume" && Date.parse(change.created_at) >= week.start && Date.parse(change.created_at) < week.end);
      return before?.action === "campaign.resume" || during;
    }).map((campaign) => ownerOf.get(campaign.business_id)).filter((owner): owner is string => Boolean(owner)));
    const days = [...activeOwners].map((owner) => new Set(data.pageViews.filter((view) => view.user_id === owner
      && (RESULTS_PAGES as readonly string[]).includes(view.route)
      && Date.parse(view.created_at) >= week.start && Date.parse(view.created_at) < week.end).map((view) => istDay(view.created_at))).size);
    const middle = median(days);
    rows.push({
      step: "Weekly return (results views)",
      now: activeOwners.size ? `${label}: ${plural(activeOwners.size, "owner")} with a live campaign: median ${middle} ${middle === 1 ? "day" : "days"}` : `${label}: no owner outside the team had a live campaign`,
      target: "≥ 3 days a week (#1226)",
      met: middle === null ? null : middle >= 3,
    });
  }
  return rows;
}
