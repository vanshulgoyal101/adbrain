# Product and Account Logging

Part of [Operations](README.md). Queries and verification: [Observability queries](observability-queries.md).

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
[Operations](README.md#first-response) for recovery decisions.

Implementation owners: [event schema](../../src/lib/observability/events.ts),
[request context](../../src/lib/observability/context.ts),
[wrappers and scheduling](../../src/lib/observability/logger.ts),
[database sink](../../src/lib/observability/store.ts),
[browser collector](../../src/components/product-telemetry.tsx), and
[ingestion route](../../src/app/api/events/route.ts).

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
- Authorized Meta operation purpose, duration, outcome and safe error category. When Meta refused
  the call (#615), the `meta.<purpose>` event also carries `status`, `metaCode`, `metaSubcode`,
  `metaUserTitle`, `fbtraceId` and `metaPath` (the endpoint template), never tokens or bodies.
  `meta.create_paused` covers the pre-launch reads too (lead forms, interests), except the Settings/Brand
  WhatsApp-number status read, which is gated the same way but logged as `meta.whatsapp_numbers` (#1540).
- Every Meta Graph call (#451 L2): `meta.graph`, `kind=system`, with the endpoint as a template
  (`act_[id]/adsets`, `[id]/insights`, `search`; no IDs, query values or token), method, HTTP
  status, entity type, latency and, on failure, `META_<code>_<subcode>` (or `META_HTTP_<status>`,
  `META_TIMEOUT`, `META_NETWORK`). Meta's 4xx refusals are `rejected`; 5xx, throttling and network
  errors are `failed`. Calls inside a request share its request ID. Outside one (a page render's
  Meta reads), each `withMetaConnection` run gets its own request ID and business, shared with its
  `meta.<purpose>` event (#615). A context keeps at most 100
  events, so a long cron run logs its first 100 calls to the database (all to the log stream).
- Cloudflare's daily free-picture limit (#2404): `image.free_daily_limit`, `kind=system`, `outcome=failed`,
  with `provider` and `errorCode=IMAGE_FREE_DAILY_LIMIT`, once per refusal; `/api/cron/llm-credit` counts the day.
- Audit/usage persistence failures and product-log persistence health warnings.
- Authenticated page views and browser error/rejection categories on the eight
  workspace pages. These are marked `kind=client`: client-reported signals, not
  trustworthy proof of a mutation or security event.
- Deployment environment and Vercel commit SHA when available.
- Allowlisted `ui.action` intent for generation, inspection, approval/unapproval,
  regeneration/export, campaign create/review/activate/pause/sync, Brand save,
  upload/delete, follow-up save, payment quote/checkout, Meta connect controls and
  `meta.access_request` (a new owner asking for Facebook access before App Review),
  the audience edit (`campaign.edit_audience`), Help on WhatsApp (`help.whatsapp`, #1284), and hiding
  Home's "last week" card (`home.week_summary_dismiss`, #1668; Home reads it to keep the card hidden that week).
- `lead.customer_marked` (#2026), `kind=action`, server-side: an enquiry crossing to or from
  "customer" in the inbox or a campaign's WhatsApp chats. Attributes: `source` (inbox|whatsapp),
  `campaignId` when known, `undone` (true when unmarked).
- `ui.tap` (#1242): one per tap on an enabled control (button, link, tab, checkbox, select) on the
  launch path (`/create`, `/studio`, `/campaigns`), page only, never which control or what was typed;
  it counts #1226's "taps from Create to live". Same switch, Do Not Track and 45-a-minute cap.
- `page.engagement` foreground-visible time, flushed on hide, navigation or exit,
  excluding background time. Each segment is 1 second to 1 hour; it measures visible
  time, not attention, billable usage or proof of activity. Coarse viewport categories
  are `compact` (<640px), `medium` (<1024px) and `wide`; no exact resolution/user agent.

Existing API response request IDs and AI usage request IDs use the same context
as `X-Request-Id`. Immutable responses may not accept that header. Internal
operation IDs and idempotency keys remain unchanged. Overlapping requests use
isolated async contexts; one account cannot inherit another request's identity.

Request outcomes map HTTP statuses below 400 to `success`, 4xx to `rejected` and
5xx to `failed`; workflow events can also be `started` or `partial`, so a
successful request can still carry a partial business result. The `release`
attribute appears only for a 7-40 character hexadecimal `VERCEL_GIT_COMMIT_SHA`.

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
  [the product-event migration](../../db/migrations/20260918_product_events.sql)
  under the [release policy](releasing.md). Existing sinks need only the new
  [rollup migration](../../db/migrations/20260928_product_event_rollups.sql) before
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

### Missing-Event Triage

| Observation | Next check |
| --- | --- |
| No product JSON | `PRODUCT_LOGGING_ENABLED`, whether the path is instrumented, runtime log source and time window |
| JSON but no database row | `PRODUCT_LOGGING_DATABASE_ENABLED`, service-role target, schema/grants and `PERSIST_FAILED` |
| `SCHEDULE_FAILED` | Whether the code ran inside a Next request/action lifecycle where `after` is available |
| `INVALID_EVENT` | Caller metadata against the [event schema](../../src/lib/observability/events.ts); fix the emitter without logging the payload |
| No browser event | Build-time client flag, DNT/GPC, authenticated same-origin session, tracked page, 2 KiB/60-per-minute limits; no retry |
| Missing account IDs | Authentication/ownership had not resolved; never fill the gap from a client-supplied ID |

The flags are independent: product logging defaults on, the database sink off,
and browser collection on unless disabled or denied by DNT/GPC. Turning off
`PRODUCT_LOGGING_ENABLED` also drops browser events at `/api/events`. Disabling
the sink does not remove existing rows or runtime log copies.

## Sign-in Events (#451 L4)

Workflow events `auth.sign_in.<method>` and, for a first sign-in (the address is confirmed in the
same moment), `auth.sign_up.<method>`, with `<method>` `password`, `email_link` or `google`.
`/auth/callback` records Google and email-link outcomes; a failed callback, which redirects to
`/login?error=auth` with a 302 and so looks like a successful request, records `failed` with
`errorCode` `AUTH_CALLBACK:<Supabase code>` (`missing_params` for a bare link, `other` for
anything that is not a plain code). Password sign-in, sending a sign-in link (`started`) and
starting Google happen in the browser, which reports them to `POST /api/auth/outcome` with
`AUTH_CLIENT:<code>` on failure. Events carry codes, never the email or message; `npm run stats`
shows them in its auth section, including signed-out failures.

## Reading It (#451)

**Learning ledger (#588).** Every launch writes a settings snapshot to `campaign_learnings`
(destination, WhatsApp prefill text and language, areas, ages, Advantage+ audience, formats,
budget, creatives with angle and models; v2 (#672) adds Advantage+ as sent, the Meta creative ids,
and the cap once a capped activation is confirmed), best effort: a ledger failure logs
`campaign.learning_snapshot` and never fails the launch. QA 2 records the hypothesis a run tests
and its verdict with `npm run learnings -- set <meta campaign id> --hypothesis "…" --verdict "…"`
(and `--snapshot file.json` for runs launched before the ledger, e.g. #157); that's a production
data write with the service-role key, no lead data. `npm run stats -- --include-internal learnings`
compares the last 10 launches side by side with their latest results (opened → chats, cost per chat).
Name sections after `--` to print only those.

`npm run stats [-- --days 7] [-- --include-internal]` prints, from production (read-only,
real customers only by default): AI calls, tokens and estimated USD by model; Create runs
(cost, tokens, AI calls, retries and AI seconds per run, cost per saved ad); AI cost per
business per day; failures by step (AI calls with their provider reason, 5xx routes, failed
workflows); p50/p90 of the busiest routes; and the sign-up funnel. Receipts (#451 L1): the
last 20 ads, each with its AI calls, failures, retries, tokens, USD, AI seconds and models (its
own angle in the Create run that made it, from `creatives.generation.requestId`/`angleId`, plus
every later regenerate or background change, from `llm_usage_events.metadata.creativeId`; ads
made before Oct 24 show none), and the last 5 Create runs with failed ads included and wall
seconds from the first call's start to the last call's end. Campaign receipts (#451 L2): the last 5 launches
(`campaign_operations`), each with that business's plan and prepare requests in the day before,
the create request's status and time, its Meta calls (count, failed, ms, error codes; joined on
the create request ID) and the first refresh or sync after it. Launch plan checks (#419 item
2(a)): every launch records `campaign.plan_check` with Meta's new-advertiser rules its exact ad
set and creative payloads didn't pass (`validationRules` such as `9-16-stories-reels-image:warn`;
partial on a warning or failure), and stats counts launches per rule. Page-load timing in a
real browser: `node scripts/perf-pages.mjs [--runs 5] [--pages /dashboard,/campaigns,/brand]`
(TTFB, DOMContentLoaded and load p50/p90; read-only, signed in as the smoke account).

| Table | Kept |
| --- | --- |
| `product_events` (raw) | 90 days, then rolled up |
| `product_event_daily` (rollups) | 730 days |
| `llm_usage_events` (every AI call: model, tokens, cost) | kept: the per-ad and per-run cost receipt (hundreds of rows a week) |
| `campaign_results`, `leads`, payments | kept: business records |

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
