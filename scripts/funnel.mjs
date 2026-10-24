// Activation funnel (#338): where each sign-up of the last N days stopped. Read-only: one
// statement through the Supabase Management API inside BEGIN READ ONLY (docs/ORCHESTRATION.md
// "Access"). Prints user-id prefixes only, never emails or names, and leaves out the smoke account.
// Usage: node scripts/funnel.mjs [--days 14] [--include-test]
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, parseEnv } from "node:util";

const projectId = "kmzuxrvfrwwpwmoovwcp";
const smokeEnvPath = "/Users/vanshulgoyal/Development/copilot/adbrain/.env.smoke";

/** Team and QA sign-ups; left out unless --include-test. */
export const TEST_DOMAINS = ["adbrain.vanshul.com", "adbrain.local"];

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

export function funnelSql(days, excludedEmails, { includeTest = false } = {}) {
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("--days must be a whole number from 1 to 365.");
  const quote = (value) => `'${value.trim().toLowerCase().replaceAll("'", "''")}'`;
  const testFilter = includeTest ? "" : `
    and lower(coalesce(email, '')) <> all(array[${excludedEmails.map(quote).join(",")}]::text[])
    and split_part(lower(coalesce(email, '')), '@', 2) <> all(array[${TEST_DOMAINS.map(quote).join(",")}]::text[])`;
  // Durable tables first; product_events (pruned over time) only for page views, clicks and last seen.
  return `with u as (
  select id, created_at from auth.users
  where created_at > now() - make_interval(days => ${days})${testFilter}
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

export function render({ users, totals }, days, { includeTest = false } = {}) {
  const lines = [`Sign-ups in the last ${days} days: ${users.length} (times UTC${includeTest ? "; test accounts included" : ""})`, ""];
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

async function query(sql) {
  const env = parseEnv(await readFile(join(homedir(), "Development/copilot/arcade/.env"), "utf8"));
  if (!env.SUPABASE_TOKEN) throw new Error("Supabase Management token is unavailable.");
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectId}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: `BEGIN READ ONLY;\n${sql};\nCOMMIT;`, read_only: true }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Read-only query failed (HTTP ${response.status}).`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error("Unexpected database response.");
  return rows;
}

async function main() {
  const { values } = parseArgs({ options: { days: { type: "string", default: "14" }, "include-test": { type: "boolean", default: false } } });
  const includeTest = values["include-test"];
  const excluded = [];
  try {
    const smoke = parseEnv(await readFile(smokeEnvPath, "utf8")).SMOKE_EMAIL;
    if (smoke) excluded.push(smoke);
  } catch {
    // Reported below.
  }
  const days = Number(values.days);
  const rows = await query(funnelSql(days, excluded, { includeTest }));
  console.log(render(summarize(rows), days, { includeTest }));
  if (!includeTest) console.log(`Test accounts (@${TEST_DOMAINS.join(", @")}${excluded.length ? " and the smoke account" : ""}) are excluded; add --include-test to see them.${excluded.length ? "" : " Note: .env.smoke is missing."}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Funnel query failed.");
    process.exitCode = 1;
  });
}
