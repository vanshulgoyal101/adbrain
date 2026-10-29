# Jobs and Telemetry API

Scheduled jobs (`/api/cron/*`), internal diagnostics, product analytics and feedback. Conventions: [API reference](README.md).

## Routes

`Envelope` means the typed family in [Response Families](README.md#response-families); `plain` means route-specific JSON.

| Method | Path | Input / result | Effect |
| --- | --- | --- | --- |
| POST | `/api/events` | Fixed client event | Optional telemetry, normally 204 |
| POST | `/api/feedback/pilot-day7` | `{businessId, answer: yes\|maybe\|no, reason: <code>}` or `{businessId, dismiss: true}` -> `{ok:true}`; **409** when the question isn't open (exempt, before day 7, already answered, or snoozed); **400** for an unlisted answer/reason or extra fields | Owner only; one `pilot_day7` (or `pilot_day7.dismissed`) product event, codes only (#1650) |
| GET | `/api/cron/keepalive` | Cron Bearer auth | DB health and optional telemetry pruning |
| GET | `/api/cron/enforce-spend` | Cron Bearer auth | Can pause live campaigns; `{ok,at,swept,unverified,reauth,managedSpendCaps}`, `reauth: [{key,since,activeCampaigns}]` for dead owner tokens, which don't fail the run (#758) |
| GET | `/api/cron/sync-leads` | Cron Bearer auth | Imports new Meta leads for every connected business (read-only on Meta); dead owner tokens go to `reauth` instead of failing the run (#758); with `OWNER_ALERTS_ENABLED`, then WhatsApps opted-in owners one alert per new lead under 24 h old (#701) #1838: a Meta throttle (Graph 4/17/32/613/80000–80014) is not a failure: that business is skipped for the run (`throttled: [{key|businessId, scope, retryAfterMs}]`), and app scope (code 4) stops the run |
| GET | `/api/cron/refresh-results` | Cron Bearer auth | Every 15-min run per active campaign (at most every 14 min, #992): Meta insights and ad review (read-only), one result row and `raw.health` flags. A paused bound campaign gets results only (no review, no health): one read at AdBrain's pause + 1 d and + 7 d (Meta's attribution window), then final; one lifetime read when it has no row (imported) (#1003). `{ok,refreshed,pausedReads,skipped,failed,hasMore,alerts:[{kind,key}],reauth:[{key,since,activeCampaigns}]}`, never pauses (#258, #758) #1838: a Meta throttle (Graph 4/17/32/613/80000–80014) is not a failure: that business is skipped for the run (`throttled: [{key|businessId, scope, retryAfterMs}]`), and app scope (code 4) stops the run |
| GET | `/api/cron/owner-daily-results` | Cron Bearer auth | #1022: the daily WhatsApp results line. Acts only with `OWNER_ALERTS_ENABLED` and between 09:00 and 12:00 IST; at most one line per opted-in owner per day (yesterday in IST, #783's per-ad numbers, read-only on Meta); `{ok,day,sent,outcomes:[{businessId,result}]}` or `{ok,skipped}`; a per-owner failure doesn't fail the run |
| GET | `/api/cron/payment-health` | Cron Bearer auth | Razorpay webhook counts for the live account (`events7d`, `unprocessed`, `capturedWithoutEvent`); `ok:false` when a capture lacks its webhook event; read-only |
| GET | `/api/cron/pilot-readiness` | Cron secret | `{ok, missing:[{name, state, why}]}`: production settings a pilot needs that are missing or off (#1875); names only, never values |
| GET | `/api/cron/plan-links` | Cron secret | #718: `{ok,enabled,checked,created,failed}`; reconciles payable open links immediately for lost paid webhooks, recovers expiry after the 30-day link lifetime and a cancelled link at any age (#2074), and creates a link only when needed. Uses the provider capture timestamp. No-op while `PLAN_BILLING_ENABLED` is off |
| GET | `/api/cron/scheduler-health` | Cron Bearer auth | Read-only watchdog (#274): per job (`enforce-spend`, `sync-leads` every 15 min; `refresh-results` must succeed hourly) minutes since the last run and last successful run, from logged `http.request` events; `overdue` after twice the interval without a success; `ok:false` when any job is overdue |
| GET | `/api/cron/meta-parent-health` | Cron Bearer auth | Read-only 2-Tier parent token check (#520): `GET /me` and the parent business with `META_PARENT_SYSTEM_TOKEN`; `{ok:true, configured:false}` when unset, `{configured, enabled, ok, businessVerified}` when it works, 503 with a Meta `errorCode` only when refused |
| GET | `/api/cron/managed-health` | Cron Bearer auth | Read-only 2-Tier watchdog (#527): `{ok, accounts, byState, stuck:[{state, minutes, key}]}`; stuck = a non-final state (not `ready`/`offboarded`; `failed` included) unchanged for over 30 min; opaque 12-hex keys, no IDs |
| GET | `/api/cron/campaign-reconciliation` | Cron Bearer auth | Read-only Launch watchdog (#734): `{ok, waiting, stuck:[{key, minutes}]}`; stuck = a `campaign_operations` row in `needs_reconciliation` for over 30 min; opaque 12-hex keys (sha256 of the id), no IDs; 503 without details |
| GET | `/api/cron/access-requests` | Cron Bearer auth | Read-only (#692, #725): outside owners who asked for Facebook access in the last 7 days (the `meta.access_request` audit record, plus the older `ui.action` beacon), listed team ids excluded; at most 10 account lookups a run, newest first: `{ok, requests:[{key, hours}], more}` (`more` = outside requests left for the next run); one opaque 12-hex key per user (sha256 of the user id), no IDs |
| POST | `/api/meta/access-request` | Signed-in owner | **Ask for Facebook access** (#725): `{businessId}` → writes a `meta.access_request` audit record (owner checked by `append_verified_audit_event`), once per user per UTC day → `{ok:true}`; the page says "Request sent" only after this; 400 bad body, 401, 404 not your business, 503 not recorded (retry) |
| GET | `/api/cron/core-scoreboard` | Cron Bearer auth | Read-only daily core scoreboard (#681): `?hours=` 1–168 (default 24) -> `{ok, hours, since, until, excluded:{events, aiCalls}, rows:[{step, now, target, met}], markdown}`; smoke left out by `smokeUserIds` in `src/lib/internal-accounts.json` (user first, the businesses it owns for background rows); aggregates only, no IDs; 400 bad window, 503 without details |
| GET | `/api/cron/llm-credit` | Cron Bearer auth | Read-only OpenRouter credit (#449): `{ok, keys:[{index, limitUsd, remainingUsd, error?}], minRemainingUsd, thresholdUsd:1, low, health:[{name, provider, status, detail}], dead:[name], models:[{provider, model, status, detail}], retired:["provider model"]}` (#1569: every configured AI key probed on a free endpoint, by env name; #1808: every configured model id checked against its provider's /models list); never returns keys; 503 when OpenRouter refuses a key |
| POST | `/api/internal/meta-traffic` | Bounded runner options | Allowlisted diagnostic reads; creation mode disabled |

## Product Analytics Ingestion

`POST /api/events` requires an authenticated same-origin session; identity and
business context come from the server. The strict payload always includes a known
workspace `page` and optionally `viewport` (`compact`, `medium`, `wide`). Existing
names `page.view`, `client.error` and `client.rejection` remain supported.
`ui.action` additionally requires an allowlisted `action`; `ui.tap` (#1242) carries only a
launch-path `page` (`/create`, `/studio`, `/campaigns`); `page.engagement`
requires integer `durationMs` between 1000 and 3600000. Unknown fields, arbitrary
labels and client identity overrides are rejected. No request/field content is
captured. DNT/GPC, 2 KiB body limits, rate limiting and 204 responses are preserved.
Action intent is not authoritative success. See [collection and retention](../operations/observability.md)
for the fixed action catalog, privacy controls and operator-only analytics queries.

## Jobs and Telemetry

Cron endpoints require `Authorization: Bearer <CRON_SECRET>`; absent configured
secret disables them with 404. Keepalive checks DB availability and, when enabled,
bounded event retention. Enforce-spend can mutate Meta and reports incomplete
enforcement as 503 (`ok:false`) even when some campaigns were paused; failure to
read the limit list returns 502; failure to scan active campaigns returns 503.
`swept` lists only confirmed remote and local
pauses, not a guarantee that every campaign stopped. Do not invoke either against
production without authority.

Internal traffic options: numeric `rounds` clamped to 1/configured maximum
(default 5), boolean `createDraftCampaigns` (true rejected with 400), numeric
`campaignsPerRound` clamped 1-3 (default 1; no creation while disabled). Production
requires an email allowlist. Return includes per-round read counts/errors; at least
one successful call yields 200, none yields 502. Partial success is not full health.

Events body is strict `{name,page}`. Name: `page.view`, `client.error`, or
`client.rejection`; page: one of the eight workspace paths in the workflow guide.
Requires authenticated same-origin request; honors DNT/GPC. Limit 2 KiB streaming
body (413 if exceeded), 60/minute/user. Normally 204; disabled logging also returns
204. Client events are untrusted signals, not evidence of a server mutation.
