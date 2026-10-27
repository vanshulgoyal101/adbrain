// Core scoreboard (#681), read-only: each core step's number against its Nov 2 target, smoke excluded.
//   npm run core-scoreboard [-- --hours 24] [-- --post]
// Same numbers as GET /api/cron/core-scoreboard (src/lib/observability/core-scoreboard.ts), read
// through the Supabase Management API like `npm run stats`. --post comments the table on #681.
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import internal from "../src/lib/internal-accounts.json" with { type: "json" };
import { isExemptFromFreeProviders, isInternalUser } from "../src/lib/internal-accounts";
import {
  buildScoreboard,
  SCOREBOARD_AI_ROUTES,
  SCOREBOARD_EVENT_NAMES,
  SCOREBOARD_PLAN_ROUTE,
  type ScoreActiveResult,
  type ScoreAiCall,
  type ScoreEvent,
  type ScoreLaunch,
} from "../src/lib/observability/core-scoreboard";
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
const iso = `to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at`;

const [owned, events, aiCalls, launches, users, active] = await Promise.all([
  readOnlyQuery(`select id from public.businesses where owner_id in (${list(smoke)})`),
  readOnlyQuery(`select name, outcome, user_id, business_id, duration_ms, attributes,
  ${iso} from public.product_events
where ${inWindow} and (name in (${list(SCOREBOARD_EVENT_NAMES)}) or (name = 'http.request' and attributes->>'route' = ${quote(SCOREBOARD_PLAN_ROUTE)}))`),
  readOnlyQuery(`select route, status, user_id, business_id, request_id, latency_ms,
  ${iso} from public.llm_usage_events
where ${inWindow} and route in (${list(SCOREBOARD_AI_ROUTES)})`),
  readOnlyQuery(`select business_id, state, ${iso} from public.campaign_operations where ${inWindow} and kind = 'campaign_create'`),
  // Who made ads in the window, for the free-image split (same rule as spend-policy.ts `freeImagesOnly`).
  readOnlyQuery(`select u.id, u.email, u.email_confirmed_at from auth.users u where u.id in (
  select user_id from public.llm_usage_events where ${inWindow} and route = 'creatives.generate'
  union select user_id from public.product_events where ${inWindow} and name = 'creative.batch')`),
  // #992: newest results per active, Meta-bound campaign (the ones refresh-results keeps fresh).
  readOnlyQuery(`select c.business_id, (select to_char(max(r.fetched_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  from public.campaign_results r where r.campaign_id = c.id and r.fetched_at >= ${quote(since.toISOString())}) as fetched_at
from public.campaigns c where c.status = 'active' and c.meta_campaign_id is not null`),
]);
type Identity = { id: string; email: string | null; email_confirmed_at: string | null };

const board = buildScoreboard({
  events: events as ScoreEvent[],
  aiCalls: aiCalls as ScoreAiCall[],
  launches: launches as ScoreLaunch[],
  activeResults: active as ScoreActiveResult[],
  freeImageUserIds: (users as Identity[]).filter((user) => isInternalUser(user) && !isExemptFromFreeProviders(user)).map((user) => user.id),
  excludedUserIds: smoke,
  excludedBusinessIds: (owned as Array<{ id: string }>).map((row) => row.id),
  since,
  until,
});
console.log(board.markdown);
if (values.post) {
  execFileSync("gh", ["issue", "comment", ISSUE, "-R", "vanshulgoyal101/adbrain", "--body", `<!-- core-scoreboard -->\nDevOps: ${board.markdown}`], { stdio: "inherit" });
}
