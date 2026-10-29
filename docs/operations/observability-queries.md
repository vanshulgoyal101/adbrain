# Observability Queries and Verification

Part of [Operations](README.md). What is logged and why: [Observability](observability.md).

## Operator Queries

Run these only with an authorized operator connection, never browser credentials.
Filter `attributes->>'environment' = 'production'` for production-only analysis
when a database receives more than one environment. SQL below is read-only.

### Request Failures and Latency

```sql
select attributes->>'route' as route,
       count(*) as requests,
       count(*) filter (where outcome = 'failed') as failures,
       count(*) filter (where outcome = 'rejected') as rejections,
       round(avg(duration_ms)) as average_ms,
       percentile_cont(0.95) within group (order by duration_ms) as p95_ms
from public.product_events
where created_at >= now() - interval '7 days' and kind = 'request'
  and attributes->>'route' <> '/api/events'
group by 1 order by failures desc, p95_ms desc;
```

### Account Activity and Workflow Outcomes

```sql
select business_id, name, outcome, count(*) as events,
       count(distinct user_id) as users
from public.product_events
where created_at >= now() - interval '30 days'
  and kind in ('workflow', 'action', 'client')
group by 1, 2, 3 order by 1, 2, 3;
```

Counts show observed stages, not a causal conversion funnel. Operation replays
and retries are events too; do not interpret them as newly created campaigns.
Client page events are useful directional usage signals but can be forged by an
authenticated client. Direct browser-to-Supabase mutations, authentication calls
made directly to Supabase, individual clicks and background work outside these
instrumented boundaries are not comprehensively captured.

### Feature Usage and Foreground Time

```sql
select attributes->>'route' as page,
       attributes->>'action' as action,
       attributes->>'viewport' as viewport,
       name, count(*) as observed_events,
       sum(duration_ms) filter (where name='page.engagement') as foreground_ms
from public.product_events
where created_at >= now() - interval '30 days'
  and kind='client' and attributes->>'environment'='production'
group by 1,2,3,4 order by observed_events desc;
```

Compare client intent with server `action`/`workflow` outcomes by authorized
business and time window. These are not causally matched sessions or distinct-user
conversion rates, and one hour is the maximum reported visible segment.

### Long-Term Daily Totals

This unions archived aggregates with remaining raw events, including any pruning
backlog, without counting deleted raw events again. The summary intentionally
cannot reconstruct individual customer timelines or exact historical percentiles.

```sql
with daily as (
  select day, kind, name, outcome, event_count, timed_event_count, duration_sum_ms
  from public.product_event_daily
  where day >= (now() at time zone 'UTC')::date - 730 and environment='production'
  union all
  select (created_at at time zone 'UTC')::date, kind, name, outcome,
         count(*), count(duration_ms), coalesce(sum(duration_ms),0)
  from public.product_events
  where created_at >= now() - interval '730 days'
    and attributes->>'environment'='production'
  group by 1,2,3,4
)
select day, kind, name, outcome, sum(event_count) as events,
       sum(duration_sum_ms) / nullif(sum(timed_event_count),0) as average_duration_ms
from daily group by 1,2,3,4 order by day desc, events desc;
```

### Trace an Incident

```sql
select created_at, request_id, user_id, business_id, kind, name,
       outcome, duration_ms, attributes
from public.product_events
where request_id = '00000000-0000-4000-8000-000000000000'
order by created_at, event_id;
```

Replace the placeholder with `X-Request-Id` or the API response's request ID.
Correlate with `llm_usage_events.request_id` when investigating an AI call.

### AI Cost and Quality Signals

```sql
select business_id, attributes->>'provider' as provider,
       attributes->>'model' as model, outcome, count(*) as completions,
       sum((attributes->>'totalTokens')::bigint) as tokens,
       sum((attributes->>'estimatedCostUsd')::numeric) as estimated_usd
from public.product_events
where name = 'ai.completion' and created_at >= now() - interval '30 days'
group by 1, 2, 3, 4 order by estimated_usd desc nulls last;
```

Costs are estimates, not invoices. Missing provider usage or failed logging can
under-count costs. Use generation approval/rejection, partial batches and repeat
usage as hypotheses to investigate, not proof that an audience or creative works.

A rejected reply's `ai.completion` event carries `validationRules`, the names of
the checks it broke (up to 12, never the reply's text; #378). The top rules per model:

```sql
select attributes->>'model' as model, rule, count(*) as failures
from public.product_events, jsonb_array_elements_text(attributes->'validationRules') as rule
where name = 'ai.completion' and outcome = 'failed' and created_at >= now() - interval '1 day'
group by 1, 2 order by failures desc;
```

`business.create` and `business.update` carry `brandUsable` (#1136): whether the saved Brand has
what Prepare needs (name, category, area, phone, offer). The core scoreboard's Brand row uses it: minutes
from the owner's sign-up (if within 24 h before the create, since setup collects the Brand first) or else the
create, to the first usable save; team accounts (`isInternalUser`) are left out.

A rejected `campaign.review` event carries `blockerCodes`, the stable reason of every
Review blocker (#688; `errorCode` is the first). Rank them, then leave out internal accounts
(`scripts/lib/internal-accounts.mjs`): the production smoke is rejected on `REVIEW_NO_WEBSITE` by design.

```sql
select code, count(*) as rejections
from public.product_events, jsonb_array_elements_text(attributes->'blockerCodes') as code
where name = 'campaign.review' and outcome = 'rejected' and created_at >= now() - interval '7 days'
group by 1 order by rejections desc;
```

A failed image attempt's usage row and `ai.completion` event carry a short reason in
`errorCode`: `IMAGE_HTTP_<status>`, `IMAGE_FREE_BUSY` (an internal account's Pollinations stayed
busy past ~90 s), `IMAGE_INVALID` (the answer was not a usable picture), `IMAGE_FETCH_<code>`,
`IMAGE_TIMEOUT`, `IMAGE_PROVIDER` or `IMAGE_OTHER` (#451).

Create's assistant and the campaign planner (`campaigns.plan`, #378) also log each
provider attempt the router gave up on as `ai.completion` failed with `errorCode`
`LLM_HTTP_429`, `LLM_TIMEOUT` and so on, even when a fallback then answers. When none answers, a `creative.interview`
workflow event records `ASSISTANT_EXHAUSTED_<reason>` and the owner gets a 503
"busy" (#410); a refused key or request records `ASSISTANT_HTTP_401`/`_403`/`_400`
and stays a 500 (#449). Refusals per provider and hour:

```sql
select date_trunc('hour', created_at) as hour, attributes->>'provider' as provider,
       attributes->>'errorCode' as reason, count(*) as refused
from public.product_events
where name = 'ai.completion' and outcome = 'failed' and attributes->>'errorCode' like 'LLM_%'
  and created_at >= now() - interval '1 day'
group by 1, 2, 3 order by 1 desc, refused desc;
```

## Verification

Regression tests cover metadata allowlisting, tenant-context isolation, verified
identity capture, response preservation, exceptions, post-response persistence
failure, all-route coverage, client privacy controls, ingestion abuse, and schema
parity. The disposable PostgreSQL harness verifies browser privilege denial,
service access and bounded retention for fresh installs and repeated upgrades.
Production persistence and external alert delivery require rollout verification.

Run `npm run test:meta-db -- --analytics-only` for focused fresh/upgrade rollup,
ledger replay, atomic rollback, concurrent bounded pruning and privilege checks.
The default SQL harness includes these cases. Existing client-event, telemetry and
logging-coverage tests cover allowlisted labels, DNT/GPC, foreground timing, disabled
controls, volume caps and nonblocking failures. No paid operation is needed.

Validate a changed emitter with the existing observability/client-event tests,
not a paid generation. A prose-only update needs source/link/example checks, not
a new production event or a replay of historical suites. Route instrumentation
coverage belongs to tests; avoid treating a historical route count as today's API
inventory. The record below describes only its original candidate.

### Local Receipt: 2026-09-18

- Environment-free isolated snapshot: 1,227 tests passed, one live-provider test
  skipped, across 137 passing files. Statement coverage 76.48%, branches 68.59%,
  functions 75.88%, lines 78.96%.
- TypeScript, ESLint and production build passed (54 generation tasks); npm
  audit reported zero known vulnerabilities. Current source and tests matched
  the snapshot after validation; editor diagnostics and diff whitespace checks
  were clean.
- Disposable PostgreSQL fresh-install and repeated-upgrade tests passed,
  including telemetry browser privilege denial, service access and retention.
- Browser collector behavior was tested in jsdom, not in a live authenticated
  browser. Production `after` persistence has not been verified against a hosted
  database. No migration, deployment, credentials, production configuration,
  paid model calls or Meta mutations occurred.
- Route instrumentation covers 44 API/auth methods including `/api/events`,
  plus five server actions. The preflight endpoint was also aligned with the
  shared creation-time loaders; a regression test submits the exact preflight
  hash to creation successfully.
