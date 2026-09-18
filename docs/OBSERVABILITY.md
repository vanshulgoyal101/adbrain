# Product and Account Logging

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

This policy describes the new product stream, not retroactive sanitization of
legacy owner audit records or hosting-provider access logs. Review the public
privacy notice and applicable consent requirements before production rollout.

## Enablement

1. Review and separately approve
   [the migration](../db/migrations/20260918_product_events.sql) for the intended
   database. Local verification does not authorize a production migration.
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
the database sink is enabled. It deletes at most 10,000 rows older than 90 days
per call, reporting count and returning 503 on cleanup failure. A count of 10,000
indicates possible backlog: an authorized operator should run additional bounded
prune calls and assess capacity. This is a 90-day target, not a guarantee during
outage or backlog. Account/business deletion cascades to associated table rows.

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