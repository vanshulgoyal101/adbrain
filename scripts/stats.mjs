// What happened on the platform, in one command (#451). Read-only.
//   npm run stats [-- --days 7] [-- --include-internal]
// Real customers only by default (scripts/lib/internal-accounts.mjs). Sources: llm_usage_events
// (every AI call: model, tokens, estimated USD) and product_events (requests, workflows, failures).
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { funnelSql, summarize } from "./funnel.mjs";
import { customerFilterSql, localInternalEmails } from "./lib/internal-accounts.mjs";
import { readOnlyQuery } from "./lib/prod-query.mjs";

export const SECTIONS = [
  { key: "ai_by_model", title: "AI calls, tokens and estimated cost by model" },
  { key: "create_runs", title: "Create runs (one generate request = one run)" },
  { key: "business_days", title: "AI cost per business per day (top 10)" },
  { key: "failures", title: "Failures by step (AI calls, server errors, workflows)" },
  { key: "speed", title: "Speed of the busiest routes (successful requests, ms)" },
  { key: "funnel", title: "Sign-up funnel (reached each step)" },
];

export function sectionSql(key, days, emails, { includeInternal = false } = {}) {
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("--days must be a whole number from 1 to 365.");
  const since = `created_at > now() - make_interval(days => ${days})`;
  const customers = (alias) => (includeInternal ? "true" : customerFilterSql(`${alias}.user_id`, `${alias}.business_id`, emails));
  const ai = `select * from public.llm_usage_events e where e.${since} and ${customers("e")}`;
  const events = `select * from public.product_events e where e.${since} and ${customers("e")}`;
  switch (key) {
    case "ai_by_model":
      return `with ai as (${ai})
select model, count(*)::int as calls, count(*) filter (where status = 'error')::int as failed,
  coalesce(sum(total_tokens), 0)::int as tokens, round(coalesce(sum(estimated_cost_usd), 0), 4) as usd
from ai group by model order by usd desc, calls desc`;
    case "create_runs":
      return `with ai as (${ai}), runs as (
  select request_id, sum(estimated_cost_usd) as usd, sum(total_tokens) as tokens, count(*) as calls,
    count(*) filter (where attempt > 1) as retries, sum(latency_ms) as ms
  from ai where route = 'creatives.generate' and request_id is not null group by request_id
), saved as (
  select count(*) as ads from public.creatives c join public.businesses b on b.id = c.business_id
  where c.${since} and ${includeInternal ? "true" : customerFilterSql("b.owner_id", "b.id", emails)}
)
select count(*)::int as runs, round(avg(usd), 4) as avg_usd, round((percentile_disc(0.9) within group (order by usd))::numeric, 4) as p90_usd,
  round(avg(tokens))::int as avg_tokens, round(avg(calls), 1) as avg_ai_calls, round(avg(retries), 1) as avg_retries,
  round(avg(ms) / 1000.0, 1) as avg_ai_seconds, (select ads from saved)::int as ads_saved,
  round(sum(usd) / nullif((select ads from saved), 0), 4) as usd_per_saved_ad
from runs`;
    case "business_days":
      return `with ai as (${ai})
select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day, left(business_id::text, 8) as business,
  count(*)::int as calls, round(coalesce(sum(estimated_cost_usd), 0), 4) as usd
from ai group by 1, 2 order by usd desc limit 10`;
    case "failures":
      return `with ai as (${ai}), ev as (${events})
select step, detail, count(*)::int as count, to_char(max(created_at), 'MM-DD HH24:MI') as last from (
  select 'ai ' || route as step, coalesce(metadata->>'failure', error_code, 'error') as detail, created_at from ai where status = 'error'
  union all
  select 'http ' || coalesce(attributes->>'route', '?'), 'HTTP ' || coalesce(attributes->>'status', attributes->>'errorCode', '5xx'), created_at
    from ev where name = 'http.request' and (outcome = 'failed')
  union all
  select 'workflow ' || name, coalesce(attributes->>'errorCode', 'failed'), created_at
    from ev where kind in ('workflow', 'action', 'system') and outcome = 'failed' and name <> 'ai.completion'
) f group by 1, 2 order by count desc limit 15`;
    case "speed":
      return `with ev as (${events})
select attributes->>'route' as route, count(*)::int as n,
  percentile_disc(0.5) within group (order by duration_ms) as p50, percentile_disc(0.9) within group (order by duration_ms) as p90
from ev where name = 'http.request' and attributes->>'status' like '2%' and attributes->>'route' not like '/api/cron/%'
group by 1 order by n desc limit 10`;
    case "funnel":
      return funnelSql(days, emails, { includeInternal });
    default:
      throw new Error(`Unknown section ${key}`);
  }
}

export function renderSection({ title }, rows) {
  if (!rows.length) return `${title}\n  (none)`;
  const columns = Object.keys(rows[0]);
  const cell = (value) => (value === null || value === undefined ? "-" : String(value));
  const widths = columns.map((column) => Math.max(column.length, ...rows.map((row) => cell(row[column]).length)));
  const line = (values) => `  ${values.map((value, index) => value.padEnd(widths[index])).join("  ")}`.trimEnd();
  return [title, line(columns), ...rows.map((row) => line(columns.map((column) => cell(row[column]))))].join("\n");
}

async function main() {
  const { values } = parseArgs({ options: { days: { type: "string", default: "7" }, "include-internal": { type: "boolean", default: false } } });
  const days = Number(values.days);
  const includeInternal = values["include-internal"];
  const emails = await localInternalEmails();
  console.log(`AdBrain stats, last ${days} days, ${includeInternal ? "everyone" : "real customers only"} (USD are provider estimates)\n`);
  for (const section of SECTIONS) {
    const rows = await readOnlyQuery(sectionSql(section.key, days, emails, { includeInternal }));
    const shown = section.key === "funnel" ? summarize(rows).totals.map(([step, users]) => ({ step, users })) : rows;
    console.log(`${renderSection(section, shown)}\n`);
  }
  if (!includeInternal) console.log("Internal accounts are excluded; add --include-internal to see them.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Stats failed.");
    process.exitCode = 1;
  });
}
