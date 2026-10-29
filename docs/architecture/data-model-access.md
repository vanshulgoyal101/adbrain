# Data Model: Leads, Authority, RPCs and Storage

Part of [Architecture](README.md). [Tables and relationships](data-model.md) · [Leads, authority, RPCs and storage](data-model-access.md) · [Migrations](migrations.md).

### Leads, Limits, and Evidence

| Table | Important fields and guarantees |
| --- | --- |
| `public.leads` | Business, nullable campaign, `source` `meta_form` (default) or `whatsapp_manual` ([#335 migration](../../db/migrations/20261024_manual_whatsapp_enquiries.sql)); `meta_lead_id` is null exactly for `whatsapp_manual` rows the owner logs from WhatsApp chats; unique `(business_id,meta_lead_id)` for Meta leads, form ID/name, normalized name/phone/email/city, field JSON, provider creation time and import time; `workflow_status` `new`/`contacted`/`qualified`/`booked`/`customer`/`closed` (default `new`; `customer` = "Became a customer", #798) and `follow_up_note` (default empty, <=2000 characters) |
| `public.lead_sync_runs` | Business/owner, connection generation, ad account and Page, state `partial`/`complete`, version, progress JSON (form cursor, seen forms, pending forms); RLS with browser roles revoked, service-role only |
| `public.spend_limits` | One per business; nullable integer weekly cap, alert percentage 1-100 default 80, auto-pause default false, updated time |
| `public.audit_log` | Business/actor, action, entity type/ID, Meta object ID, reason, detail JSON, timestamp |
| `public.llm_usage_events` | Business/user/request, route, text/image kind, provider/model, tokens, estimated USD, prompt version, character counts, temperature/max tokens, cache/latency/attempt/status/error, image dimensions, metadata, timestamp; new candidate metadata binds a generation UUID to bounded provider request IDs and provider finality when available |
| `public.rate_limit_hits` | Limiter key and hit timestamp, indexed by both |
| `public.product_events` | Event/request UUIDs, version 1, optional user/business, kind/name/outcome/duration, allowlisted attributes, timestamp |
| `public.product_event_daily` | Account-free daily usage/performance totals, grouped by UTC day/environment/release/event/route/action/viewport/provider/model; RLS, browser access denied, service-role read only |

The source [rollup migration](../../db/migrations/20260928_product_event_rollups.sql)
depends only on the existing product-event table and replaces its pruning function
without changing the caller contract. It aggregates and deletes up to 10,000 raw
events older than 90 days atomically, preserves aggregate totals for 730 UTC days,
and bounds old-aggregate cleanup. Migration application itself deletes no events.
Use the [observability guide](../operations/observability.md#retention-and-health) for metrics,
privacy, retention limitations and queries spanning raw and aggregate data.

Leads use duplicate-ignore inserts, so later provider edits do not update an
existing lead, and repeated imports keep its campaign and follow-up fields.
Campaign deletion sets lead `campaign_id` null rather than deleting
the enquiry. Contact data remains personal data; do not put it in telemetry.

Lead sync progress lives in `lead_sync_runs`. Service-only `lead_sync_start`
resumes or creates a run bound to the business owner and the current connected
generation/account/Page; `lead_sync_checkpoint` inserts up to 200 rows and
advances progress in one transaction, rejecting a stale version or changed
binding. A run becomes `complete` only when form discovery is done and no forms
are pending. Browser roles cannot supply progress. Each row may carry Meta's
`meta_campaign_id`; the checkpoint sets `leads.campaign_id` to this business's
campaign with that Meta id (null for test or organic leads), fills an empty link
on a lead seen again, and counts only new leads as imported (#680).

`get_lead_page` is security-invoker, owner-checked and granted to authenticated
only, so RLS still applies. It filters by status, contact availability and a
case-insensitive search over name/phone/email/city/form, and returns rows, the
exact filtered total and a keyset position. Microsecond time keys, C-collated
names, missing values last and UUID tie-breakers give deterministic continuation,
not a frozen snapshot under concurrent edits.

The API and integrity SQL require a positive integer spend cap or null.
Integrity constraints also reject negative/nonfinite campaign budgets and costs,
unsafe metric counts and invalid reporting periods. Composite foreign keys bind
lead/operation campaigns and operation drafts to the same business. On upgrade
these are added `NOT VALID`: new writes are checked, historical rows are not
certified until the separate validation migration runs after the
[read-only preflight](../../db/preflight/20260926_campaign_integrity.sql) and any
approved repair. They do not establish a spend ledger.

Audit rows are owner-readable, not owner-insertable. Inspect `authority` before
treating historical rows as server evidence. This is not a cryptographically
tamper-proof audit system; database administrators and cascades remain relevant.
Legacy audit details can include brief text; product-event privacy rules are not
retroactive sanitization of that store.

Usage inserts are service-only; owners can select their own rows. The nonnegative
constraint is added `NOT VALID` for upgrade compatibility: new writes are checked,
but old data requires a separate validation decision. Monthly aggregation is
owner-scoped and sums all relevant rows, avoiding client pagination truncation.
Persistence is best effort and estimated costs are not invoices.

The deployed #54 [creative-generation intents](../../db/migrations/20260927_creative_generation_intents.sql)
bind a UUID to one
business, owner, request hash and expected count, a UTC month, reserved/accounted
quota units, an image allowance and a persisted state. Direct table access is
revoked; service-only admission, status and progress RPCs verify current
ownership. Admission serializes same-ID claims and business/month quotas against
recorded usage plus outstanding holds. Completion releases unused text allowance
but retains 10,000 units per completed image; paid image rows carry zero tokens,
and their estimated USD costs may be unknown. Unresolved work keeps its ID and
hold across restarts and months. Only a settled whole-request failure with no
saved results can release unused reservation; one failed angle cannot fail the
intent while sibling work remains in flight. After the
[settle-holds migration](../../db/migrations/20261021_creative_generation_settle_holds.sql)
(#138), a settled partial run whose every angle recorded its usage keeps only
that usage plus 10,000 units per saved image; runs with unknown usage stay
`unresolved` with their full hold. An unknown owner recovery lookup claims a
zero-quota `abandoned` ID under the same lock, preventing a delayed POST from
starting after the client receives a 404. This is a conservative quota fence, **not** a
payment ledger or provider cost reconciliation. The [API contract](../api/creatives.md#generate-and-recover)
defines the client-visible recovery states.

The [operator reconciliation migration](../../db/migrations/20260930_creative_generation_reconcile.sql)
is applied in Production at checksum `99d1be625171c48dee4cbe7bec71d749169742a2a49b2c113dd1cd36c2f6f681`.
It adds a private one-row-per-intent audit and a service-role-only, owner/intent-scoped
RPC. It fences older intents without generation-bound receipts, requires an
operator evidence reference, explicit provider-verified token total, matching
saved-creative outcome and current accounted/reserved counters, then atomically
writes any missing usage adjustment and closes the hold. No browser caller can
invoke it; row-locking triggers reject late generation-bound usage writes and
new/reassigned creatives, while ordinary saved creative edits remain available.
A late progress callback cannot change an audited result. The
SQL cannot independently verify external provider finality: the authorized
operator must do that before calling. In particular it cannot reconcile the
September 29 #54 incident, whose per-generation provider evidence is still absent.

The [regeneration claims migration](../../db/migrations/20261001_creative_regeneration_claims.sql)
adds one private claim per creative, bound to the current business, owner and
request UUID. Service-only RPCs atomically admit one paid regeneration at a time
across server instances and release the claim after a confirmed save or known
pre-provider failure. An uncertain paid outcome stays `unresolved`; it cannot
auto-expire or be cleared by an authenticated client. This is not a provider
idempotency key or a substitute for external outcome evidence. Apply the migration
before serving the updated regeneration route.

Product events are server-only (no browser read/write policy), with bounded JSON
attributes and a 90-day retention target. Pruning deletes at most 10000 old rows
per call. See [Observability](../operations/observability.md) for exceptions and retention backlog.

### Effective Authority

Authenticated owners can read their campaign, result and audit rows but cannot
insert, update or delete them; server callers write after owner/binding checks.
Business delete/truncate is revoked from browser roles so cascades cannot remove
retained evidence. Audit insertion goes through service-only
`append_verified_audit_event`, which verifies the business owner or an explicit
`cron`/`worker` system actor, assigns the label/time and sets `authority=server`;
older rows stay `legacy_unverified`, and direct service-role audit writes are
revoked. Draft owners keep select/insert, but an insert trigger sets
version/expiry and a 50-open-draft limit, and update/delete go through
version-checked RPCs. RLS and grants both apply: an `all own` policy is not
evidence of write access after a revoke. Sources:
[trusted writes](../../db/migrations/20260926_trusted_campaign_writes.sql) and
[draft authority](../../db/migrations/20260926_draft_authority.sql).

### Optional Payment Storage

These migration-defined tables support billing evidence and local test checkout.
They do not implement campaign activation authority; see the
[Payment Plan](../PAYMENTS-PLAN.md).

| Table | Persistence / authority |
| --- | --- |
| `public.meta_billing_profiles` | Business/environment billing identity; owner-readable, service select/insert |
| `public.meta_funding_evidence` | Append-oriented verified funding evidence; service select/insert |
| `public.meta_funding_revocations` | Separate revocation records; original evidence is not rewritten |
| `public.meta_billing_events`, `public.meta_billing_event_conflicts` | Provider charge observations and conflicting evidence, not an account balance; service read, RPC-mediated writes; migration-only, not in the fresh schema |
| `private.razorpay_test_orders`, `private.razorpay_test_events` | Fixed-amount INR test orders and deduplicated observations; migration-only, not in the fresh schema |

Test order/event tables deny direct access even to the service role; only the
`razorpay_test_order_*` RPCs reach them. Test order states are `creating`,
`created`, `captured` and `needs_reconciliation`. A capture is not Meta funding
or spendable credit, and installing the tables does not enable checkout; see
[local test payments](../api/payments.md#local-test-payments).

## RPC Ownership Boundaries

| RPC family | Purpose |
| --- | --- |
| `owns_business` | Current authenticated owner predicate |
| `change_declared_preferences` | Owner-checked, namespace-locked opt-in/save/forget/clear/pause with monotonic epoch; only authenticated callers can execute and direct table writes are denied |
| `meta_token_*` | Business-bound encrypted token insertion/read/delete |
| `meta_attempt_*` | OAuth claim, discovery, revision, selection commit and failure transitions |
| `meta_disconnect`, `meta_revoke_subject` | Disconnect/revoke and invalidate connection generation (revoke clears only connections using that Meta user's token) |
| `update_campaign_draft_if_version`, `delete_campaign_draft_if_version` | Authenticated owner/version-checked draft update/delete; update blocks unsafe operation overlap; direct update/delete revoked |
| `append_verified_audit_event` | Service-only verified actor/time/provenance audit insertion |
| `get_lead_page` | Authenticated, owner-checked filtered enquiry page with total and keyset position |
| `lead_sync_start`, `lead_sync_checkpoint` | Service-only binding-checked sync run resume and atomic lead import/progress commit |
| `claim_campaign_operation` | Durable idempotency/lease claim |
| `enqueue_campaign_operation`, `claim_next_campaign_job` | Service-only durable enqueue and exclusive pending-job claim |
| `checkpoint_campaign_operation` | Fenced phase and external-ID persistence |
| `finish_campaign_operation`, `fail_campaign_operation`, `expire_campaign_operation` | Terminal/reconciliation transitions |
| `monthly_token_usage` | Security-invoker, owner-RLS monthly sum |
| `creative_generation_admit/status/progress` | Deployed #54 service-only, owner-checked generation claim, recovery and quota holds |
| `creative_generation_reconcile` | Production service-only operator-attested settlement after external finality and token verification; legacy intents denied |
| `creative_regeneration_claim/finish` | Migration-dependent service-only, owner-checked per-creative paid-operation claim and guarded release/hold |
| `check_rate_limit` | Service-only advisory-lock-protected count and insert |
| `prune_product_events` | Service-only bounded retention cleanup |
| `customer_ad_*` | Service-only allowance balance, reservation, activation result, cost reconciliation and refund allocation |
| `meta_funding_latest_record` | Service-only business/environment funding evidence lookup |
| `meta_billing_event_record`, `meta_billing_charge_observations` | Service-only billing event/conflict persistence and observation lookup |
| `razorpay_test_order_claim/result/get/find/observe` | Service-only local test order creation, recovery and verified observations |

Do not expose service RPCs as arbitrary browser-callable utilities. SQL grants and
application owner checks serve different purposes and both must remain intact.
See [database tests](../../scripts/check-meta-connect-db.mjs) before changing fences.

## Storage

Both `brand-assets` and `creatives` buckets are configured **public**. Object
management is scoped by an owned business UUID as the first path segment, but a
public delivery URL is not a private authenticated download. Do not upload
confidential documents, lead lists, credentials, or unconsented personal media.

Generated media uses `<businessId>/<variantGroup>/<name>-<randomUUID>.png` after
raster normalization. The brand-upload UI accepts PNG/JPEG/WebP up to 5 MiB;
this is a UI guard, not proof of server-wide bucket validation. The shared
server image pipeline has different 20 MiB/40-million-pixel limits.

Deleting a database row does not automatically remove a Storage object. Creative
deletion currently removes the row, not a complete media-retention graph. Brand
asset deletion explicitly coordinates row/reference/file operations but cannot
make them atomic. Cleanup must check campaign/draft/operation references and
retain recovery evidence; never remove media based only on a missing current UI
thumbnail.
