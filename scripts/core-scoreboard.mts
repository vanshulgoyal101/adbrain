// Core scoreboard (#681), read-only: each core step's number against its Nov 2 target, smoke excluded.
//   npm run core-scoreboard [-- --hours 24] [-- --post]
// Same numbers as GET /api/cron/core-scoreboard (src/lib/observability/core-scoreboard.ts), read
// through the Supabase Management API like `npm run stats`. --post comments the table on #681.
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import internal from "../src/lib/internal-accounts.json" with { type: "json" };
import {
  buildScoreboard,
  SCOREBOARD_AI_ROUTES,
  SCOREBOARD_EVENT_NAMES,
  SCOREBOARD_PLAN_ROUTE,
  type ScoreAiCall,
  type ScoreEvent,
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

const [owned, events, aiCalls] = await Promise.all([
  readOnlyQuery(`select id from public.businesses where owner_id in (${list(smoke)})`),
  readOnlyQuery(`select name, outcome, user_id, business_id, duration_ms, attributes,
  ${iso} from public.product_events
where ${inWindow} and (name in (${list(SCOREBOARD_EVENT_NAMES)}) or (name = 'http.request' and attributes->>'route' = ${quote(SCOREBOARD_PLAN_ROUTE)}))`),
  readOnlyQuery(`select route, status, user_id, business_id, request_id, latency_ms, provider, usage_kind,
  ${iso} from public.llm_usage_events
where ${inWindow} and route in (${list(SCOREBOARD_AI_ROUTES)})`),
]);

const board = buildScoreboard({
  events: events as ScoreEvent[],
  aiCalls: aiCalls as ScoreAiCall[],
  excludedUserIds: smoke,
  excludedBusinessIds: (owned as Array<{ id: string }>).map((row) => row.id),
  since,
  until,
});
console.log(board.markdown);
if (values.post) {
  execFileSync("gh", ["issue", "comment", ISSUE, "-R", "vanshulgoyal101/adbrain", "--body", `<!-- core-scoreboard -->\nDevOps: ${board.markdown}`], { stdio: "inherit" });
}
