// UX scoreboard (#1226 workstream 8), read-only: each north-star UX metric against its Nov 30 target.
//   npm run ux-scoreboard [-- --days 28] [-- --include-internal] [-- --post]
// Read through the Supabase Management API like `npm run core-scoreboard`; --post comments the table on #1226.
// Smoke users are always left out; internal accounts too unless --include-internal.
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import internal from "../src/lib/internal-accounts.json" with { type: "json" };
import { isInternalUser } from "../src/lib/internal-accounts";
import { META_TEST_LEAD_PATTERN } from "../src/lib/leads/test-lead";
import { buildUxScoreboard, UX_RETURN_ROUTES, type UxLead, type UxPageView } from "../src/lib/observability/ux-scoreboard";
import { readOnlyQuery } from "./lib/prod-query.mjs";

const ISSUE = "1226";
const { values } = parseArgs({ options: {
  days: { type: "string", default: "28" }, "include-internal": { type: "boolean", default: false }, post: { type: "boolean", default: false },
} });
const signupDays = Number(values.days);
if (!Number.isInteger(signupDays) || signupDays < 1 || signupDays > 90) throw new Error("--days must be a whole number from 1 to 90.");

const until = new Date();
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const iso = (column: string) => `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const weekSince = quote(new Date(until.getTime() - 7 * 86_400_000).toISOString());

type Identity = { id: string; email: string | null; email_confirmed_at: string | null; created_at: string };
const [users, firstLive, live, leads, views] = await Promise.all([
  readOnlyQuery(`select id, email, email_confirmed_at, ${iso("created_at")} as created_at from auth.users`),
  readOnlyQuery(`select b.owner_id, ${iso("min(c.launched_at)")} as first_live_at from public.campaigns c
join public.businesses b on b.id = c.business_id where c.launched_at is not null group by b.owner_id`),
  readOnlyQuery(`select distinct b.owner_id from public.campaigns c join public.businesses b on b.id = c.business_id
where c.status = 'active' and c.meta_campaign_id is not null`),
  readOnlyQuery(`select b.owner_id, coalesce(l.full_name ilike ${quote(META_TEST_LEAD_PATTERN)}, false) as test,
  ${iso("l.created_time")} as created_time, ${iso("l.created_at")} as created_at, ${iso("l.first_contacted_at")} as first_contacted_at
from public.leads l join public.businesses b on b.id = l.business_id where l.first_contacted_at >= ${weekSince}`),
  readOnlyQuery(`select user_id, attributes->>'route' as route, ${iso("created_at")} as created_at from public.product_events
where name = 'page.view' and created_at >= ${weekSince} and user_id is not null
  and attributes->>'route' in (${UX_RETURN_ROUTES.map(quote).join(", ")})`),
]);

const includeInternal = values["include-internal"];
const kept = new Set((users as Identity[])
  .filter((user) => !internal.smokeUserIds.includes(user.id) && (includeInternal || !isInternalUser(user)))
  .map((user) => user.id));
const liveAt = new Map((firstLive as Array<{ owner_id: string; first_live_at: string }>).map((row) => [row.owner_id, row.first_live_at]));

const board = buildUxScoreboard({
  owners: (users as Identity[]).filter((user) => kept.has(user.id))
    .map((user) => ({ id: user.id, created_at: user.created_at, first_live_at: liveAt.get(user.id) ?? null })),
  liveOwnerIds: (live as Array<{ owner_id: string }>).map((row) => row.owner_id).filter((id) => kept.has(id)),
  leads: (leads as UxLead[]).filter((lead) => kept.has(lead.owner_id)),
  pageViews: (views as UxPageView[]).filter((view) => kept.has(view.user_id)),
  signupDays,
  until,
  includeInternal,
});
console.log(board.markdown);
if (values.post) {
  execFileSync("gh", ["issue", "comment", ISSUE, "-R", "vanshulgoyal101/adbrain", "--body", `QA 2: ${board.markdown}`], { stdio: "inherit" });
}
