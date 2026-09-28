# Product and Account Logging

Use this guide to trace a request, interpret an event and diagnose missing
telemetry without collecting customer content. Verify deployment and migration
evidence separately from source behavior.
Configuration defaults are not a readout of the currently deployed environment.

## Start With the Right Evidence

| Evidence | Useful for | Does not prove |
| --- | --- | --- |
| `X-Request-Id` and structured request/action event | Correlating one instrumented request, outcome and timing | A provider mutation did not occur after a timeout |
| Product-event database row | Searching sanitized request/workflow signals | Complete, exactly-once or tamper-proof accounting |
| Campaign draft/operation ledger | Original intent, version, phase and recorded remote IDs | Every remote side effect was saved locally |
| `llm_usage_events` and provider invoices | Known token usage versus billed activity | Product-event estimates are invoices or atomic spending reservations |
| Owner audit activity | Human-facing action history | Legacy/client-origin rows have trusted server provenance |
| Hosting logs and alerts | Process failures, cold starts and delivery/retention health | App sanitization applies to every hosting/vendor log |

For an incident, first identify deployment SHA, environment, safe request ID and
authorized account scope. Search one bounded time window, then compare the durable
operation/usage record and authorized provider evidence where necessary. Never
replay a paid operation just to manufacture a missing log. See
[Operations](OPERATIONS.md#first-response) for recovery decisions.

Implementation owners: [event schema](../src/lib/observability/events.ts),
[request context](../src/lib/observability/context.ts),
[wrappers and scheduling](../src/lib/observability/logger.ts),
[database sink](../src/lib/observability/store.ts),
[browser collector](../src/components/product-telemetry.tsx), and
[ingestion route](../src/app/api/events/route.ts).

## Production Database Rollout: 2026-09-18

The owner authorized database logging and retention enablement. The exact
`20260918_product_events.sql` migration was applied transactionally to the
verified AdBrain production project after focused tests and disposable PostgreSQL
fresh/upgrade checks passed. RLS, browser privilege denial, service access and
the retention function were verified after application. No business records,
campaigns, provider credentials or encryption keys were changed.

`PRODUCT_LOGGING_DATABASE_ENABLED=true` is configured for Production only. It
takes effect with the next protected production release; the release PR records
the exact deployment and post-deployment event/retention verification. Do not
infer persistence from the saved flag alone. Rollback is to disable the sink and
redeploy a verified build, preserving the additive table and existing evidence.
External alerting and hosting-log retention remain separate operator concerns.

## What Is Recorded

All API/auth handlers and the five server actions emit structured JSON with
`source=adbrain.product`, a versioned schema, unique event ID, server-generated
request ID, timestamp, outcome and duration. Verified Supabase user UUIDs and
authorized business UUIDs attach account context when available. Anonymous
requests and failures before ownership resolution intentionally have null IDs.
Identity is never taken from a client-supplied logging payload or request header.

The stream includes:

- Request route templates, methods, status codes, durations and exceptions.
- Server-action success, rejection and exceptions; mutation audit action names.
- Campaign review blockers and operation states, including reconciliation.
- Creative batch success/partial/failure counts.
- AI completion provider/model, tokens, estimated cost, attempt, cache status
  and reported latency. Existing `llm_usage_events` remains the detailed ledger.
- Authorized Meta operation purpose, duration, outcome and safe error category.
- Audit/usage persistence failures and product-log persistence health warnings.
- Authenticated page views and browser error/rejection categories on the eight
  workspace pages. These are marked `kind=client`: client-reported signals, not
  trustworthy proof of a mutation or security event.
- Deployment environment and Vercel commit SHA when available.
- Allowlisted `ui.action` intent for generation, inspection, approval/unapproval,
  regeneration/export, campaign create/review/activate/pause/sync, Brand save,
  upload/delete, follow-up save, payment quote/checkout and Meta connect controls.
- `page.engagement` foreground-visible time, flushed on hide, navigation or exit,
  excluding background time. Each segment is 1 second to 1 hour; it measures visible
  time, not attention, billable usage or proof of activity. Coarse viewport categories
  are `compact` (<640px), `medium` (<1024px) and `wide`; no exact resolution/user agent.

Existing API response request IDs and AI usage request IDs use the same context
as `X-Request-Id`. Immutable responses may not accept that header. Internal
operation IDs and idempotency keys remain unchanged. Overlapping requests use
isolated async contexts; one account cannot inherit another request's identity.

## Privacy and Access

The new product stream never copies request/response bodies, URL queries, raw
paths containing object IDs, cookies, tokens, email addresses, IP addresses,
user agents, prompts, creative copy, lead contact details, error messages or
stack traces. An allowlist strips unknown metadata; malformed events produce a
fixed `INVALID_EVENT` diagnostic without echoing the rejected data.

User/business UUIDs are pseudonymous identifiers, not anonymous data. Limit
operator access to people authorized to support accounts and improve the product.
There is no customer-accessible all-accounts log endpoint or admin UI in this
change. Browser roles cannot read, insert, update or delete `product_events`.
Only trusted server credentials can insert/read/delete rows.

The browser collector respects Do Not Track and Global Privacy Control and has
no tracking cookie, replay, keystroke capture or third-party analytics endpoint.
It sends only fixed page/event enums, caps errors at three per mounted page,
and does not retry failed submissions. The ingestion endpoint requires an
authenticated same-origin request, enforces 60 events/minute/user and a 2 KiB
streaming body limit. Operational API/security logs remain active independently
of optional browser telemetry.

The collector sends only controls explicitly tagged with an allowlisted
`data-product-event` code, never button text, input values, filenames or searches.
It caps sends at 45 per minute per mounted page and rechecks DNT/GPC before each
send; API rate limits remain authoritative across tabs/navigation. Events are best
effort with no retries or tracking/session cookie. Interaction events have
`kind=client,outcome=started`; use trusted server outcomes to assess completion.

This policy describes the new product stream, not retroactive sanitization of
legacy owner audit records or hosting-provider access logs. Review the public
privacy notice and applicable consent requirements before production rollout.

## Enablement

1. Inspect the target's existing schema and configuration. For a new sink, apply
  [the product-event migration](../db/migrations/20260918_product_events.sql)
  under the [release policy](RELEASING.md). Existing sinks need only the new
  [rollup migration](../db/migrations/20260928_product_event_rollups.sql) before
  the next cleanup; do not replay old applied migrations.
2. Deploy through the protected release workflow. Structured runtime JSON is on
   by default; `PRODUCT_LOGGING_ENABLED=false` disables the new event stream.
3. Set `PRODUCT_LOGGING_DATABASE_ENABLED=true` only after the table/function and
   service-role permissions exist. It is off by default, so code can deploy before
   the migration without attempting new database writes.
4. `NEXT_PUBLIC_PRODUCT_LOGGING_ENABLED=false` disables the optional browser
   collector at build time. Rebuild when changing a public environment variable.
5. Verify a real authorized request has a request ID, expected account context,
   an operator-readable event, and no `PERSIST_FAILED`/`SCHEDULE_FAILED` warnings.
   Check a forbidden request too. Do not perform a paid generation or Meta
   mutation just to test logging without separate approval.

Database writes run with Next `after`, after the handler result, under a 3-second
deadline. Up to 100 events/request are retained for a batch; the final request or
action summary is retained if the batch is full. Structured runtime events remain
available even when the database is unavailable. Collection is best effort, not
an exactly-once or tamper-proof audit ledger; a process crash can lose events.
Do not retry business operations to compensate for missing logs.

## Retention and Health

The existing authenticated daily keepalive invokes `prune_product_events` when
the database sink is enabled. With the rollup migration, it atomically moves up to
10,000 expired raw events per call into `public.product_event_daily`, then removes
those raw rows. Raw retention remains 90 days. Rollups keep UTC day, environment,
release, kind/name/outcome, route/action/viewport and provider/model, plus event
counts, timed-event count, summed/max duration, token totals, estimated cost and
batch item/failure counts. No user/business/request/event IDs or raw attributes
are retained in aggregates. Browser roles have no access; the service role can
read totals but only the pruning function writes them.

Raw deletion and aggregate increments share one transaction. Failure rolls both
back; concurrent invocations do not count the same event twice. Rows are aggregated
as they are pruned, not at ingestion, so recent analysis uses raw events. Late raw
events can add to an existing day's totals. Rollups older than 730 UTC days are
removed in bounded batches; raw data already that old is dropped without creating
obsolete rollups. Counts intentionally include retries and repeated client signals.
No historical backfill is available for events pruned before this migration.

The function keeps its integer raw-deletion response and cleanup failures still
produce 503. A count of 10,000 indicates possible backlog: an authorized operator
should run additional bounded prune calls and assess capacity. Retention targets
are not guarantees during outage or backlog. Account/business deletion cascades to
associated raw rows; aggregates contain no account identifiers to link or remove.

Configure hosting-log/log-drain retention and access separately; database pruning
does not remove copies in runtime log providers. Set an appropriate retention
there before rollout. Monitor failed requests, repeated rejections, partial
generations, reconciliation, `INVALID_EVENT`, `PERSIST_FAILED`, `SCHEDULE_FAILED`,
and retention failures. This implementation emits signals; it does not provision
an external alerting service or promise delivery of alerts.

Logging is unsampled. Polling endpoints and rejected requests can generate volume.
Measure database/storage load before a wider rollout. Prefer aggregated analysis;
avoid exporting complete account timelines unless needed for a specific issue.
Disable the database sink to stop new writes without disabling operational JSON.

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