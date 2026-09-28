# API and Mutation Reference

This is an application mutation/reference guide, not a versioned public integration
service. Baseline: dev `672eb132ad57bb3ba31f118afaffddaa878b4923`. The
[availability map](FEATURES.md#source-and-availability) separates it from released
source and feature candidates. Paths are relative to the configured app origin.
Examples use synthetic IDs; execute mutations only in an authorized isolated
environment. Deciding sources: [route handlers](../src/app/api/),
[campaign schemas](../src/lib/campaign/connect-contracts.ts),
[connection schemas](../src/lib/meta/connect-contracts.ts).

## Production Payment Candidate

Repaired integration `954e44a` adds five route modules beyond this guide's original baseline.
They are default-disabled (404) and unreleased. QA accepted the three repair
deltas conditional on exact integrated CI; this is not live collection approval.
See the [separate rollout packet](qa/ops-environment-2026-09-26.md#separate-payment-integration-and-rollout-packet)
and [exact request/response contracts](qa/dev2-devc-contract-o1.md#api-delta-for-integration).

| Method | Route | Contract |
| --- | --- | --- |
| GET, POST | `/api/payments/live/orders` | Owned persisted orders/quote/policy; immutable intent and accepted terms before provider creation |
| POST | `/api/payments/live/verify` | Stored-order signature plus authoritative capture verification |
| POST | `/api/payments/live/reconcile` | Recover existing owned order/payment/refund state without recreating uncertain writes |
| POST | `/api/payments/live/webhook` | Signed bounded raw body; durable event storage before acknowledgment |
| GET, POST | `/api/payments/live/operator` | Approved operator queue, reconciliation and separately authorized refunds |

Authenticated writes require the exact production origin. Amounts here are integer
INR paise, not the rupee amounts of campaign budgets. Disabled routes never grant
collection authority; captured allocations grant no campaign spend/activation.
Issue #48 adds `operator-managed-v1` with `fundingMode: "operator_managed"` and
the [recorded owner approval](https://github.com/vanshulgoyal101/adbrain/issues/48#issuecomment-5848530300).
New operator-managed creation, display and replay do not query automatic funding
or require Meta onboarding. Stored `funding_evidence_id` is null for this mode;
legacy policies retain their original non-null evidence and funding validation.
The additive [policy migration](../db/migrations/20260926_production_payment_policy_v2.sql)
must follow the original payment migration before this candidate serves traffic.

Create remains `{businessId,idempotencyKey,termsHash,acceptTerms:true}`: fetch the
current quote/policy, show the approved service/invoice/refund terms and obtain
hash-bound acceptance. Server amount, tenant/merchant identity and capture/refund
checks are unchanged. Test captures never create customer advertising credit.
Old orders remain readable/reconcilable with their original terms; changing policy
does not rewrite a saved unpaid order or authorize a replacement payment.

The configurable-price source adds a saved `quote` to each order response and
returns the effective current quote at list level. Both `amountPaise` and provider
checkout `amount` equal that order's saved `quote.totalPaise`; clients cannot set
an annual amount. `operator-managed-priced-v1` binds the quote and, for verification,
the exact owner/business/expiry into the accepted policy hash. Quote versions are
`inr-annual-total-v1` (unchanged default), `inr-annual-configurable-v1`, and
`inr-payment-verification-v1`. Verification has zero service/ad allocation and
`verificationAllocationPaise` equal to its total. Captures and refunds use saved
amounts even after configuration changes. The bounded list retains the one-time
verification order before recent annual orders, so completion cannot age out.
Read [configuration and restoration](CONFIGURATION.md#configurable-live-amounts)
before rollout; this addition is not evidence that INR 10 is enabled in production.

For an eligible pilot with no saved verification order, GET returns
`verificationAmountRange: {minPaise:100,maxPaise:<configured ceiling>}`; otherwise
it is null. GET accepts optional `verificationAmountPaise` to obtain a read-only
custom quote within that range. POST accepts the same optional integer field
alongside the returned `termsHash` and explicit acceptance. Neither accepts a
client-selected annual price. Owner/expiry/ceiling violations fail closed and
changed consent or attempts to reprice a saved verification order are rejected.
Without an amount parameter, reads recover the saved eligible verification quote,
not a replacement at the default price. No additional migration is needed beyond
the configurable-quote migration.

Accounting consumers use the existing private order/effect IDs, business scope,
quote, captured/refunded/provider-reported-refund amounts and review/refund holds
through their service-only interfaces. The INR 2,000 service allocation is not
earned at capture. Checkout still returns `spendablePaise: 0` and
`canActivateCampaign: false`; customer accounting/reservations are a separate #49
integration. This candidate does not establish a Meta balance or perform a transfer.

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

### Recovery Identities

| Value | Scope and correct recovery |
| --- | --- |
| Generation UUID | Groups saved variants; GET before considering another paid POST, not durable deduplication |
| Draft ID/version | Versioned local input; reload on conflict, save then review again |
| `planHash` | Server review of current inputs, creative content and verified binding; never synthesize it |
| Connection generation | Invalidates stale binding-dependent work after connection changes |
| Attempt revision | Optimistic concurrency for one consent/discovery attempt, not a campaign version |
| Creation idempotency key | Durable operation identity; retain it across ambiguous create responses |
| Activation digest | Confirms current activation inputs; not a creation key or spend reservation |
| Cursor | Continue only the matching list/provider scan; do not exchange campaign list, Meta discovery and enquiry cursors |

A mutation timeout is ambiguous. Inspect persisted/provider evidence using the
same identity; do not change a key or clear local recovery data to force progress.

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
| GET | `/api/leads` | Bounded filters/cursor -> `{leads,nextCursor,total}` | Owned saved enquiries only |
| PATCH | `/api/leads/[id]` | Status/note -> `{lead}` | Owned local follow-up only |
| POST | `/api/leads/sync` | Optional `{syncId}` -> leads/imported/failedForms/sync | Bounded provider pages + atomic deduplicated inserts/checkpoints |
| POST | `/api/spend-limits` | Complete settings -> `{ok:true}` | DB write |
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
| POST | `/api/payments/test/orders` | Business UUID + idempotency UUID -> stored test order/checkout configuration | Local-only synthetic Razorpay test order; no real collection or ad credit |
| GET | `/api/payments/test/orders` | `orderId` UUID -> owned test-order status | Local-only owner-scoped read |
| POST | `/api/payments/test/verify` | Local order UUID, payment ID, signature -> verified test state | Provider read + durable test observation; no settlement/credit |
| POST | `/api/payments/test/webhook` | Raw signed Razorpay notification | Test merchant/provider verification + durable observation; no session cookie required |

### Local Test Payments

These routes are disabled by default and unavailable in production Node mode or
any Vercel environment. They require the explicitly enabled test configuration,
loopback Supabase and optional test-order migration in the
[payment implementation receipt](PAYMENTS-PLAN.md#9-implementation-receipt).
The gated Settings checkout now consumes these APIs using Razorpay's hosted
script and business-scoped session recovery. Money in this API is integer paise, unlike campaign
budget inputs. Every response with an order keeps zero spendable funds and denies
campaign activation.

Creation accepts only `{businessId: UUID, idempotencyKey: UUID}`. The fixed test
amount is 1,000,000 paise; browser amounts/pricing are rejected. It returns 201
for a newly persisted provider order or 200 for the stored idempotent replay.
`orderId` is the local UUID. When `status=created`, `checkout` contains the public
test key, provider order ID, amount/currency and test-only description; otherwise
it is null. Never retry unknown creation with a new idempotency key.

Verification accepts `{orderId: UUID, paymentId: string, signature: string,
providerOrderId?: string}`. New checkout callbacks send the provider order ID as
well; older saved callbacks remain compatible. If supplied, it must match the
server-owned order or verification returns 400 before provider access. The HMAC
always uses the stored provider order ID, never trusts the callback as authority.
Both authenticated mutation endpoints require a matching `Origin` header and are
rate limited. The database checks business ownership. Verification checks HMAC
against the stored provider order and fetches payment/order state with test keys.
Authorization alone stays pending; refunds/inconsistent evidence are held.

Webhook input is at most 65,536 bytes and read within five seconds. Verify the
`X-Razorpay-Signature` on exact raw bytes and `account_id` against configuration.
Supported events (`payment.captured`, `payment.authorized`, `payment.failed`,
`refund.processed`, `order.paid`) require `X-Razorpay-Event-Id` and a payment
reference. The receiver fetches current provider evidence and persists the
observation before HTTP 200. Unmatched orders/provider/DB failures return 503;
other signed events are explicitly ignored. No financial journal posting occurs.

Test states are `creating`, `created`, `captured`, `needs_reconciliation`.
An interrupted create can remain `creating`; there is no automatic reconciliation
worker yet. Conflicting events and refund holds cannot be cleared by late capture
replays. All routes use no-store responses. Misconfiguration returns 404;
invalid signatures/inputs return 400, cross-origin mutations 403, unowned orders
404, changed order/merchant bindings 409, oversized bodies 413, and unavailable
verification/persistence 503. No endpoint issues refunds or moves real money.

The UI persists its idempotency key before creation and callback proof before
verification. Reload checks the same order; dismissal or uncertain outcomes do
not start another payment. Only server-confirmed capture enables a new test.
Without a delivered webhook or retained callback, status may remain pending;
this UI adds no background provider reconciliation endpoint.

### Customer Advertising Allowance

Issue #49 candidate only; installing source does not enable delivery. Apply the
[customer allowance migration](../db/migrations/20260926_customer_ad_allowance.sql)
after the production-payment and trusted-campaign migrations. DevOps owns the
canonical schema copy and target rollout; existing test payments never give credit.

| Method | Path | Authority and result |
| --- | --- | --- |
| GET | `/api/payments/customer-balance?businessId=<uuid>` | Current business owner; `{balance}` with captured/refunded, service/ad allocations, media/tax costs, reservations, remaining paise and hold reason; no-store |
| GET | `/api/payments/customer-balance?businessId=<uuid>&campaignId=<uuid>` | Same owner; checks stored campaign binding, budget and fresh costs without creating a reservation |
| POST | `/api/payments/customer-balance` | Same-origin authenticated financial operator, verified again in SQL; explicit cost or refund-allocation evidence, never a provider charge/refund |

GET returns 400 for invalid identifiers, 401/403/404 for failed access, 429 for
rate limits, 503 for campaign access failure and 409 for unavailable/held accounting.
Reads allow 60 requests per minute per user. POST allows 20 per five minutes;
invalid structured input is 400, wrong origin 403, missing session 401 and rejected
financial evidence/authority 409. Errors do not disclose underlying financial rows.

POST strict actions are `{action:"costs",businessId,evidence}` and
`{action:"refund-allocation",businessId,allocation}`. Exact fields are in
[the shared contracts](../src/lib/payments/customer-balance-contracts.ts).
Use integer paise and immutable evidence UUIDs. Cost evidence must identify the
campaign, Meta account/generation, cumulative media and tax, actual tax-rate basis
points and observation time. Do not submit a reporting-period total as lifetime
cost or invent a zero/tax rate. Replaying identical evidence is idempotent;
conflicting identity, decreasing fresh totals, stale or ambiguous data holds funds.
Refund allocations must match verified provider refunds. Service remains unearned
at capture; earning requires operator-attested delivery of agreed creatives/setup.

Review precedes a separate execution-time atomic reservation. The initial
one-campaign offer reserves all remaining advertising allocation and needs seven
days of reviewed daily budget including the recorded tax rate. Weekly limits
cannot override this boundary. Before ACTIVE, the Meta client sets and reads back
a finite media cap within that reservation, retaining a lower existing cap.
Meta documents a US$100 approximate-local-equivalent minimum and capability
restrictions: unsupported/rejected limits block activation, never raise customer
funding. Compatibility with the approved INR8000 tax-inclusive offer is not yet
provider-verified. See the [official campaign reference](https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/).

Pause remains available when accounting fails. It does not release money. A pause
during in-flight activation cannot finalize the reservation; after the request
settles, pause again and submit final cumulative costs observed after that confirmed
pause. Final reconciliation closes the exact reservation UUID and releases only
unused funds. Unknown outcomes retain credit reservations. Process death or failed
outcome persistence leaves a hold requiring audited operator recovery; no automatic
expiry/release or generic force-clear API is implemented. Conflicting cost evidence
also remains held rather than silently reset. External Meta changes, late provider
effects and actual tax liabilities still require operator reconciliation; these
local checks are not provider-delivery certification.

### Lead Sync

An empty POST starts an import or resumes the current binding's unfinished run.
`{syncId: "<uuid>"}` resumes that exact run; business, owner, Page, ad account and
connection generation are derived and checked server-side, including each save.
Foreign/missing runs return 404; a stale writer or changed binding returns 409.
After reconnecting, use an empty POST to start under the new binding.

`sync` is `{id, state: "complete" | "partial", hasMore}`. Continue with the same
ID while `hasMore` is true. Partial work is never an up-to-date claim. Successful
pages stay saved when discovery, another form, a later page or a subsequent save
fails. Provider failures retain their continuation; unavailable forms appear in
`failedForms`. All attempted reads failing returns 502; save/read uncertainty
returns 503 with known progress, not an empty successful inbox.

`imported` counts newly inserted rows verified during this request, never fetched
duplicates or a cumulative total. Existing source, campaign attribution and
owner-managed follow-up values are not overwritten. `leads` is a compatibility
snapshot of at most 200 saved rows, not the complete inbox/list API.

Each request allows at most 24 form/lead page calls (200 items per page), at most
three concurrent lead reads, and a 40-second provider deadline. Checkpoint and
snapshot calls have three-second timeouts. Form discovery and pending forms are
interleaved; failed forms remain queued without blocking other accessible forms.
Only opaque cursors are saved; provider `paging.next` URLs are never followed.
Legacy array helpers throw after 100 pages instead of silently truncating.

Apply [the sync migration](../db/migrations/20260926_lead_sync_progress.sql) after
the existing Meta connection and leads tables, before deploying this route. It
adds service-only progress/RPCs and does not modify existing lead columns. The
combined #34/#35 candidate includes these objects and follow-up fields in
[the canonical fresh schema](../db/schema.sql). Existing databases require both
the sync and follow-up migrations before their respective callers. Fresh schema
application and incremental upgrade are alternative setup paths, not a command
to replay every migration over an initialized database.
Application rollback may leave this additive migration installed. Production
migration execution requires separate approval.

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
| `format` | `portrait` (default), `square`, `story`, `landscape` |

Example paid-generation input, submitted only after brief review and authorization:

```json
{
  "businessId": "11111111-1111-4111-8111-111111111111",
  "brief": "Invite Jaipur homeowners to enquire about our saved rooftop survey offer. Use only verified brand facts and contact details.",
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

In the #54 source candidate (not yet production), POST atomically claims the
generation UUID and normalized request inputs before paid work. Repeating the
same ID returns 202 with `{variantGroup, status, creatives: [], count: 0,
expectedCount}` and never starts another producer. A changed brief, count,
language or format for that ID returns 409; another business or owner gets 404.
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
| `leadFormId` | Null or trimmed string 1-128; instant-form preflight requires an active bound form |
| `destination` | Optional `instant_form` or `whatsapp`; absent means instant form; WhatsApp requires verified Page-linked Business number instead of a form |
| `targeting` | Strict object below; `{}` can be saved but is not launch-ready |
| `abTest` | Required boolean; true produces two age-band ad sets |

### Targeting

Top-level `gender`, `location`, `age` and `audience` are optional for persistence:

| Field | Contract |
| --- | --- |
| `gender` | Optional `all`, `men`, `women`; omitted preserves the default all-genders behavior |
| `location.mode` | Optional `ai` or `manual` |
| `location.cityScope` | Optional `city_only` or `radius`; omitted legacy drafts retain radius behavior |
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
This route schema differs from the older exported `planRequestSchema`; use the
handler's contract, not that unused declaration, for integration.

Returns `{ready:false,questions}` when more input/setup is needed. Without
`audienceDraft`, success is `{ready:true,draft}` and saves a guided draft. With
`audienceDraft`, success is `{ready:true,targeting}` for review, preserving manual
choices; it does not create a campaign. No approved creatives produces an
informational question without invoking generation. Model deadline is 45 seconds.

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
| `destination`, `whatsappNumber` | Optional destination and nullable verified international number; current review binds them to creation |

Create body: `businessId`, `draftId` (UUIDs), `draftVersion`,
`connectionGeneration` (nonnegative safe integers), `planHash` (64 lowercase hex),
`idempotencyKey` (trimmed 8-200 characters). Never fabricate the hash or derive it
from an old draft; use a fresh review.

The server reruns review, claims a 60-second operation lease, checkpoints remote
IDs, and finalizes a paused local campaign. It returns an operation envelope, not
the old direct campaign result. New execution returns 200 for success or 202 for
an unresolved/failed execution result; terminal replays can return 200. Inspect
the operation `state`, not just the HTTP status. In `CAMPAIGN_EXECUTION_MODE=worker`,
the request enqueues the persisted operation and returns 202; queue failure is 503
without inline fallback. Invalid configured mode is 503. This depends on the
[operation/queue migrations](DATA_MODEL.md#migration-map) and a separately operated worker.

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
`{campaigns,skipped,nextCursor,pageCursor}`. `nextCursor` continues Meta discovery;
`pageCursor` continues the bounded saved list. It processes one provider page, verifies bindings
and budgets, and imports only ACTIVE/PAUSED status. Local unsupported/unmatched
records remain unchanged. No remote-deletion pruning occurs. Concurrent insert
failure is not a successful import; partial writes before an error can exist.

Refresh returns `{result,summary,insights,autoPaused,protectionConfirmed}`. **This
can invoke an LLM summary and pause live campaigns through spend enforcement**; it
is not a read-only smoke test. `autoPaused` lists only confirmed remote and local
pauses. `protectionConfirmed:false` means the spend decision or a required pause
could not be verified; inspect the bound campaign in Meta, since a local error
does not prove remote delivery stopped. Provider refresh failures can still attempt
protective pauses. An unsaved result returns 503 before summary and enforcement.
A snapshot write error or missing saved row returns 503 (`Could not save refreshed
results. Retry the refresh.`); resolve storage availability before retrying. A
successful retry can still trigger summary and protective pause side effects. See
the [deciding handler](../src/app/api/campaigns/%5Bid%5D/refresh/route.ts).

Lead sync returns `{leads,imported,failedForms,sync}`; each failed form has `id,name`.
`imported` is actual new inserts, duplicates are ignored, partial unreadable forms
are reported, and all-form failure is 502. A failed count/reload after insert can
mean data was saved even though the response failed. Report export returns
`text/markdown` with dated attachment filename and uses stored primary-business
performance; it does not refresh Meta.

The saved inbox uses `GET /api/leads`, not the sync response as its full list.
Filters are `query` (up to 200 characters), `status` (`all`, `new`, `contacted`,
`qualified`, `booked`, `closed`), `contact` (`all`, `ready`, `missing`), `sort`
(`newest`, `oldest`, `name`), `limit` (1-100, default 50), and an opaque `cursor`.
The server derives the primary business. Cursors are bound to business/filters;
dates retain microsecond precision, null dates/names sort last, and UUID breaks
ties. `total` counts all matching saved records, not just the returned page.
Responses are private/no-store. Invalid filters return 400; unavailable reads 503.

`PATCH /api/leads/[id]` accepts only `workflow_status` and/or `follow_up_note`
(maximum 2000 characters). Empty updates and protected/source fields return 400;
foreign/missing rows return 404. No outreach or provider write occurs. The
additive [follow-up migration](../db/migrations/20260926_lead_follow_up.sql) must
precede these routes; existing rows default to `new` and an empty note. Migration
publication is not permission to apply it to production.

The combined inbox consumes the #34 sync contract `{id,state,hasMore}` and sends
`syncId` to resume recorded partial work. It refreshes its current list filters
after sync/save. It does not claim up-to-date without explicit complete status
and no remaining work/failures. Independent combined-workflow acceptance remains
a release gate; local author checks are not production verification. Legacy
responses remain readable but do not certify completion. The existing focused
database command now checks owner follow-up save -> checkpoint re-import ->
filtered list recovery on both fresh and upgraded schemas, alongside cursor,
tenant and atomic-progress checks.

Spend settings are strict and complete:

```json
{"weeklyCapRupees": 5000, "alertPct": 80, "autoPause": false}
```

Cap is null or a positive integer <= 2147483647; threshold integer 1-100; autoPause
boolean. Missing fields, zero, and fractional caps return 422. Only null means
unlimited. Success `{ok:true}` does not assert that Meta account limits changed.

Geo search trims `q`, truncates to 100 characters, and returns an empty array below
two characters. Up to eight results have `key,name,type,region,countryCode`.

### Saved Campaign Pagination

`GET /api/campaigns/list` requires an owned `businessId` UUID. Its opaque cursor
continues descending creation-time/ID ordering; optional `query` is at most 200
characters, and status is `draft`, `active`, `paused` or `completed`; omit it for
all statuses (`status=all` is invalid).
It returns at most 50 campaigns, latest stored results keyed by campaign ID, and
`nextCursor` (null at the end). It does not run provider sync or refresh insights.
The response has no global total. Changing filters starts a new first page.
See [handler](../src/app/api/campaigns/list/route.ts).

### Enquiry Candidates

These contracts are **not in the baseline route inventory or recorded production
release**. Sources: [#34 at 363859f](https://github.com/vanshulgoyal101/adbrain/tree/363859fc1195839822f60a92fda6109194a14268)
and [#35 at 6732027](https://github.com/vanshulgoyal101/adbrain/tree/67320272380429b003b2131bf3b2b22641b0dd67).
Their migrations and combined-workflow acceptance are separate prerequisites.

| Candidate method/path | Contract | Failure/authority boundary |
| --- | --- | --- |
| #35 GET `/api/leads` | `query` trimmed <=200; `status`: all, new, contacted, qualified, booked, closed; `contact`: all, ready, missing; `sort`: newest, oldest, name; `limit` 1-100, default 50; optional opaque cursor | Session and server-selected primary business; 401 no user, 404 no business, 400 invalid filters/cursor, 503 unavailable data |
| #35 PATCH `/api/leads/[id]` | Nonempty strict object containing `workflow_status` and/or `follow_up_note`; status one of five workflow values, note <=2000 characters | Update by local UUID AND owned business under RLS; 400 invalid/protected fields, 404 missing/foreign row, 503 failed save |
| #34 POST `/api/leads/sync` | Optional `{syncId}`; empty request can recover current unfinished binding; response extends import counts/failures with `sync:{id,state,hasMore}` | Owned current Meta binding; service checkpoint state, never a client-supplied provider URL; incomplete import is not an up-to-date result |

List success is `{leads,total,nextCursor}`; PATCH success is `{lead}`. Both use
private/no-store responses. List totals cover the complete filtered set, not only
the loaded page. Cursors bind business, search, status, contact and sort; timestamps
retain microseconds, nulls sort last and UUIDs break ties. Changed scope rejects
the old cursor. This is keyset pagination, not a frozen export snapshot.

Import requests are bounded to 24 provider pages, 200 rows/page, three concurrent
form workers and a 40-second provider budget. Checkpoint progress/deduplication
must preserve local status/note, source and campaign association. The UI refreshes
its filtered list after sync instead of replacing it with sync response rows.
Partial failures retain continuation where available; legacy responses without
explicit completion cannot prove complete import. Follow-up writes do not send
outreach, change provider data or grant financial authority.

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
| Test order creation | 10 / 5 minutes |
| Test order status / verification | 60 / 5 minutes, independently per action |

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