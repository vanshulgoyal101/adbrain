# API and Mutation Reference

This is the current application API, not a versioned public integration service.
Paths are relative to the configured app origin. Examples use synthetic IDs;
replace them only in an authorized isolated environment. Source: [route handlers](../src/app/api/),
[campaign schemas](../src/lib/campaign/connect-contracts.ts),
[connection schemas](../src/lib/meta/connect-contracts.ts).

## Product Analytics Ingestion

`POST /api/events` requires an authenticated same-origin session; identity and
business context come from the server. The strict payload always includes a known
workspace `page` and optionally `viewport` (`compact`, `medium`, `wide`). Existing
names `page.view`, `client.error` and `client.rejection` remain supported.
`ui.action` additionally requires an allowlisted `action`; `page.engagement`
requires integer `durationMs` between 1000 and 3600000. Unknown fields, arbitrary
labels and client identity overrides are rejected. No request/field content is
captured. DNT/GPC, 2 KiB body limits, rate limiting and 204 responses are preserved.
Action intent is not authoritative success. See [collection and retention](OBSERVABILITY.md)
for the fixed action catalog, privacy controls and operator-only analytics queries.

## Conventions

- Workspace endpoints normally require the Supabase session cookie and enforce
  business ownership. There is no general application API-key authentication.
- `id` in a URL is usually an **AdBrain database ID**, not a Meta ID. Provider IDs
  remain strings. `businessId` is the application UUID; ad account IDs use `act_`.
- JSON requests use `Content-Type: application/json`. Do not stringify numbers or
  booleans; query strings are parsed separately. Strict schemas reject unknown
  fields where noted. Not every older route uses a strict schema.
- Money is whole INR rupees at the application boundary unless specified. Budget
  estimates are not invoices or guaranteed spend.
- HTTP 200 alone does not prove a business operation completed. Inspect `ready`,
  blockers, partial failures, and operation state.
- Retain request IDs for diagnosis, never tokens/cookies or sensitive bodies.
  Instrumented routes expose `X-Request-Id` where the response is mutable.

### Response Families

Connection, draft, preflight, and creation-operation APIs use a typed envelope:

```json
{
  "ok": false,
  "error": {
    "code": "CONFLICT",
    "message": "Draft changed in another tab. Reload before saving.",
    "retryable": true
  },
  "requestId": "00000000-0000-4000-8000-000000000001"
}
```

Success is `{ "ok": true, "data": <documented value>, "requestId": <UUID> }`.
Older APIs use plain objects, often `{error: string}` on failure. ZIP/Markdown
routes return files. Events can return an empty body. Do not apply one parser to
every endpoint. A `retryable` error can still require re-reading state before retry.

Common statuses: 400 invalid/blocked input, 401 unauthenticated, 403 forbidden,
404 unavailable owner-scoped resource, 409 stale/recovery conflict, 410 retired,
422 semantic input rejection, 429 quota/rate limit, 502 provider failure, 503
dependency unavailable. Exact mapping is route-specific; some legacy ownership
failures use 400. A 404 does not reveal another tenant's existence.

## Route Inventory

`Envelope` means the typed family above; `plain` means route-specific JSON.

| Method | Path | Input / result | Effect |
| --- | --- | --- | --- |
| POST | `/api/brand/autofill` | URL -> plain extraction | Website fetch + model call, no brand save |
| POST | `/api/creatives/assistant` | Interview -> question/brief | Model call |
| POST | `/api/creatives/generate` | Generation input -> saved variants/failures | Paid work + Storage/DB |
| GET | `/api/creatives/generate` | Business/group/count -> saved status | DB lookup/unknown-ID fence, no generation |
| POST | `/api/creatives/[id]/regenerate` | No body -> `{creative}` | Paid work, overwrite, reset approval |
| POST | `/api/creatives/export` | IDs -> ZIP | Downloads selected media |
| GET | `/api/campaign-drafts` | `businessId` -> envelope draft array | Owner-scoped read |
| POST | `/api/campaign-drafts` | DraftInput -> envelope draft | DB write, no model or Meta creation |
| GET | `/api/campaign-drafts/[id]` | Path ID -> envelope draft | Read |
| PUT | `/api/campaign-drafts/[id]` | Version + input -> envelope draft | Versioned write |
| DELETE | `/api/campaign-drafts/[id]` | `version` query -> envelope `{deleted:true}` | Retention-aware delete |
| POST | `/api/campaigns/plan` | Goal/answers/optional audience draft -> plain result | Model; can save a draft |
| POST | `/api/campaigns/preflight` | Draft ID/version/business -> envelope review | Provider verification, no campaign creation |
| POST | `/api/campaigns/create` | Reviewed identifiers -> envelope operation | Worker mode enqueues (202); inline mode creates paused remote objects |
| GET | `/api/campaigns/list` | `businessId`, optional opaque `cursor`, `query` (max 200), `status` -> `{campaigns,results,nextCursor}` | Owner-scoped, at most 50 rows; latest stored result per returned campaign |
| GET | `/api/campaigns/operations` | Business/key -> envelope operation or null | Recovery read; can expire stale leases |
| GET | `/api/campaigns/operations/[id]` | Path ID -> envelope operation | Recovery read; can expire stale leases |
| GET | `/api/campaigns/[id]` | Path ID -> `{delivery}` | Owner-scoped, uncached Meta campaign/ad-set/ad review; no spend reservation or mutation |
| PATCH | `/api/campaigns/[id]` | Pause/activation input -> `{ok,status,delivery}` | Live parent Meta mutation + local mirror; activation uses customer reservation |
| DELETE | `/api/campaigns/[id]` | No body -> `{ok,metaDeleted}` | Live deletion then local deletion |
| POST | `/api/campaigns/[id]/refresh` | No body -> insights/result/summary/autoPaused/protectionConfirmed | Provider read, DB write, possible auto-pause |
| POST | `/api/campaigns/sync` | Optional `after` -> campaigns/skipped/nextCursor/pageCursor | Provider read + local imports; `nextCursor` continues Meta discovery, `pageCursor` continues the bounded display list |
| GET | `/api/campaigns/lead-forms` | No body -> `{forms}` | Active forms on bound Page |
| GET | `/api/campaigns/report` | No body -> Markdown attachment | Stored performance read |
| POST | `/api/leads/sync` | No body -> leads/imported/failedForms | Provider read + deduplicated inserts |
| POST | `/api/spend-limits` | Complete settings -> `{ok:true}` | DB write |
| GET | `/api/preferences` | `businessId` -> `{enabled,epoch,notes}` | Authenticated owner-scoped read, no cache |
| POST | `/api/preferences` | Versioned mutation -> `{enabled,epoch,notes}` | Owner-scoped opt-in/save/forget/pause/clear |
| GET | `/api/meta/geo-search` | `q` -> `{results}` | Provider search |
| POST | `/api/meta/connections/start` | Business/intent -> envelope authorization URL | New connection attempt/cookie |
| GET | `/api/meta/connections/status` | `businessId` -> envelope connection | Current binding/capabilities |
| GET | `/api/meta/connections/attempts/[id]` | Path ID -> envelope attempt | Poll owned attempt |
| POST | `/api/meta/connections/attempts/[id]/retry` | `revision` -> envelope attempt | Retry eligible failed discovery |
| POST | `/api/meta/connections/attempts/[id]/select` | Pair/revision/confirmation -> envelope result | Commit verified connection |
| POST | `/api/meta/connections/recheck` | Business/optional generation -> envelope connection | Live capability recheck |
| POST | `/api/meta/disconnect` | Explicit business, or legacy empty body -> `{ok:true}` | Disconnect stored binding, not running ads |
| GET | `/api/meta/oauth/start` | Retired | 410; use contextual start |
| GET | `/api/meta/oauth/callback` | Provider callback | Signed/bound OAuth completion and redirect |
| GET | `/api/meta/accounts` | Owned `businessId` | Retired discovery, 410 after validation |
| POST | `/api/meta/connect` | Business/account/Page | Retired selection, 410 after validation |
| POST | `/api/meta/deauthorize` | Verified `signed_request` | Revoke subject's connections |
| GET/POST | `/api/payments/live/orders` | Owner-scoped order read / accepted terms and idempotent create | Requires enabled production collection; no ad activation |
| POST | `/api/payments/live/verify` | Signed provider payment proof | Reconcile capture; no ad activation |
| POST | `/api/payments/live/webhook` | Signed Razorpay event | Idempotent capture/refund reconciliation |
| GET/POST | `/api/payments/live/reconcile` | Owner-scoped recovery | Reconcile uncertain provider state |
| GET/POST | `/api/payments/live/operator` | Operator-authorized refund/review | Financial action; separate authorization required |
| GET/POST | `/api/payments/customer-balance` | Owner balance/review or operator accounting evidence | No provider charge, refund or ad activation |
| GET/POST | `/api/payments/test/orders` | Test order read/create | Nonproduction only; isolated test gateway |
| POST | `/api/payments/test/verify` | Test payment proof | Nonproduction only |
| POST | `/api/payments/test/webhook` | Test signed event | Nonproduction only |
| POST | `/api/events` | Fixed client event | Optional telemetry, normally 204 |
| GET | `/api/cron/keepalive` | Cron Bearer auth | DB health and optional telemetry pruning |
| GET | `/api/cron/enforce-spend` | Cron Bearer auth | Can pause live campaigns |
| POST | `/api/internal/meta-traffic` | Bounded runner options | Allowlisted diagnostic reads; creation mode disabled |

### Configurable Live Payments

The effective quote is returned by the order-list route; each saved order retains
its own `quote` and accepted policy. `amountPaise` and provider checkout `amount`
equal the saved `quote.totalPaise`, even after configuration changes. Normal
annual quotes retain their original allocation; pilot verification quotes carry
zero service/ad allocation and a `verificationAllocationPaise` equal to the total.
The eligible owner may refresh a verification quote before creating an order,
but an existing order cannot be repriced or replaced while unresolved. Captures
and refunds use saved amounts, and the one-time verification order remains visible
ahead of recent annual orders. See [configuration and restoration](CONFIGURATION.md#configurable-live-amounts).

For an eligible pilot without a saved verification order, GET returns
`verificationAmountRange: {minPaise:100,maxPaise:<configured ceiling>}`; otherwise
it is null. GET accepts optional `verificationAmountPaise` for a read-only quote
within that range. POST accepts the same integer alongside the returned
`termsHash` and explicit acceptance. Neither permits a client-selected annual
price. Owner, expiry, ceiling and consent changes fail closed; a saved
verification order cannot be repriced. Without an amount parameter, reads recover
the saved eligible verification quote rather than replacing it with the default.

### Customer Advertising Allowance

The additive [customer allowance migration](../db/migrations/20260926_customer_ad_allowance.sql)
does not enable collection or authorize Meta spending. Test payments give no
credit. Owners can review their balance with `GET /api/payments/customer-balance`
using `businessId` and optional `campaignId`. Financial operators can submit
strict `costs` or `refund-allocation` actions with
`POST /api/payments/customer-balance`; authority is rechecked in SQL. See the
[shared contracts](../src/lib/payments/customer-balance-contracts.ts).

Cost evidence uses integer paise, immutable UUIDs and cumulative lifetime
media/tax figures; stale or conflicting figures hold funds. Capturing payment
does not earn service fees or activate ads. Review precedes an atomic reservation
for one campaign. Before ACTIVE, the Meta cap must be written and read back
within the reserved media allowance; unsupported or rejected caps block
activation. Provider capability for the INR 8,000 tax-inclusive offer remains
unverified. Pausing does not release a reservation: final reconciliation needs
the exact reservation UUID, a settled activation outcome and fresh cumulative
costs after confirmed pause. Uncertain outcomes retain a hold for audited
recovery, never automatic expiry.

### Authentication Handlers

These sit outside `/api` and return redirects rather than the API envelope:

| Method | Path | Input / result | Effect |
| --- | --- | --- | --- |
| GET | `/auth/callback` | `code` or `token_hash` + `type`; optional `redirect` | Exchanges/validates Supabase credentials, then redirects to safe local destination; failure -> `/login?error=auth` |
| GET | `/auth/dev-login` | No body | Disabled -> login; enabled development tries configured real login, otherwise a seven-day offline development cookie |
| GET | `/auth/dev-logout` | No body | Clears offline development cookie and redirects to login; not a general Supabase sign-out API |

If both completion forms are supplied, `code` takes precedence. Never put callback
codes/token hashes in example URLs, logs or screenshots. Development cookie access
does not satisfy real API ownership/authentication. Normal login methods use
Supabase Auth client APIs rather than an invented `/api/login` endpoint.

## Creative Requests

### Website Autofill

`POST /api/brand/autofill`: `{url: string}`; trimmed length 1-2048. Public URL
policy and redirect/DNS checks apply. Returns `{extraction}` with suggested brand
fields; the caller must review and save separately. Blocked URL: 400; fetch/model
failure: 502; no readable text: 422. Extraction is a model result, not a factual
verification. Website fetch deadline is 10 seconds; route duration setting is 30.

### Interview

`POST /api/creatives/assistant` uses a strict object:

| Field | Contract |
| --- | --- |
| `businessId` | Trimmed nonempty string, maximum 100; owner-scoped lookup |
| `goal` | Trimmed 1-2000 characters |
| `answers` | Default `[]`, at most 12 records for history compatibility |
| `answers[].question` | Trimmed 1-300 characters |
| `answers[].answer` | Trimmed 1-1000 characters |
| `answers[].questionId` | Optional trimmed 1-80 characters |
| `answers[].field` | Optional `objective`, `audience`, `offer`, `visual`, `tone`, `language`, `location`, `constraints` |
| `answers[].options` | Optional at most 6 strings, each 1-160 characters |
| `recentGoals` | Default `[]`, at most 6 strings, each 1-500 characters |
| `referenceBrief` | Optional trimmed 1-2000 characters for follow-up context |

The interview asks no more than three new decisions, despite accepting longer
historical input. Returns either `{ready:false, question, promptVersion}` or
`{ready:true, brief, language?, angleId?, recommendations?, promptVersion}`.
Questions carry `id`, `field`, `question`, optional help, options and input flags.
Optional recommendations contain 2-3 distinct `{label,prompt}` records.
Invalid/repetitive output receives at most one repair within a shared 45-second
deadline, then fails; it does not silently proceed to generation.

Example interview input for a synthetic business:

```json
{
  "businessId": "11111111-1111-4111-8111-111111111111",
  "goal": "Promote our saved rooftop survey offer to homeowners in Jaipur",
  "answers": [],
  "recentGoals": []
}
```

### Generate and Recover

`POST /api/creatives/generate`:

| Field | Contract |
| --- | --- |
| `businessId` | Trimmed nonempty string; owner-scoped lookup |
| `brief` | Trimmed 1-2000 characters |
| `count` | Integer 1-6, default 3 |
| `generationId` | Optional UUID; use a client-known UUID before the first POST |
| `language` | Optional string normalized through language helpers |
| `sourceFacts` | Optional array of up to 12 explicit user-authored facts, each up to 2000 characters (6000 combined); never copy an AI-generated brief or advisory preferences here |
| `format` | `portrait` (default), `square`, `story`, `landscape` |

Example paid-generation input, submitted only after brief review and authorization:

```json
{
  "businessId": "11111111-1111-4111-8111-111111111111",
  "brief": "Invite Jaipur homeowners to enquire about our saved rooftop survey offer. Use only verified brand facts and contact details.",
  "sourceFacts": ["We offer rooftop surveys in Jaipur."],
  "count": 3,
  "generationId": "22222222-2222-4222-8222-222222222222",
  "language": "en",
  "format": "portrait"
}
```

Returns `{variantGroup, creatives, failures}`. Individual saved variants survive
other failures. If none save, returns 502 with an error/failure list. Missing
generation schema or unavailable admission blocks before work with 503.
No configured text keys can return 400/`NO_LLM_KEYS`; exceeded quota returns
429/`LLM_MONTHLY_QUOTA_EXCEEDED`. Generation/regeneration declare a 300-second
route duration; host execution limits still apply.

POST atomically claims the
generation UUID and normalized request inputs before paid work. Repeating the
same ID returns 202 with `{variantGroup, status, creatives: [], count: 0,
expectedCount}` and never starts another producer. A changed brief, count,
language, format or nonempty `sourceFacts` for that ID returns 409; another business
or owner gets 404. Omitting `sourceFacts` keeps the prior hash format for existing
requests. The validator uses Brand facts, saved instructions and `sourceFacts` as
quote evidence, not the potentially model-derived `brief`. Studio submits its
directly authored brief as user evidence; Create submits the original goal and
free-text answers, excluding model-suggested options and the generated brief.
The accepted facts are stored in the generation receipt for regeneration. Existing
creatives without that field regenerate with no separate user-fact evidence.
The route reserves monthly quota for text and images, counts recorded tokens,
and retains an allowance of 10,000 quota units per completed image. This is
**not** measured image billing or a USD spend limit: image usage may lack a known
cost. Uncertain provider, usage or result writes retain their reservation until
an operator can reconcile them. A definitive whole-request pre-provider failure
can free unused quota after the batch has settled; one failed angle cannot free
its still-running siblings' hold. The failed UUID remains non-reusable. Omitted `generationId` gets
a new server UUID and cannot be replayed safely after a lost response.

Recovery uses `GET /api/creatives/generate?businessId=...&generationId=...&expectedCount=3`.
`generationId` must be UUID; optional `expectedCount` is integer 1-6 and, if
provided, must match the claimed count (409 otherwise). The source candidate
returns `{status, creatives, count, expectedCount}` based on the persisted
intent and saved rows. Status may be `processing`, `partial`, `complete`,
`failed` or `unresolved` (including stale processing after five minutes).
Unknown/foreign ID returns 404; unavailable status or row lookup returns 503.
An owner lookup returning 404 permanently fences that UUID with a zero-quota
no-spend record; a delayed original POST cannot start generation afterward.
Recovery lookups are limited to 30 per user per five minutes (429 when exceeded).
`processing` does not prove a worker is running. Inspect saved results after a
timeout; `unresolved` requires investigation, not another paid request.

`POST /api/creatives/[id]/regenerate` has no request body. It uses saved generation
settings and current business context, replaces the creative, and sets `draft`.
It has no separate durable regeneration-operation recovery endpoint.

### Export

`POST /api/creatives/export`: `{creativeIds: UUID[]}`, 1-50 entries before
deduplication. All distinct selections must be accessible (404 otherwise); DB
lookup failure is 503. Approved status is not a route requirement.

Downloads are sequential, capped at 40 MiB aggregate accepted image bytes and a
45-second shared deadline. ZIP includes `copy.txt`; missing/invalid/over-limit
images are skipped with an explanatory note. Header `X-Images-Skipped` gives the
count; filename is `adbrain-ad-pack.zip`. No raw HTML is accepted as an image.

## Campaign Draft Contract

`DraftInput` is strict and used by draft POST, update `input`, and optional planner
`audienceDraft`. A saved draft is intentionally less restrictive than preflight.

| Field | Contract |
| --- | --- |
| `businessId` | UUID |
| `name` | Trimmed 1-120 characters |
| `goal` | Trimmed 1-2000 characters |
| `mode` | `manual` or `guided` |
| `creativeIds` | UUID array, 0-50; preflight requires nonempty unique approved selections |
| `dailyBudgetRupees` | Finite integer 0-10000000; preflight requires positive |
| `leadFormId` | Null or trimmed string 1-128; preflight requires active bound form |
| `targeting` | Strict object below; `{}` can be saved but is not launch-ready |
| `abTest` | Required boolean; true produces two age-band ad sets |

### Targeting

All three top-level targeting fields are optional for draft persistence:

| Field | Contract |
| --- | --- |
| `location.mode` | Optional `ai` or `manual` |
| `location.included`, `location.excluded` | Optional arrays, maximum 50 objects each |
| Location item `key` | Trimmed provider string 1-128 |
| Location item `name` | Trimmed string, maximum 200 |
| Location item `type` | `city`, `region`, `country` |
| Location item `radiusKm` | Optional finite integer 5-80; city preflight requires 17-80 |
| `location.includedNames`, `location.excludedNames` | Optional arrays, maximum 50 trimmed strings of 1-200 characters |
| `location.radiusKm` | Optional finite integer 5-80; preflight requires 17-80 |
| `age.mode` | Optional `ai` or `manual` |
| `age.min`, `age.max` | Optional integers 18-65; preflight needs explicit ordered values and no unresolved AI mode |
| `audience.interestNames` | Required if audience supplied; 0-5 trimmed strings of 1-100 characters |
| `audience.rationale` | Required if audience supplied; trimmed 1-2000 characters |

`audience` and the top-level targeting object are strict. Interest names are not
Meta IDs. Preflight resolves them and checks targeting-option status. No silent
nationwide fallback is promised for missing or unresolved service areas.

Draft DTO: `{draftId, version, expiresAt, input}`. New version is 1, expiry seven
days from creation, cap 50 active editable drafts. PUT requires
`{expectedVersion, input}`; version is a nonnegative safe integer and must match.
Successful update increments it without renewing expiry. DELETE requires query
`version` >= 1. Operation-linked drafts are retained (409 on restricted delete).
Expired reads return 404. A failed/stale write does not imply local editor changes
were saved.

### Safe Incomplete Draft Example

This JSON is valid to **save**, not valid to create a campaign:

```json
{
  "businessId": "11111111-1111-4111-8111-111111111111",
  "name": "Service-area enquiries",
  "goal": "Invite enquiries about our local service",
  "mode": "manual",
  "creativeIds": [],
  "dailyBudgetRupees": 0,
  "leadFormId": null,
  "targeting": {},
  "abTest": false
}
```

### Planner

`POST /api/campaigns/plan` uses the primary business. Actual route fields:
`goal` trimmed 1-2000; optional `answers` string up to 12000 or array up to 30
`{question,answer}` records (maximum 1000/2000 characters); optional `audienceDraft`.
Structured answers also accept `questionId` (1-80 characters), a fixed `topic`
(`location`, `radius`, `budget`, `offer`, `audience`, `exclusions`, `creative`,
`lead_form`, `compliance`) and `disposition` (`answered` or `deferred`). A deferred
answer must have empty text. Unknown answer fields are rejected; serialized history
is capped at 12000 characters. Legacy text answers remain accepted, with wording-
based repeat checks but without the new topic identity guarantees.
This route schema differs from the older exported `planRequestSchema`; use the
handler's contract, not that unused declaration, for integration.

Returns `{ready:false,questions}` when more input/setup is needed. Without
`audienceDraft`, success is `{ready:true,draft}` and saves a guided draft. With
`audienceDraft`, success is `{ready:true,targeting}` for review, preserving manual
choices; it does not create a campaign. No approved creatives produces an
informational question without invoking generation. Model deadline is 45 seconds.

The v5 campaign interview filters covered topics and repeats, returns at most two
new questions and stops asking after six supplied decisions. One bounded correction
is allowed for invalid/no-progress model output; each attempt is accounted for.
When the interview cannot progress, it returns HTTP 200 with
`{ready:false,questions:[],handoff:{reason,message}}`, where `reason` is
`no_progress` or `interview_limit`. This response performs no draft save or Meta
mutation. Both guided and manual-audience callers surface it without losing their
existing context. Explicit audience-editor radius values are retained. See
[campaign interview and framework choice](AI_PIPELINE.md#campaign-interview).

## Review and Durable Creation

Preflight request is strict: `{businessId: UUID, draftId: UUID, draftVersion:
nonnegative-safe-integer}`. Review data includes:

| Field | Meaning |
| --- | --- |
| `draftId`, `draftVersion`, `connectionGeneration` | Reviewed concurrency identity |
| `canCreatePaused`, `blockers` | Gate and actionable blocker list |
| `planHash` | 64 lowercase hex characters, or null while blocked |
| `creativeHash` | Optional content hash used by current execution |
| `currency` | `INR` |
| `perAdSetDailyBudgetRupees`, `adSetCount`, `totalDailyBudgetRupees` | Explicit budget multiplication |
| `selected` | Verified Meta assets or null |
| `resolvedAreaLabel`, `resolvedLocation`, `resolvedExcludedLocation` | Human label and provider-resolved geography |
| `audienceInterests` | Resolved `{id,name}` entries, up to five |

Create body: `businessId`, `draftId` (UUIDs), `draftVersion`,
`connectionGeneration` (nonnegative safe integers), `planHash` (64 lowercase hex),
`idempotencyKey` (trimmed 8-200 characters). Never fabricate the hash or derive it
from an old draft; use a fresh review.

The server reruns review, claims a 60-second operation lease, checkpoints remote
IDs, and finalizes a paused local campaign. It returns an operation envelope, not
the old direct campaign result. New execution returns 200 for success or 202 for
an unresolved/failed execution result; terminal replays can return 200. Inspect
the operation `state`, not just the HTTP status.

| State | Client action |
| --- | --- |
| `pending`, `running` | Keep identity; poll, do not generate a new key |
| `succeeded` | Use `campaignId`; still paused until separate activation |
| `failed` | Inspect blockers and confirm safe recovery before new intent |
| `needs_reconciliation` | Stop automatic writes; operator/provider reconciliation required |

Operation DTO also has `operationId`, `businessId`, nullable `campaignId`, and
`blockers`. Lookup by key requires `businessId` UUID and `idempotencyKey` 1-200
characters; returns null when absent. Lookup by operation ID returns 404 if
unavailable. Status reads may durably expire an abandoned lease. A reused key
with changed request hash/generation conflicts; in-flight duplicates also conflict.

### Activation, Pause, Delete

Pause: strict `{ "status": "paused" }`.
Activation: strict `{status:"active", confirmationDigest:<64 lowercase hex>,
connectionGeneration:<nonnegative-safe-integer>}`. The digest is derived from
[the activation payload](../src/lib/campaign/activation.ts) after the owner reviews
current assets/budget and exact Meta campaign/ad-set/ad delivery snapshot from
`GET /api/campaigns/[id]`. It is not interchangeable with `planHash`. Legacy or
incomplete stored child identity requires reconciliation; the route does not guess.
GET and PATCH verify business ownership before reporting binding or child
reconciliation details.

Activation checks projected weekly cap (422 if exceeded; 503 if unreadable),
stored binding/generation, live capability, positive budget/INR currency, digest,
and exact remote child membership, settings and requested ACTIVE states before
the #49 customer reservation and again after requesting parent ACTIVE. Paused or
unexpected children and stale review return 409 before reservation. Success is
`{ok:true,status,delivery}`; `status:"active"` is a requested parent state,
not proof of effective delivery or Meta eligibility. An uncertain post-request
result holds the reservation for reconciliation. Pause/delete also verify binding.
Deletion preserves the local row when remote deletion cannot be confirmed.
Remote success followed by local failure is possible; inspect before retrying.

## Sync, Insights, Leads, and Settings

Campaign sync accepts optional query `after` of 1-2000 characters. Returns
`{campaigns,skipped,nextCursor}`. It processes one provider page, verifies bindings
and budgets, and imports only ACTIVE/PAUSED status. Local unsupported/unmatched
records remain unchanged. No remote-deletion pruning occurs. Concurrent insert
failure is not a successful import; partial writes before an error can exist.
Failed Meta binding reads return a generic 502 before local imports; only a
confirmed unmatched binding counts as skipped.

Refresh returns `{result,summary,insights,autoPaused,protectionConfirmed}`. **This
can invoke an LLM summary and pause live campaigns through spend enforcement**; it
is not a read-only smoke test. `autoPaused` lists only confirmed remote and local
pauses. `protectionConfirmed:false` means the spend decision or a required pause
could not be verified; inspect the bound campaign in Meta, since a local error
does not prove remote delivery stopped. Provider refresh failures can still attempt
protective pauses. An unsaved result returns 503 before summary and enforcement.

Lead sync returns `{leads,imported,failedForms}`; each failed form has `id,name`.
`imported` is actual new inserts, duplicates are ignored, partial unreadable forms
are reported, and all-form failure is 502. A failed count/reload after insert can
mean data was saved even though the response failed. Report export returns
`text/markdown` with dated attachment filename and uses stored primary-business
performance; it does not refresh Meta.

Spend settings are strict and complete:

```json
{"weeklyCapRupees": 5000, "alertPct": 80, "autoPause": false}
```

Cap is null or a positive integer <= 2147483647; threshold integer 1-100; autoPause
boolean. Missing fields, zero, and fractional caps return 422. Only null means
unlimited. Success `{ok:true}` does not assert that Meta account limits changed.

Preference reads require `GET /api/preferences?businessId=<owned UUID>`. The
uncached response is `{enabled,epoch,notes}`; each note has `category`, `value`,
`version` and `updated_at`. Notes stay visible to their owner while paused but
are not included in creative or campaign-planning prompts. An unconfigured
business returns `enabled:false`, `epoch:0`, and no notes.

Mutations use `POST /api/preferences` with a JSON object containing `businessId`,
`operation` (`enable`, `pause`, `save`, `forget`, `clear`), and `expectedEpoch` from
the latest read. `save` requires a category and 1-160 character value; `forget`
requires a category. The fixed categories are `copy_length`, `tone`, `language`,
`visual_style`, `layout_density`, `creative_dislikes`, and `workflow`. One current
value per category is retained. Successful mutations return the updated state.
The database rejects sensitive/financial content and unauthorized businesses;
failed content is 400, lost ownership is 403, a stale epoch is 409, and database
or reload failures are 503. A failed reload after a committed mutation may require
a refresh to determine what was saved; no best-effort memory write is reported
as confirmed.

Geo search trims `q`, truncates to 100 characters, and returns an empty array below
two characters. Up to eight results have `key,name,type,region,countryCode`.

## Connection API

Detailed lifecycle: [Meta Connection](META_CONNECT.md). Start requires nonempty
`businessId` and `intent`: `{kind:"setup"}`, `{kind:"prepare_campaign",draftId,
draftVersion}`, or `{kind:"review_activation",campaignId}`. Draft/campaign IDs are
UUIDs and version is a nonnegative safe integer. Start returns
`{attemptId,authorizationUrl,expiresAt}` and an HttpOnly browser-binding cookie.
An explicit Origin must match the configured site origin.

Example setup input (authorization does not create or activate a campaign):

```json
{
  "businessId": "11111111-1111-4111-8111-111111111111",
  "intent": { "kind": "setup" }
}
```

Poll attempt ID; select with `{pairId,revision,confirmReplacement?}`. `pairId` must
come from server candidates; revision must be a safe integer and current.
Replacement confirmation is honored only when exactly true. Retry accepts
`{revision}` for current `failed`/`action_required` attempts. Stale/ineligible
attempts return 409. Recheck accepts `{businessId,expectedGeneration?}` and returns
current connection or freshly verified capabilities; generation mismatch is 409.

Status DTO: `businessId`, `generation`, `authorization`, nullable `selected`,
`capabilities`, nullable `checkedAt`. Authorization: `disconnected`, `connected`,
`reauth_required`, `revoked`. Selected assets: `metaBusinessId` (nullable),
`adAccountId`, `accountName`, `pageId`, `pageName`, `currency`, `timezoneName`.
Each capability has `state: available|blocked|unknown` and blockers. Blockers have
`code,message,action`; recovery actions include reconnect, retry check, choose
assets, contact admin, or an HTTPS Meta link. No tokens appear in these DTOs.

Disconnect accepts `{businessId: UUID}`. A truly empty body retains primary-business
compatibility. Any supplied malformed/invalid body returns 400 with no fallback.
It returns plain `{ok:true}`, not an envelope, and does not pause remote ads.

Deauthorization is a Meta callback, not session-authenticated owner JSON. It accepts
`signed_request` via form or JSON, verifies the signature, revokes the subject,
and returns `{url:<data-deletion-page>}`. Invalid signature: 400; persistence: 503.

Retired routes are not compatibility creation paths: OAuth start returns 410;
accounts requires an owned business before 410; connect validates nonempty
business/account/Page strings up to 128 characters before 410. OAuth callback
remains active for the contextual signed/bound flow.

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

## Rate Limits and Timeouts

| Route family | Per-user request limit |
| --- | --- |
| Autofill | 15 / 5 minutes |
| Interview | 40 / 5 minutes |
| Generation | 20 / 5 minutes |
| Regeneration | 30 / 5 minutes |
| Planner | 40 / 5 minutes |
| ZIP export | 10 / 5 minutes |
| Internal traffic | 10 / 10 minutes |
| Client events | 60 / minute |

Shared DB enforcement returns 429/Retry-After for saturation and fails closed in
production if unavailable. These are not blanket limits on every route. Quota
checks and provider deadlines are separate. A timeout on a mutation is an
ambiguous result, not authorization to repeat it.

## Server Actions and Direct Persistence

These are React/Next server actions, not stable manually callable REST endpoints:

| Action | Input / behavior |
| --- | --- |
| `saveBusiness` | FormData with optional `id`, required `name`, profile/contact/brand fields; newline-delimited languages, locations, USPs, offers; owner comes from session |
| `saveInstruction` | Optional `id`; `businessId,title,content,isActive`; nonempty trimmed title; update scoped to business |
| `deleteInstruction` | `id,businessId`; affected-row confirmation required |
| `setCreativeStatus` | `id`, `draft` or `approved`; affected-row confirmation required |
| `deleteCreative` | `id`; local record deletion, not remote-ad deletion |

Actions return `{ok:boolean,error?:string}` and revalidate relevant pages.
Brand field validation lives in [validation](../src/lib/brand/validation.ts);
list parsing preserves commas in place names. Asset upload/delete and selection
also use browser Supabase/Storage APIs under RLS; see [Data Model](DATA_MODEL.md).
Do not document an invented upload REST route.