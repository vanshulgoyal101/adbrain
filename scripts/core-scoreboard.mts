// Core scoreboard (#681), read-only: each core step's number against its Nov 2 target, smoke excluded.
//   npm run core-scoreboard [-- --hours 24] [-- --post]
// Same numbers as GET /api/cron/core-scoreboard (src/lib/observability/core-scoreboard.ts), read
// through the Supabase Management API like `npm run stats`. --post comments the table on #681.
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import internal from "../src/lib/internal-accounts.json" with { type: "json" };
import { isExemptFromFreeProviders, isInternalUser, isProspectAccount, isScoreboardExcluded } from "../src/lib/internal-accounts";
import {
  buildScoreboard,
  lastIstWeek,
  RESULTS_PAGES,
  SCOREBOARD_AI_ROUTES,
  SCOREBOARD_EVENT_NAMES,
  SCOREBOARD_PLAN_ROUTE,
  type NorthStarData,
  type ScoreActiveResult,
  type ScoreAiCall,
  type ScoreEvent,
  type ScoreLaunch,
  pilotData,
  PROSPECT_HANDED_OVER,
  type ScoreManageSnapshot,
} from "../src/lib/observability/core-scoreboard";
import { META_TEST_LEAD_PATTERN } from "../src/lib/leads/test-lead";
import { readOnlyQuery } from "./lib/prod-query.mjs";

const ISSUE = "681";
const { values } = parseArgs({ options: { hours: { type: "string", default: "24" }, post: { type: "boolean", default: false } } });
const hours = Number(values.hours);
if (!Number.isInteger(hours) || hours < 1 || hours > 168) throw new Error("--hours must be a whole number from 1 to 168.");

const until = new Date();
const since = new Date(until.getTime() - hours * 3_600_000);
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const list = (items: readonly string[]) => items.map(quote).join(", ");
const inWindow = `created_at >= ${quote(since.toISOString())} and created_at <= ${quote(until.toISOString())}`;
const smoke = internal.smokeUserIds;
const iso = (column = "created_at") => `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as ${column}`;
// #1242 / #1284: the north-star rows read the last full IST week and the trailing 7 days.
const week = lastIstWeek(until);
const weekStart = quote(new Date(week.start).toISOString());
const weekEnd = quote(new Date(week.end).toISOString());
const sevenDays = quote(new Date(until.getTime() - 7 * 86_400_000).toISOString());

const [owned, events, aiCalls, launches, users, active, businesses, changes, campaigns, pageViews, helpTaps, leads, manageHistory] = await Promise.all([
  readOnlyQuery(`select id from public.businesses where owner_id in (${list(smoke)})`),
  readOnlyQuery(`select name, outcome, user_id, business_id, duration_ms, attributes,
  ${iso()} from public.product_events
where ${inWindow} and (name in (${list(SCOREBOARD_EVENT_NAMES)}) or (name = 'http.request' and attributes->>'route' = ${quote(SCOREBOARD_PLAN_ROUTE)}))`),
  readOnlyQuery(`select route, status, user_id, business_id, request_id, latency_ms,
  ${iso()} from public.llm_usage_events
where ${inWindow} and route in (${list(SCOREBOARD_AI_ROUTES)})`),
  readOnlyQuery(`select business_id, state, ${iso()} from public.campaign_operations where ${inWindow} and kind = 'campaign_create'`),
  // Every account: internal ones (free images, #1242's exclusions) and the week's sign-ups.
  readOnlyQuery(`select id, email, email_confirmed_at, ${iso()} from auth.users`),
  // #992: newest results per active, Meta-bound campaign (the ones refresh-results keeps fresh).
  readOnlyQuery(`select c.business_id, (select to_char(max(r.fetched_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  from public.campaign_results r where r.campaign_id = c.id and r.fetched_at >= ${quote(since.toISOString())}) as fetched_at
from public.campaigns c where c.status = 'active' and c.meta_campaign_id is not null`),
  readOnlyQuery(`select id, owner_id from public.businesses`),
  readOnlyQuery(`select entity_id as campaign_id, business_id, action, ${iso()} from public.audit_log
where entity_type = 'campaign' and action in ('campaign.resume', 'campaign.pause', 'spend.auto_paused') and entity_id is not null order by created_at`),
  readOnlyQuery(`select id, business_id, status from public.campaigns`),
  readOnlyQuery(`select user_id, attributes->>'route' as route, ${iso()} from public.product_events
where name = 'page.view' and user_id is not null and created_at >= ${weekStart} and created_at < ${weekEnd} and attributes->>'route' in (${list(RESULTS_PAGES)})`),
  readOnlyQuery(`select user_id, ${iso()} from public.product_events
where name = 'ui.action' and attributes->>'action' = 'help.whatsapp' and user_id is not null and created_at >= ${weekStart}`),
  readOnlyQuery(`select business_id, ${iso("created_time")}, ${iso()}, ${iso("first_contacted_at")} from public.leads
where created_at >= ${sevenDays} and source in ('meta_form', 'whatsapp_manual') and coalesce(full_name, '') not ilike ${quote(META_TEST_LEAD_PATTERN)}`),
  // #1543: the scheduled runs' Manage snapshots, for the 7-day row.
  readOnlyQuery(`select ${iso()}, attributes from public.product_events where name = 'scoreboard.manage' and created_at >= ${sevenDays}`),
]);
type Identity = { id: string; email: string | null; email_confirmed_at: string | null; created_at: string };
const identities = users as Identity[];
const internalUserIds = identities.filter((user) => isInternalUser(user)).map((user) => user.id);
const owners = businesses as Array<{ id: string; owner_id: string }>;
const internalBusinesses = new Set(owners.filter((business) => internalUserIds.includes(business.owner_id) || smoke.includes(business.owner_id)).map((business) => business.id));
const northStar: NorthStarData = {
  signUps: identities.filter((user) => Date.parse(user.created_at) >= week.start).map(({ id, created_at }) => ({ id, created_at })),
  businesses: owners,
  campaignChanges: changes as NorthStarData["campaignChanges"],
  campaigns: campaigns as NorthStarData["campaigns"],
  pageViews: pageViews as NorthStarData["pageViews"],
  helpTaps: helpTaps as NorthStarData["helpTaps"],
  leads: (leads as Array<NorthStarData["leads"][number] & { business_id: string }>).filter((lead) => !internalBusinesses.has(lead.business_id)),
  internalUserIds: [...internalUserIds, ...smoke],
  now: until,
};
// #1136: the Brand row's owners (who created a business in the window): sign-up time, and whether they're the team.
const createUserIds = new Set((events as ScoreEvent[]).filter((event) => event.name === "business.create" && event.user_id)
  .map((event) => event.user_id as string));
const brandOwners = identities.filter((user) => createUserIds.has(user.id))
  .map((owner) => ({ id: owner.id, signedUpAt: owner.created_at, internal: isInternalUser(owner) }));

// #1697: the pilot funnel (counts only), read the same way as the route.
const prospectOwners = new Set(identities.filter((user) => isProspectAccount(user)).map((user) => user.id));
const prospectOwned = owners.filter((business) => prospectOwners.has(business.owner_id)).map((business) => business.id);
const [prospectCreatives, pilotEvents, launchedRows] = await Promise.all([
  prospectOwned.length ? readOnlyQuery(`select distinct business_id from public.creatives where business_id in (${list(prospectOwned)})`) : [],
  readOnlyQuery(`select business_id, name, attributes, ${iso()} from public.product_events where name in (${list([PROSPECT_HANDED_OVER, "pilot_day7"])})`),
  readOnlyQuery(`select business_id, ${iso("launched_at")} from public.campaigns where launched_at is not null`),
]);
const pilots = pilotData({
  prospectCreatives: prospectCreatives as { business_id: string }[],
  pilotEvents: pilotEvents as Parameters<typeof pilotData>[0]["pilotEvents"],
  launchedRows: launchedRows as { business_id: string; launched_at: string }[],
  excludedBusinessIds: (owned as Array<{ id: string }>).map((row) => row.id),
  now: until,
});
const board = buildScoreboard({
  events: events as ScoreEvent[],
  aiCalls: aiCalls as ScoreAiCall[],
  launches: launches as ScoreLaunch[],
  activeResults: active as ScoreActiveResult[],
  freeImageUserIds: identities.filter((user) => isInternalUser(user) && !isExemptFromFreeProviders(user)).map((user) => user.id),
  // #1467: smoke, the demo workspace and sales prospects are left out of every row.
  excludedUserIds: [...smoke, ...identities.filter((user) => isScoreboardExcluded(user, process.env.DEMO_USER_EMAIL ?? "demo@adbrain.vanshul.com")).map((user) => user.id)],
  brandOwners,
  excludedBusinessIds: (owned as Array<{ id: string }>).map((row) => row.id),
  northStar,
  pilots,
  manageHistory: manageHistory as ScoreManageSnapshot[],
  since,
  until,
});
console.log(board.markdown);
if (values.post) {
  execFileSync("gh", ["issue", "comment", ISSUE, "-R", "vanshulgoyal101/adbrain", "--body", `<!-- core-scoreboard -->\nDevOps: ${board.markdown}`], { stdio: "inherit" });
}
