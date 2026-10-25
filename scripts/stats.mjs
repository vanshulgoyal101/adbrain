// What happened on the platform, in one command (#451). Read-only.
//   npm run stats [-- --days 7] [-- --include-internal] [-- learnings funnel …]  (only those sections)
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
  { key: "ad_receipts", title: "Last 20 ads: what each cost (its Create call plus later changes to it)" },
  { key: "run_receipts", title: "Last 5 Create runs: what each cost, failed ads included" },
  { key: "campaign_receipts", title: "Last 5 campaign launches: plan, prepare, create (its Meta calls), first sync" },
  { key: "business_days", title: "AI cost per business per day (top 10)" },
  { key: "failures", title: "Failures by step (AI calls, server errors, workflows)" },
  { key: "auth", title: "Sign-ins and sign-ups by method, and why sign-ins failed" },
  { key: "speed", title: "Speed of the busiest routes (successful requests, ms)" },
  { key: "learnings", title: "Learning ledger: the last 10 launches side by side (settings at launch, latest results, hypothesis and verdict)" },
  { key: "managed_accounts", title: "2-Tier managed accounts by state (#527)" },
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
    // #451 L1: an ad's calls are its own angle in the Create run that made it (generation.requestId,
    // generation.angleId), plus every later change to it (metadata.creativeId). Ads made before
    // these were stored show no calls.
    case "ad_receipts":
      return `select to_char(c.created_at, 'MM-DD HH24:MI') as made, left(c.id::text, 8) as ad, c.angle,
  count(e.id)::int as ai_calls, count(e.id) filter (where e.status = 'error')::int as failed,
  count(e.id) filter (where e.attempt > 1)::int as retries, coalesce(sum(e.total_tokens), 0)::int as tokens,
  round(coalesce(sum(e.estimated_cost_usd), 0), 4) as usd, round(coalesce(sum(e.latency_ms), 0) / 1000.0, 1) as ai_seconds,
  string_agg(distinct e.model, ', ') as models
from public.creatives c join public.businesses b on b.id = c.business_id
left join public.llm_usage_events e on e.business_id = c.business_id and e.created_at > c.created_at - interval '15 minutes' and (
  (e.route = 'creatives.generate' and e.request_id::text = c.generation->>'requestId' and e.metadata->>'angle' = c.generation->>'angleId')
  or e.metadata->>'creativeId' = c.id::text)
where c.${since} and ${includeInternal ? "true" : customerFilterSql("b.owner_id", "b.id", emails)}
group by c.id, c.created_at, c.angle
order by c.created_at desc limit 20`;
    case "run_receipts":
      return `with ai as (${ai}), runs as (
  select request_id, business_id, min(created_at) as started, count(*) as calls, count(*) filter (where status = 'error') as failed,
    count(*) filter (where attempt > 1) as retries, sum(total_tokens) as tokens, sum(estimated_cost_usd) as usd,
    string_agg(distinct model, ', ') as models,
    -- Wall time: the first call's start to the last call's end (the route itself returns while streaming).
    extract(epoch from max(created_at) - min(created_at - make_interval(secs => coalesce(latency_ms, 0) / 1000.0))) as seconds
  from ai where route = 'creatives.generate' and request_id is not null group by request_id, business_id
)
select to_char(r.started, 'MM-DD HH24:MI') as started, left(r.business_id::text, 8) as business,
  (select count(*) from public.creatives c where c.business_id = r.business_id and c.generation->>'requestId' = r.request_id::text)::int as ads_saved,
  r.calls::int as ai_calls, r.failed::int as failed, r.retries::int as retries, r.tokens::int as tokens, round(r.usd, 4) as usd,
  round(r.seconds::numeric, 1) as seconds, r.models
from runs r order by r.started desc limit 5`;
    // #451 L2: a launch is its campaign_operations row. Plan and prepare are that business's
    // requests in the day before it; the create request is the first one after it, and its Meta
    // calls share that request_id (meta.graph events); sync is the first refresh after it.
    case "campaign_receipts":
      return `with ev as (${events}), ops as (
  select o.id, o.business_id, o.created_at, o.state from public.campaign_operations o join public.businesses b on b.id = o.business_id
  where o.${since} and ${includeInternal ? "true" : customerFilterSql("b.owner_id", "b.id", emails)}
  order by o.created_at desc limit 5
)
select to_char(o.created_at, 'MM-DD HH24:MI') as launched, left(o.business_id::text, 8) as business, o.state,
  plan.n as plans, plan.ms as plan_ms, prep.n as prepares, prep.ms as prepare_ms,
  cr.attributes->>'status' as create_status, cr.duration_ms as create_ms,
  g.calls as meta_calls, g.failed as meta_failed, g.ms as meta_ms, g.errors as meta_errors,
  to_char(sync.at, 'MM-DD HH24:MI') as first_sync
from ops o
left join lateral (select count(*)::int as n, max(duration_ms) as ms from ev e where e.business_id = o.business_id and e.name = 'http.request'
  and e.attributes->>'route' = '/api/campaigns/plan' and e.created_at between o.created_at - interval '1 day' and o.created_at) plan on true
left join lateral (select count(*)::int as n, max(duration_ms) as ms from ev e where e.business_id = o.business_id and e.name = 'http.request'
  and e.attributes->>'route' = '/api/campaigns/preflight' and e.created_at between o.created_at - interval '1 day' and o.created_at) prep on true
left join lateral (select e.request_id, e.attributes, e.duration_ms from ev e where e.business_id = o.business_id and e.name = 'http.request'
  and e.attributes->>'route' = '/api/campaigns/create' and e.created_at between o.created_at and o.created_at + interval '10 minutes'
  order by e.created_at limit 1) cr on true
left join lateral (select count(*)::int as calls, count(*) filter (where e.outcome <> 'success')::int as failed,
  sum(e.duration_ms)::int as ms, string_agg(distinct e.attributes->>'errorCode', ', ') as errors
  from ev e where e.request_id = cr.request_id and e.name = 'meta.graph') g on true
left join lateral (select min(e.created_at) as at from ev e where e.business_id = o.business_id and e.name = 'http.request'
  and e.attributes->>'route' in ('/api/campaigns/[id]/refresh', '/api/campaigns/sync') and e.outcome = 'success' and e.created_at > o.created_at) sync on true
order by o.created_at desc`;
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
    // #451 L4: failed sign-ins are often signed out, so rows without a user are kept.
    case "auth":
      return `select name as step, outcome, coalesce(attributes->>'errorCode', '-') as detail, count(*)::int as count,
  to_char(max(created_at), 'MM-DD HH24:MI') as last
from public.product_events e where e.${since} and e.name like 'auth.%'
  and (e.user_id is null or ${customers("e")})
group by 1, 2, 3 order by count desc limit 15`;
    case "speed":
      return `with ev as (${events})
select attributes->>'route' as route, count(*)::int as n,
  percentile_disc(0.5) within group (order by duration_ms) as p50, percentile_disc(0.9) within group (order by duration_ms) as p90
from ev where name = 'http.request' and attributes->>'status' like '2%' and attributes->>'route' not like '/api/cron/%'
group by 1 order by n desc limit 10`;
    case "managed_accounts":
      return `select m.state, count(*)::int as accounts,
  count(*) filter (where m.state not in ('ready', 'offboarded') and m.updated_at < now() - interval '30 minutes')::int as stuck_over_30_min
from public.managed_meta_accounts m join public.businesses b on b.id = m.business_id
where ${includeInternal ? "true" : customerFilterSql("b.owner_id", "b.id", emails)} group by m.state order by accounts desc`;
    // #588: not limited by --days; comparing runs (e.g. #157's Hinglish prefill vs #499's English one) spans weeks.
    case "learnings":
      return `with r as (select distinct on (campaign_id) * from public.campaign_results order by campaign_id, fetched_at desc)
select to_char(l.created_at, 'MM-DD') as launched, left(coalesce(c.name, '-'), 32) as campaign, l.snapshot->>'destination' as destination,
  l.snapshot->'whatsapp'->>'language' as prefill_lang, left(l.snapshot->'whatsapp'->>'prefill', 40) as prefill,
  l.snapshot->'audience'->>'advantageAudience' as adv_audience, l.snapshot->'formats' as formats,
  (l.snapshot->'budget'->>'dailyRupees')::numeric as daily_inr, r.spend, r.impressions,
  round(r.spend / nullif(r.impressions, 0) * 1000, 2) as cpm, r.whatsapp_opens as opened, r.conversations as chats,
  round(100.0 * r.conversations / nullif(r.whatsapp_opens, 0), 1) as open_to_chat_pct, r.cost_per_conversation as inr_per_chat,
  left(l.hypothesis, 50) as hypothesis, left(l.verdict, 50) as verdict
from public.campaign_learnings l join public.campaigns c on c.id = l.campaign_id join public.businesses b on b.id = l.business_id
left join r on r.campaign_id = c.id
where ${includeInternal ? "true" : customerFilterSql("b.owner_id", "b.id", emails)}
order by l.created_at desc limit 10`;
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
  const { values, positionals } = parseArgs({ options: { days: { type: "string", default: "7" }, "include-internal": { type: "boolean", default: false } }, allowPositionals: true });
  const unknown = positionals.filter((key) => !SECTIONS.some((section) => section.key === key));
  if (unknown.length) throw new Error(`Unknown section ${unknown.join(", ")}. Sections: ${SECTIONS.map((section) => section.key).join(", ")}.`);
  const days = Number(values.days);
  const includeInternal = values["include-internal"];
  const emails = await localInternalEmails();
  console.log(`AdBrain stats, last ${days} days, ${includeInternal ? "everyone" : "real customers only"} (USD are provider estimates)\n`);
  for (const section of SECTIONS.filter(({ key }) => !positionals.length || positionals.includes(key))) {
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
