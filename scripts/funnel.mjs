// Activation funnel (#338): where each sign-up of the last N days stopped. Read-only: one
// statement through the Supabase Management API inside BEGIN READ ONLY (docs/ORCHESTRATION.md
// "Access"). Prints user-id prefixes only, never emails or names, and leaves out internal
// accounts (scripts/lib/internal-accounts.mjs).
// Usage: node scripts/funnel.mjs [--days 14] [--include-internal]
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { isInternalUserSql, localInternalEmails } from "./lib/internal-accounts.mjs";
import { readOnlyQuery } from "./lib/prod-query.mjs";


export const STEPS = [
  ["signed_up", "Signed up"],
  ["brand", "Brand saved"],
  ["ad", "First ad generated"],
  ["approved", "Ad approved"],
  ["campaigns", "Campaigns opened"],
  ["connect_clicked", "Asked to connect Meta"],
  ["meta_connected", "Meta connected"],
  ["paid", "Top-up paid"],
  ["campaign", "Campaign created"],
  ["lead", "First lead/chat"],
];

export function funnelSql(days, internalEmails, { includeInternal = false } = {}) {
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("--days must be a whole number from 1 to 365.");
  const internalFilter = includeInternal ? "" : `
    and not ${isInternalUserSql("users", internalEmails)}`;
  // Durable tables first; product_events (pruned over time) only for page views, clicks and last seen.
  return `with u as (
  select id, created_at from auth.users users
  where created_at > now() - make_interval(days => ${days})${internalFilter}
), b as (
  select owner_id as user_id, id as business_id from public.businesses where owner_id in (select id from u)
), e as (
  select user_id, max(created_at) as last_seen,
    bool_or(name = 'page.view' and attributes->>'route' = '/campaigns') as campaigns,
    -- Connect Meta, or (before Meta App Review) "Ask for Facebook access" on Campaigns (#336).
    bool_or((name = 'http.request' and attributes->>'route' = '/api/meta/oauth/start')
      or (name = 'ui.action' and (attributes->>'action' like 'meta.connect%' or attributes->>'action' = 'meta.access_request'))) as connect_clicked,
    bool_or(name = 'creative.approve') as approved
  from public.product_events where user_id in (select id from u) group by user_id
), s as (
  select u.id, u.created_at, e.last_seen,
    exists(select 1 from b where b.user_id = u.id) as brand,
    exists(select 1 from b join public.creatives c using (business_id) where b.user_id = u.id) as ad,
    coalesce(e.approved, false)
      or exists(select 1 from b join public.creatives c using (business_id) where b.user_id = u.id and c.status = 'approved') as approved,
    coalesce(e.campaigns, false)
      or exists(select 1 from b join public.campaign_drafts d using (business_id) where b.user_id = u.id) as campaigns,
    coalesce(e.connect_clicked, false) as connect_clicked,
    exists(select 1 from b join public.meta_connections m using (business_id) where b.user_id = u.id and m.authorization_status = 'connected') as meta_connected,
    exists(select 1 from private.production_payment_orders p where p.environment = 'live' and p.captured_paise > 0
      and (p.user_id = u.id or p.business_id in (select business_id from b where b.user_id = u.id))) as paid,
    exists(select 1 from b join public.campaigns c using (business_id) where b.user_id = u.id and c.meta_campaign_id is not null) as campaign,
    exists(select 1 from b join public.leads l using (business_id) where b.user_id = u.id)
      or exists(select 1 from b join public.campaigns c using (business_id) join public.campaign_results r on r.campaign_id = c.id
        where b.user_id = u.id and coalesce(r.conversations, 0) > 0) as lead
  from u left join e on e.user_id = u.id
)
select left(id::text, 8) as "user", created_at as signed_up_at, last_seen, brand, ad, approved, campaigns,
  connect_clicked or meta_connected as connect_clicked, meta_connected, paid, campaign, lead
from s order by created_at`;
}

export function summarize(rows) {
  const users = rows.map((row) => {
    const reached = STEPS.map(([key], index) => index === 0 || row[key] === true);
    return { user: row.user, signedUp: row.signed_up_at, lastSeen: row.last_seen, reached, lastStep: STEPS[reached.lastIndexOf(true)][1] };
  });
  return { users, totals: STEPS.map(([, label], index) => [label, users.filter(({ reached }) => reached[index]).length]) };
}

const minute = (time) => (time ? String(time).replace("T", " ").slice(0, 16) : "-");

export function render({ users, totals }, days, { includeInternal = false } = {}) {
  const lines = [`Sign-ups in the last ${days} days: ${users.length} (times UTC${includeInternal ? "; internal accounts included" : ""})`, ""];
  if (users.length) {
    lines.push(`${"user".padEnd(10)}${"signed up".padEnd(18)}${"last step".padEnd(24)}${"last seen".padEnd(18)}steps`);
    for (const user of users) {
      lines.push(`${user.user.padEnd(10)}${minute(user.signedUp).padEnd(18)}${user.lastStep.padEnd(24)}${minute(user.lastSeen).padEnd(18)}${user.reached.map((done) => (done ? "✓" : "·")).join("")}`);
    }
    lines.push("");
  }
  lines.push("Reached each step:");
  for (const [label, count] of totals) lines.push(`  ${label.padEnd(24)}${count}`);
  lines.push("", `Steps: ${STEPS.map(([, label], index) => `${index + 1} ${label}`).join(" → ")}`);
  return lines.join("\n");
}

async function main() {
  const { values } = parseArgs({ options: { days: { type: "string", default: "14" }, "include-internal": { type: "boolean", default: false } } });
  const includeInternal = values["include-internal"];
  const days = Number(values.days);
  const rows = await readOnlyQuery(funnelSql(days, await localInternalEmails(), { includeInternal }));
  console.log(render(summarize(rows), days, { includeInternal }));
  if (!includeInternal) console.log("Internal accounts (scripts/lib/internal-accounts.mjs) are excluded; add --include-internal to see them.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Funnel query failed.");
    process.exitCode = 1;
  });
}
