# AdBrain QA Remediation Plan

Date: September 26, 2026. Status: execution plan; acceptance remains packet-specific.

Current coordination: [Worker Orchestration](../ORCHESTRATION.md) is the single
assignment/ownership board for Dev, Dev 2, DevOps and QA; it supersedes worker
routing below without changing these technical packet requirements. The later
[independent acceptance report](independent-acceptance-2026-09-26.md) accepts DB-A
and F5/F8 on candidate B locally, not full DEV-A or production rollout. Dev now
owns DEV-B and Dev 2 owns DEV-C, first gated on their shared contract.

The [operating brief](../OPERATING-BRIEF.md) retains product context. The payment
worker's [real test receipt](../PAYMENTS-PLAN.md#september-26-real-razorpay-test-transactions)
supersedes pending-provider-test assumptions below. Historical status statements
retain their original evidence date and scope; other packet gates remain open.

## Decision

Prioritize trustworthy delivery and spending evidence over additional features.
Keep managed paid launch blocked until the financial, provider and delivery gates
are verified. Continue the already-authorized isolated Razorpay test work, but do
not build a general financial platform around an unproven Meta funding route.

Run three initial tracks in parallel: DevOps establishes trustworthy environment
and recovery evidence; Development closes integrity and lifecycle defects; the
owner/provider track resolves automatic Meta funding and commercial terms. QA
owns reproducible regressions and independently checks the assembled result.

This plan does not modify production, enable checkout, start ads, apply migrations
or authorize publication. The owner's request authorizes the assessment and plan;
specific live operations still follow [Releasing](../RELEASING.md).

## Baseline and Confidence

- Source: dirty `dev` at `9da5b07b00e54fb552796cbcf01cc5fc7c2f02e7`, with existing
  uncommitted payment code, tests, SQL and documents. Preserve all concurrent work.
- The [QA baseline](qa-baseline-2026-09-26.md) maps current workstreams and prior
  local verification. The [detailed audit](repository-audit-2026-09-25.md) defines
  F1-F9; those findings remain open.
- Prior same-day validation: 1,790 tests passed, one paid test skipped; lint,
  types, disposable fresh/upgrade PostgreSQL, dependency audit and an isolated
  current-source build passed. Those checks were not rerun for this document-only
  planning task and do not certify subsequent edits.
- New verification in this planning task: executed the repository schema plus
  optional billing migrations in a fresh Unix-socket PostgreSQL cluster, using
  the existing harness's synthetic Supabase grants/auth model. Exercised direct
  authenticated-role writes with two synthetic tenants; removed the cluster.
- No deployed database catalog, production grants, live provider state, actual
  settlement, browser payment result or remote deployment was inspected here.
  An exit code in another session is not a provider-test receipt.
- During final validation, `origin/dev` advanced to `273c185` (merchant identity
   correction). Its four-file diff does not alter SQL or the campaign/payment
   backend findings. It was inspected, not pulled; integration must recheck the
   latest source and preserve local work. No production release is inferred.

Evidence labels: **L** = reproduced locally; **S** = source-confirmed;
**E** = external/operational evidence missing; **P** = proposed capability.

## Gap Register

Priorities below are remediation priorities, not the roadmap's P1-P6 identifiers.
"Launch blocker" does not mean an observed production incident or exploitable
cross-tenant disclosure.

| ID | Gap and impact | Evidence | Priority / owner |
| --- | --- | --- | --- |
| DB-01 | Authenticated owner can rewrite/delete campaign mirror rows and write/delete result snapshots used for spend decisions; tenant RLS does not make provider evidence trustworthy | L: own status/budget/external ID update accepted; other-tenant update denied | Launch blocker; backend/database Dev |
| DB-02 | Database accepts negative insight values, reversed insight dates and zero weekly caps despite stricter API expectations | L | Launch blocker for trusted spend; backend/database Dev |
| DB-03 | A lead owned by tenant A can reference tenant B's campaign; the FK checks existence, not same-business membership | L: insert accepted; no cross-tenant data read demonstrated | High integrity; backend/database Dev |
| DB-04 | Owners can directly rewrite draft version and expiry, bypassing the API's optimistic-concurrency/lifetime contract | L | High integrity; backend/database Dev |
| DB-05 | Owner-inserted audit rows accept another user's actor ID and arbitrary action/label; append-only does not mean authentic | L | High before relying on audit for authority; backend Dev |
| APP-01 / F1 | Parent campaign activation leaves newly created ad sets/ads PAUSED | L in preceding audit | Delivery blocker; campaign Dev |
| APP-02 / F3 | Capacity check, provider activation and local status write are not a durable atomic workflow | S plus local guard arithmetic; concurrent HTTP race not yet reproduced | Spend blocker; campaign/backend Dev |
| APP-03 / F2,F4 | Daily cron neither refreshes nor freshness-checks spend, treats missing snapshots as zero, and uses unpaginated reads | S; earlier stale-snapshot probe in detailed audit | Spend blocker; campaign/backend Dev + DevOps |
| APP-04 / F5 | Studio lacks Create's lost-response generation reconciliation; retries can duplicate paid work | S | High; creative/frontend Dev |
| APP-05 / F8 | Failed instruction lookup becomes empty guidance before paid generation | S | High, small fix; creative/backend Dev |
| APP-06 / F7 | Bare website accepted by Brand reaches Meta unchanged; effective website is outside review identity | L for validator/payload; S for review omission | High; campaign Dev |
| APP-07 / F6 | Form/lead pagination is ignored; initial inbox only 200 rows; attribution/handoff incomplete | S | Outcome blocker before external pilot; leads Dev |
| AI-01 | Generation IDs are recovery labels, not durable once-only execution; quota checks are non-atomic and usage writes best effort | S | High cost/recovery risk; creative/backend Dev |
| DATA-01 | Creative rows, public media, external ads and audit/financial evidence have different deletion/retention lifecycles | S | High privacy/recovery; backend Dev + DevOps |
| PAY-01 | Test checkout has safe holds but no complete unknown-order recovery, durable account-wide UI recovery, refund issuance or settlement/entitlement lifecycle | S/P | Keep test-only; payment Dev |
| OPS-01 | Effective environment isolation, deployed schema/grants, scheduler/worker health, alerts and restore ability lack current evidence in this audit | E | Verification blocker; DevOps |
| QA-01 | Hosted CI lacks browser journeys; aggregate coverage thresholds lag observed coverage; several critical wrappers/query branches unexecuted | S | High regression risk; QA + DevOps |
| DOC-01 / F9 | Daily activity script can print false success; older operator/account/release instructions conflict with newer decisions | S | Small, immediate; tooling Dev + QA |
| BIZ-01 | Automatic Meta funding, current operator/agency relationship, tax/refunds and external customer consent remain unresolved | E | Commercial launch blocker; owner/providers, QA witnesses |

### Database Reproduction Details

Under the locally simulated `authenticated` role for an owner, these succeeded:

1. Updating their campaign's status to paused, budget to 1 and external campaign ID.
2. Inserting their campaign result with spend -1, impressions -1 and end before start.
3. Inserting their lead with a different tenant's campaign ID.
4. Inserting an audit event for their business with the other user's actor ID.
5. Changing their draft version to 999 and expiry to 100 days ahead.
6. Inserting an enabled auto-pause setting with a zero cap.

Updating the other tenant's campaign affected zero rows, as intended. These probes
establish gaps in the tested schema/grant combination, not the current production
catalog. Do not publish them as proof of access to another customer's records.

Sources: [campaign/results/storage policies](../../db/schema.sql#L617),
[draft policies and version RPC](../../db/migrations/20260907_campaign_connect.sql#L4),
[audit and lead policies](../../db/schema.sql#L1063),
[spend-limit definition](../../db/schema.sql#L1276).

## Execution Order

| Wave | Start now / prerequisite | Deliverable and exit gate |
| --- | --- | --- |
| 0: evidence and containment | Start now | OPS-A environment/schema/restore inventory; QA regressions for DB-01..05 and F1-F9; DOC-A unsafe-script containment. Preserve disabled managed money flow |
| 1: trustworthy state | DB-A and DEV-A can start locally alongside OPS-A; isolate shared-file ownership | Restricted trusted writes, DB invariants, safe instruction reads and generation recovery; fresh/upgrade tests plus consumer compatibility |
| 2: delivery correctness | DB-A contract agreed; provider funding investigation remains first commercial priority | DEV-B durable activation/capacity and DEV-C fresh complete spend collection; no activation sign-off until both integrate |
| 3: measurable outcomes and recovery | Lead DB contract agreed; can develop independently of campaign worker | DEV-D lead pagination/attribution/handoff; DEV-E media/deletion lifecycle; OPS-B alerts/restore rehearsal and QA browser gate |
| 4: money integration | Only after BIZ-A route/terms decisions; local PAY-A test recovery can precede it | PAY-B smallest approved annual financial path, then cross-system failure tests |
| 5: pilot and release | All applicable gates pass on one assembled candidate | Approved bounded pilot with actual provider evidence; exact-SHA release receipt and measured outcomes |

Do not wait for financial feasibility to reproduce or locally fix existing safety
defects. Do not expand financial implementation beyond the approved test exception
until feasibility is established. No calendar completion promise is credible for
provider/KYC/bank-dependent work; estimate engineering packets after API/SQL
contracts are agreed.

## Development Packets

### DB-A: Trusted Writes and Database Invariants

Owner: backend/database engineer. Addresses DB-01..05; enables DEV-B/C/D.

1. Classify columns by authority: owner-editable business content/preferences;
   server-verified provider IDs/status/budget/results; server-managed draft
   version/expiry; server-generated audit actor/time. Keep owner SELECT under RLS.
2. Inventory every caller before revoking writes. Current create/sync/refresh/status
   paths use session clients. Move only trusted writes behind narrowly scoped RPCs
   or server-owned repositories after explicit business/campaign ownership checks.
   Do not replace all session clients with an unrestricted admin client.
3. Prevent browser writes/deletes that can falsify provider state or remove an
   active campaign from enforcement. Distinguish authorized local metadata edits
   from external mutations. Managed caps/reservations must not be deletable or
   disabled through an owner-editable preference table.
4. Preserve user-requested draft editing through a bounded, owner-checked,
   version-checked interface. Make version increments and expiry server-assigned;
   preserve operation-linked draft locks. The existing version RPC is SECURITY
   INVOKER: revoking underlying UPDATE without replacing its execution boundary
   will break legitimate edits. Use explicit checks and fixed search paths in any
   replacement SECURITY DEFINER function; audit EXECUTE grants.
5. Make authoritative audit inserts server-only, or narrowly constrain client
   events to their actual actor and a distinct non-authoritative namespace. Derive
   actor/time server-side; keep scheduler/worker identity explicit. Update
   [audit logging](../../src/lib/audit.ts) and all consumers in the same packet.
6. Add finite/nonnegative checks for observed metrics/costs, valid period ordering,
   and positive-or-null weekly caps. Define draft/import budget semantics before
   constraining campaign budgets; do not globally require positive values where
   incomplete drafts or unknown provider data legitimately exist. Account for
   PostgreSQL numeric NaN, nulls and JavaScript safe-integer boundaries.
7. Add same-business relational enforcement for lead/campaign association and
   operation/campaign finalization. Use a composite key/FK or a narrowly scoped
   invariant trigger; retain unbound legacy leads as null. Preserve intended
   delete semantics without setting a lead's non-null business ID to null.
8. Assess campaign creative UUID arrays separately: they have no per-element FK.
   Keep current execution ownership checks; use a same-business association table
   if immutable membership/deletion guarantees are needed. Do not perform a broad
   schema normalization merely for style.

Migration: new incremental SQL, not edits to historical migration checksums;
update fresh schema/types and [DB harness](../../scripts/check-meta-connect-db.mjs).
Preflight existing invalid rows and orphan/cross-business references read-only.
Quarantine or explicitly repair with evidence, never clamp negatives, fabricate
attribution or silently drop records. Use staged constraint validation where
appropriate; unique/FK/index changes require their own lock/rollout assessment.

Acceptance: direct owner REST/SQL attempts cannot forge trusted data, delete
enforcement evidence, spoof audit identity or bypass draft fences; wrong-tenant
references reject; valid owner workflows still work; anon/service grants match
intent; test fresh, upgrade and invalid legacy fixtures. Repeat through actual
local Supabase PostgREST, not only the synthetic SQL harness.

### DEV-A: Stop Silent Input Loss and Duplicate Creative Work

Owner: creative/backend engineer, frontend partner. Addresses APP-04/05, AI-01.

Immediate small changes: make instruction read failure distinct from an empty
list and fail before paid calls; retain the brief and report unavailable context.
Reuse Create's generation-ID/reconciliation behavior in Studio, with identity
persisted before POST, single-submit guard, partial results and explicit recovery.

Follow-up once-only contract: a business/owner-scoped generation intent with
unique request identity, input fingerprint, state, per-variant results and known
usage. Duplicate requests return the existing intent; different inputs conflict.
Do not mark a missing HTTP response failed or launch replacement paid work.
Provider requests without provider idempotency can still have uncertain charges;
preserve that uncertainty instead of promising exactly-once billing.

Cost guard: reserve bounded quota before execution atomically; settle observed
usage and retain unknown liability after ambiguous calls. Set independent image
count/cost budgets and provider-side limits. Audit autofill, interviews, summaries,
regeneration and fallback paths, not just the main generation endpoint. Phase this
after the recovery patch; do not invent precise USD costs when providers omit them.

Tests: saved-instruction error means zero provider calls; double click/two tabs;
same ID/different payload; disconnect after save; partial variant completion;
reload/unmount/blocked storage; provider success followed by storage or usage-write
failure; quota contention and abandoned leases. Use existing creative/Studio tests.

### DEV-B: Durable Reviewed Activation and Capacity Reservation

Owner: campaign/backend engineer. Addresses APP-01/02/06; depends on DB-A.

1. Normalize and validate the effective website before preflight; include the
   resolved destination link in review identity. A brand website change must
   invalidate the review. Verify the exact payload for forms and WhatsApp.
2. Separate desired status, observed provider status and operation state. Never
   show confirmed delivery from a successful parent-only mutation.
3. Define a reviewed delivery operation containing campaign/account/Page/generation,
   exact intended child IDs, budget/schedule, authority and input digest. Preserve
   intentionally paused imported children; legacy objects need explicit review.
4. Add durable delivery-operation storage and per-business capacity reservations.
   Reuse existing lease/checkpoint patterns, but do not naively extend the create
   ledger: it currently only permits campaign_create and uniquely locks draft_id.
   A campaign-linked delivery ledger is the conservative starting design.
5. In a short database transaction, lock the business capacity row, validate limits
   and reserve incremental commitment once. Never hold DB locks across provider
   requests. Repeated activation must not double count already committed capacity.
6. Verify and checkpoint each authorized external step. Define safe child/parent
   ordering and compensating pause behavior; retain reservations on ambiguous
   results. Connection changes/cancellation must fence subsequent steps without
   discarding already transmitted effects.
7. Route activation, resume and future automation through this service. Pause must
   remain possible when spend reads fail, while still checking original binding.
   Release reservations only after verified inactivity or reconciled liabilities.

Acceptance: actual mocked create-to-activate lifecycle changes only reviewed
children; two simultaneous requests cannot oversubscribe a cap; same request is
idempotent; changed budgets/assets/creative/link invalidate review; provider success
plus DB failure survives restart; failed compensation remains visible and alerted.
Then perform a separately authorized bounded provider test, not automatic activation.

### DEV-C: Fresh, Complete and Period-Correct Spend Enforcement

Owner: campaign/backend engineer; DevOps owns execution. Addresses APP-03.

Define the budget period and account timezone explicitly. Keep media spend, tax,
funding balance, customer entitlement and forward budget projection separate.
Read fresh provider observations for the correct period before allowing a new
managed start. Validate timestamps, full response shape and currency; stale/missing
data is unknown, not zero. Previously incurred spend remains liability across
pauses and period transitions.

Replace scheduler's capped reads with bounded keyset pages or a tested scoped
aggregate; save continuation and per-account success/failure state. Use existing
complete-query patterns where suitable. Partial scans must not report full success.
For active managed delivery with stale evidence, apply an agreed conservative
pause/escalation policy; attempt verified pause without assuming it succeeded.

The current daily Vercel cron cannot establish a short financial reaction bound.
DevOps must identify an approved scheduler/worker option and its cost. Set a
measured freshness threshold, detection-to-pause objective, provider controls and
overspend reserve after measuring API latency/limits and billing mode. If the
host cannot meet that bound, leave unattended managed delivery blocked.

Tests: more than 1,000 limits/campaigns/results; a busy campaign cannot crowd out
others; stale/absent/invalid snapshots; new or externally activated campaigns;
mid-pagination outage; account timezone/week boundary; multiple snapshots are not
summed as deltas; overlapping jobs; failed provider pause/local save. Reconcile
against a defined Ads Manager period before claiming numerical parity.

### DEV-D: Complete Enquiry Import and Honest Attribution

Owner: leads/backend engineer, frontend partner. Addresses APP-07 and DB-03.

Implement bounded provider cursor pagination for forms and leads, with durable
per-business/Page/form progress and explicit complete/partial/retryable outcomes.
Preserve progress through crashes; deduplicate by tenant and provider ID. Repeated
cursors and provider limits must stop safely. Decide whether inactive forms with
historical leads need inclusion; do not silently equate active forms with all history.

Add inbox keyset pagination with a stable tie-breaker and server-side filters.
Do not label the currently loaded page as the total or "up to date" after a partial
import. Request provider ad/campaign attribution only where permitted; match exact
IDs to an owned campaign and preserve unknown/unimported attribution as null.
Never infer a campaign solely from a shared form or campaign name.

Define minimal handoff evidence with the owner: who checks enquiries, authorized
recipient/access, agreed response window and acknowledgement. Start with one
consented controlled receipt test; do not add a CRM, auto-message leads, or copy
personal data into QA artifacts.

Tests: only page two contains a new lead; >200 inbox rows; partial form failure;
duplicate/reordered pages; expired connection/reconnect; cross-tenant association;
form reused across campaigns; unknown attribution; desktop/mobile navigation and
privacy-safe handoff. SQL association changes must coordinate with DB-A.

### DEV-E: Media, Deletion and Retention

Owner: backend engineer; DevOps validates backup/storage behavior. Addresses DATA-01.

Inventory source/final images and references in creatives, campaigns, drafts and
operations. Preserve assets still needed for recovery or agreed retention. Add
durable cleanup intents/retries for failed saves and retired media; use a dry-run
inventory plus grace period, not a bulk delete of anything without a current row.
Verify bucket/project/path ownership before deletion and handle partial failures.

Design deletion across database, public Storage, authentication, tokens, logs and
provider obligations. Existing public URLs are not private because metadata has
RLS. Financial/test-order restrict FKs and other cascade paths need an explicit
retention/anonymization policy before account deletion. Do not change public media
to expiring URLs without checking Meta's fetch/use requirements.

Acceptance: orphaned upload recovery, shared-reference retention, regenerated
asset cleanup, bucket failure/retry, tenant isolation, account deletion with
retained financial evidence, and a restored fixture retaining required references.

### PAY-A: Finish the Existing Isolated Test Lifecycle

Owner: payment engineer already working on checkout. Addresses PAY-01.

First obtain that engineer's latest sanitized receipt and source snapshot, including
the two documented test captures, intentional test-bank failure and earlier unpaid
or uncertain attempts. An older failed terminal command does not establish current
provider state. Reuse those identities; do not restart payment creation blindly
or duplicate that work. Refund and public-webhook evidence remain separate gates.

Keep the existing SDK, test routes, fixed amount, explicit local gate and zero ad
credit. Verify actual merchant identity, tested method and local database migration.
No secret values in tickets. Prove capture and signed callback/webhook processing
with duplicates, ordering changes, refund observations and provider outages.

Add authenticated recovery by durable order identity, including recovery without
sessionStorage. Unknown provider creation must stay held until authoritative
evidence uniquely identifies the order; no new idempotency key as a workaround.
Define a bounded operator reconciliation path with immutable evidence. A lost
callback plus unavailable webhook needs a supported recovery method, not a forever
pending status screen. Don't permit terminal captured UI to mask later refunds.

Acceptance: actual approved test-mode capture/refund evidence plus synthetic
failure/race matrix; mismatched merchant/key/order/signature rejected; reload,
closed tab, missed webhook and storage loss recover safely; production/Vercel and
remote-DB gates remain disabled. Public webhook exposure is separately approved.

### PAY-B: Annual Money Flow, Only After Feasibility

Owner: payment/backend engineer; gated by BIZ-A and DB-A/DEV-B/C contracts.

Implement the smallest approved path from [Payments Plan](../PAYMENTS-PLAN.md),
not a second competing billing architecture. Freeze the INR 10,000 total annual
contract and tax/fee treatment in versioned orders. Existing allocation v1 is
base-plus-tax arithmetic, not automatically that annual contract.

Separate payment capture, settlement, customer entitlement, reserved delivery,
incurred Meta cost, tax/fees and refunds/disputes. Use integer paise, unique provider
event identities and balanced immutable postings/compensations. Serialize reservation
against refund/dispute holds. Every delivery entry point checks the same authority;
browser success and test captures never create live funds.

Acceptance: monetary conservation; duplicate/concurrent and out-of-order effects;
capture without settlement; refund before/after delivery; revoked funding; late Meta
charges; chargeback freeze; lost responses/restart; no unexplained balances. A real
bounded pilot and accountant/provider sign-off remain separate from these tests.

## DevOps Packets

### OPS-A: Environment and Deployed Database Evidence

Start with read-only inspection. Return a sanitized environment matrix identifying
Git SHA, canonical alias, runtime Node version, Supabase project, effective deploy
rules, enabled feature flags, cron/worker ownership and credential separation.
Verify what is behind localhost/tunnels. Do not enable previews to obtain isolation.

For the target database, inventory migration ledger/checksums plus actual columns,
constraints, indexes, RLS policies, table/function grants, security-definer search
paths, storage bucket limits and exposed schemas. Historical migrations predate
the ledger: missing rows do not authorize replay. Compare deployed reality with
fresh and ordered-upgrade schemas; identify drift without changing it.

Deliver a reusable isolated local integration setup with synthetic tenants and
provider boundaries, no production keys. Verify real Auth/PostgREST/Storage behavior
and teardown; coordinate with the existing Colima launcher and payment engineer.

Acceptance: exact non-secret identity matrix; DB-01..05 explicitly confirmed or
disconfirmed on authorized catalog evidence; deploy/migration dependencies listed;
no production migrations, configuration changes or paid resources created.

### OPS-B: Recovery, Monitoring and Release Readiness

Propose then obtain approval for backup retention, measurable RPO/RTO and a restore
rehearsal in an isolated target. Cover DB, Storage and recoverability of encrypted
tokens/keys. Never restore a production backup into casual developer tooling or
copy customer data into fixtures; agree data access and sanitization first.

Add actionable monitoring for stale spend, missed/incomplete sweeps, stuck/expired
operations, uncertain provider outcomes, payment age, webhook failures, unreconciled
balances and failed pauses. Name an on-call owner and escalation path; verify alert
delivery with synthetic failure injection. Logs alone are not monitoring.

For workers/schedulers, document process supervision, concurrency, leases, rate
limits, graceful shutdown, secret scope, cost and backlog health. Worker `--once`
can create provider objects and is not a read-only health check.

Release each dependency-complete packet using approved immutable source. Database
privilege tightening can break old code: deploy compatible server write paths,
verify them, then tighten grants; define a minimum rollback-compatible app version.
Rollback must not reopen unsafe writes or discard evidence. Required protected
checks and exact deployment verification remain mandatory.

### DevOps Assessment Update: September 26

This supplements OPS-A/B and the existing engineering packets, not a second
backlog. The release-manager session independently verified the identity-only
[PR #25](https://github.com/vanshulgoyal101/adbrain/pull/25) production release at
`2d94788ec2499b6ec7b9652d8b5fb2f0b898dea5`. Its
[receipt](https://github.com/vanshulgoyal101/adbrain/pull/25#issuecomment-5844981266)
records green candidate/PR/main/synchronized-dev CI, the exact READY canonical
deployment, Node 24, hnd1, and authenticated desktop/mobile Settings checks.
Those results do not cover the later dirty database/campaign/payment changes.
Local dev remains at `9da5b07`, two commits behind, with overlapping active work;
do not pull, reset or stash that work to manufacture a clean candidate.

Source inspected in this follow-up confirms:

- [CI](../../.github/workflows/ci.yml) tests Node 22, whereas the verified host
  runs Node 24. There is no browser job in this workflow. Both are verification
  gaps, not proof that either runtime is broken. Local full-suite coverage had
  timing failures while all four hosted release runs passed; retain that evidence
  and investigate test isolation instead of raising timeouts until green.
- [Playwright configuration](../../playwright.config.ts) uses fixed port 3939 and
   reuses an existing server. The [workspace harness](../../e2e/workspace.spec.ts)
   obtains Supabase authentication from environment variables. Browser request
   interception does not prove the server or that authentication target is isolated.
- [Vercel configuration](../../vercel.json) schedules spend enforcement daily at
  06:00 UTC. [The current cron](../../src/app/api/cron/enforce-spend/route.ts)
  reads unpaginated limits/campaigns/results, selects stored latest spend, and
  substitutes zero for absent observations. Its newer incomplete-run response
  and trusted audit call do not resolve freshness, completeness or period bounds.
- [The pending trusted-write migration](../../db/migrations/20260926_trusted_campaign_writes.sql)
  combines permission revocation with creation of the replacement audit function.
  Its source also restricts business deletion. Deploying old code against those
  grants, or deploying new audit callers without the function, can break valid
  workflows. A single-file apply is not the staged rollout described above.
- Production alias/runtime identity and production-scoped project environment
  metadata have evidence. Actual deployed database grants/schema, all shared
  environment sources, successful scheduler executions, restored media and
  delivered operator alerts remain unverified by this assessment.

Subsequent [OPS-A/B verification receipt](ops-environment-2026-09-26.md) records
actual read-only production catalogs/checksums, Free/Hobby plan and backup state,
shared environment metadata, real synthetic Auth/REST/Storage checks, Node 24 CI
alignment and costed recovery/scheduler options. It supersedes the unknown catalog
and plan status above, but does not close restore, alert, execution or browser-CI
gates and authorizes no production changes.

#### OPS-A Deliverable 1: Environment and Authority Inventory

Maintain one sanitized evidence matrix in the release receipt. For each local,
CI, preview and production target, record identity, owner, last verification and
the following fields. Mark missing evidence unknown, never healthy by default.

| Inventory | Evidence to obtain | Acceptance |
| --- | --- | --- |
| App and runtime | Git SHA, deployed tree, alias, Node, region, feature modes and build-time/runtime configuration names | Exact candidate and expected target agree; no secret values in artifacts |
| Credential isolation | Project and team/shared variable scopes, branch overrides, database/service-role and provider key separation | Local/CI cannot reach live providers or production data; no assumption that a preview is isolated |
| Database authority | Cluster/project identity, migration ledger plus actual catalogs, exposed schemas, role inheritance, table/sequence/function privileges, RLS enable/force state and policies | DB-A authority matrix matches actual effective privileges, including PUBLIC and inherited grants |
| Schema compatibility | Column types/nullability/defaults, CHECK/FK/unique constraints and validation state, indexes, triggers, definer ownership/search paths | Fresh and ordered-upgrade results agree; every application RPC signature exists |
| Data quality | Existing read-only campaign integrity preflight, bounded invalid/orphan/reference counts, duplicate provider identities and date/currency validity | Invalid legacy data has an explicit preserve/quarantine/repair decision; no automatic destructive cleanup |
| Storage and deletion | Bucket visibility/policies, object access, size/type limits, reference ownership, auth deletion and retained audit/payment dependencies | Public media exposure is intentional; deletion and retention contracts can both be satisfied |
| Execution | Actual cron success timestamps and completeness, worker process/supervisor, oldest work item, lease/reconciliation state | Identify the running owner and last completed work, or explicitly record not deployed |

Remote database inspection requires an identified target and an authorized
read-only connection supplied outside chat. Prefer catalog reads in a read-only
transaction with a short statement timeout. Do not read application rows, tokens,
function bodies or provider payloads just to prove schema shape. Never run mutation
probes, worker `--once`, the spend cron, credential backfills or synthetic payment
creation against production as health checks. Run direct-write attack/regression
probes only in isolated synthetic databases. If access is unavailable, return the
catalog checklist for the owner to execute securely and keep the gate open.

#### OPS-A Deliverable 2: Dependency-Complete Database Rollout

Dev owns SQL and callers; DevOps owns the rollout matrix; QA owns independent
acceptance. Recheck the latest migration contents before selecting this sequence.
The pending trusted-write file must be split or an explicitly approved coordinated
maintenance strategy chosen; do not apply the current mixed file casually.

| Stage | Required action | Stop condition and evidence |
| --- | --- | --- |
| Freeze | Obtain an immutable DB-A candidate, ordered migration list/checksums, caller/authority matrix and declared schema version | Moving dirty source or unresolved shared-file ownership is not a release candidate |
| Preflight | Verify target/catalog, backup capability, invalid data, table sizes, long transactions, lock budget and application compatibility | Unexpected drift, invalid rows without a decision, or untested recovery blocks apply |
| Expand | Add compatible columns/functions/indexes without revoking old callers yet; keep any new security-definer RPC narrowly granted | Old application works on expanded schema; new RPCs reject unauthorized callers; record the temporary authority exposure |
| Adopt | Deploy the accepted server-owned writers and bounded draft/audit interfaces; verify create, sync, refresh, pause, draft editing and deletion behavior | Both expected workflows and wrong-tenant denial pass on the candidate; do not claim DB-A closed yet |
| Contract | Revoke browser writes and obsolete privileges after all web, cron and worker consumers are compatible | Direct Auth/PostgREST tests pass; old incompatible application versions cannot be used for rollback |
| Validate | Validate staged constraints only after explicit legacy-data resolution and lock assessment; collect post-migration catalogs | No silent clamping/deletion or reclassification of legacy audit rows as verified evidence |
| Observe | Verify scheduled and interactive consumers, error rates, failed writes and backlog over an agreed observation window | Failed required workflows stop promotion; preserve evidence and use the compatible rollback/forward-fix plan |

Test at least: old app/old schema, old app/expanded schema, new app/expanded schema,
new app/contracted schema, and the selected rollback version/contracted schema.
Include in-flight jobs, stale browser sessions and function overload resolution.
A source rollback does not undo a database change. After contract, the identity-only
production version is not presumed rollback-compatible. Do not reopen unsafe
grants as an improvised rollback. Retain the minimum compatible application artifact.

Choose transactional versus separate index/constraint steps per operation. Check
the [migration runner](../../scripts/database-migrations.mjs) before proposing
concurrent index creation; it cannot execute inside the runner's transaction.
The runner already uses checksum verification, an advisory transaction lock, a
five-second lock timeout and a 60-second statement timeout. Preserve these controls;
measure larger operations and approve any exception rather than removing limits.
Use the existing read-only [integrity preflight](../../db/preflight/20260926_campaign_integrity.sql)
after verifying its table/column prerequisites; give remote scans a short timeout.
Monitor blocking and abort safely instead of waiting indefinitely. Preserve deployed migration
checksums; optional payment migrations are not dependencies of campaign hardening
unless the actual dependency matrix establishes that relationship.

#### OPS-B Deliverable 1: Measurable Recovery

Proposed objectives for owner review, not current capabilities or guarantees:

| Scope | Initial target to evaluate | Required proof |
| --- | --- | --- |
| Unpaid/internal workspace | RPO at most 24 hours; RTO at most 4 hours | Restore synthetic DB and media, verify ownership/auth and usable workflows, measure elapsed time |
| Managed paid operations | Evaluate DB RPO at most 15 minutes and RTO at most 2 hours, including purchased backup capability if needed | Restore plus provider reconciliation; tighter requirements may follow the approved financial exposure model |
| External liabilities | No missing or ambiguous provider outcome is assumed absent after restore | Reconcile orders/events/Meta state against durable identities before allowing new mutations |

Inventory backup retention, PITR eligibility, last successful backup, restoration
permissions, Storage backup/version history, encrypted-token keys and configuration
recovery separately. A database backup alone is not a backup of object bytes or
all application secrets. Protect keys separately, document rotation/recovery
ownership, and prove decryption with synthetic fixtures without recording keys.

First rehearse on synthetic fixtures in an isolated target with outbound providers,
cron and workers disabled. Verify constraints/grants, migration state, referenced
media, tenant isolation and expected reconciliation holds. A restore can roll back
an idempotency ledger while external mutations remain real: freeze execution until
operations and payments are reconciled. Production-backup restoration, retention
changes, paid infrastructure and customer-data access require separate approval.
Repeat the drill after material schema/backup changes and on an agreed schedule.

#### OPS-B Deliverable 2: Alerts and Spend Execution Contract

Name a primary operator, backup and delivery channel before enabling automation.
Use structured, privacy-limited metrics and correlation IDs; never label metrics
with tokens, raw lead data or unbounded business/request identifiers.

| Signal | Required detection | Operator response and drill |
| --- | --- | --- |
| Scheduler silence/partial scans | External dead-man heartbeat emitted only after a complete sweep; scanned/expected counts and per-account freshness | Alert on a missed deadline even if no app request runs; simulate a missed and a partial run |
| Spend unknown/stale | Oldest authoritative observation, period/currency mismatch and incomplete provider pagination | Block new managed starts; execute only the agreed protective pause/escalation policy and verify the result |
| Failed/uncertain pause or activation | Durable operation state, retry/reconciliation age and observed parent/child states | Retain reserved exposure; alert the operator; never claim paused from a sent request |
| Queue and lease health | Oldest pending job, expired leases, attempts and unresolved external effects | Reconcile before retry; lease expiry alone cannot authorize replay |
| Payments | Age of unknown orders, callback/webhook rejection, reconciliation mismatch and refund/dispute holds | Investigate existing identities without creating replacement orders; freeze affected entitlement |
| Platform health | Auth/route/RPC error rate, latency, DB connection/lock pressure, failed migrations, provider 429s and AI budget saturation | Link each alert to a bounded runbook and synthetic failure test |
| Recovery | Backup age/failure and time since successful restore rehearsal | Escalate before retention or RPO is exceeded; verify the restored result, not only the backup API response |

The daily cron and 60-second handler need a measured scale test before any shorter
spend-safety promise. DEV-C supplies period/freshness semantics, pagination and
resumable progress; DevOps supplies a scheduler whose cadence, runtime, concurrency
and cost meet that contract. Use leases and overlap protection, but keep provider
effects independently reconciled. Vercel settings alone do not prove jobs ran.

For a bounded paid pilot, evaluate a five-minute observation objective and a
two-minute operator acknowledgement objective for critical failures. These are
proposals subject to provider limits, costs and owner acceptance, not guarantees.
Measure worst observed end-to-end detection and confirmed-pause latency. Approximate
exposure using an explicitly assumed observed spend rate times the unobserved and
reaction interval, plus uncertainty reserve; daily budget is not a strict hourly
spend-rate bound. If the permitted risk cannot be bounded, unattended managed
delivery remains blocked. External provider limits supplement, not replace, this.

#### OPS-B Deliverable 3: Reproducible CI and Release Evidence

1. Align the primary tested Node major with production, or explicitly support both
   through a small matrix. Verify clean installs, engines and the build on Node 24;
   do not change production runtime merely to hide a CI mismatch.
2. QA and DevOps add an isolated browser job using the existing Playwright suite
   and local Auth/PostgREST fixtures. Prevent server-side live-provider access,
   provide only synthetic credentials, clean up processes and retain redacted
   failure artifacts. Require it for affected lifecycle/UI changes after its
   deterministic baseline is established.
   Replace fixed-port assumptions consistently across configuration, test origins
   and cookie setup. In CI, reject reuse of an unrelated server; allocate a
   dedicated process/port and verify candidate SHA plus fixture identity before
   authenticating. Assert the Supabase target is the expected isolated instance,
   not merely that its environment variables are present. Never stop another
   engineer's server or use a production-backed local server for acceptance.
3. Keep actual role/grant and ordered-upgrade tests alongside synthetic SQL tests;
   include invalid legacy fixtures and the application/schema compatibility matrix.
   A mock query returning success cannot establish a database permission contract.
4. Investigate the known local campaign-test timing/cleanup failures with fixed
   runtime, test order and worker counts. Do not suppress failures with retries,
   global timeout increases or lower coverage requirements. Raise coverage floors
   only from reproducible measurements and prioritize critical-path assertions.
5. Review currently tag-pinned third-party actions, resolve recorded action-runtime
   deprecations, and propose immutable action pins with an owned update process.
   Retain least-privilege workflow tokens, Gitleaks and dependency audit. Inventory
   existing dependency updates and secret-rotation procedures before adding tools.
6. Freeze a candidate and publish an evidence manifest: commit/tree, migration
   checksums/order, tested runtime, CI links, deployment/alias, feature modes,
   acceptance results and rollback-compatible version. Never merge new parallel
   changes based on another candidate's green checks.

### Immediate Three-Worker Handoff

Route these to the existing sessions; this document does not dispatch agents or
authorize live changes. Keep one active implementation owner per shared surface.

| Recipient | First bounded assignment | Required return |
| --- | --- | --- |
| Dev | Finish DB-A; classify and split the mixed expand/contract migration or propose a coordinated maintenance alternative. Preserve the concurrent instruction fix and payment work. | Frozen candidate, full trusted-writer/caller matrix, legacy-data handling, ordered SQL and tested rollback floor |
| QA | Independently test DB-A through real local Auth/PostgREST, not only SQL mocks. Preserve any failing local REST reproduction and establish its cause before closure. | Owner/anon/wrong-tenant/direct-write results; legitimate create/sync/refresh/pause/draft/deletion workflows; fresh/upgrade/legacy fixtures; exact-SHA pass or block |
| DevOps | Complete OPS-A identity/catalog/dependency evidence and design OPS-B recovery/alerts/CI. Coordinate the release lane already used for PR25. | Sanitized drift matrix, staged rollout, restore/alert drill design, scheduler options with costs and explicit unresolved access/approval gates |

Next, Dev and QA agree the DEV-B/DEV-C activation/reservation/spend contracts before
implementation. The payment engineer continues PAY-A using the existing genuine
test-mode receipts; automatic funding, settlement/refunds and live eligibility
remain separate unresolved gates. Do not ask one Dev engineer to implement every
packet simultaneously.

Owner decisions needed before operational rollout: primary/backup alert recipient;
acceptable recovery and spend exposure; budget for backup/scheduler/monitoring
capacity; and explicit approval of the identified migration or live drill. These
do not block read-only inventory, synthetic tests or local remediation planning.

## QA and Tooling Packets

### QA-A: Risk-Based Regression Gate

Use existing test files and DB harness, not a parallel test framework. First make
the new DB integrity probes permanent failing regression cases in the relevant fix
branches. Test direct DB/PostgREST access as well as route mocks. Preserve an
expected failure baseline until each fix lands; never weaken assertions to pass.

Build a provider simulator for the highest-risk lifecycle tests using existing
mock helpers: delayed/lost response, successful mutation before timeout, partial
children, rate-limit response, token revocation and local write failure. Production
logic must run under those tests; mocks should not duplicate and thereby hide it.

Add isolated browser CI journeys: sign-in/navigation, brand extraction edit
preservation, Create and Studio recovery, draft/connect/review/create recovery,
payment pending/capture recovery, and lead pagination. Cover desktop, 390px and
320px, keyboard focus, no overflow, loading/empty/error/partial states. Browser
interception alone does not block server-side providers; enforce isolation there.

Raise coverage gates cautiously toward a reproducible CI baseline; proposed first
floor is 80% statements, 73% branches, 79% functions and 82% lines, only after
confirming stable Node/Linux coverage. Add explicit critical-path tests for the
currently under-covered query, draft, connection and operation wrappers. A high
percentage is not a substitute for concurrency and uncertain-outcome assertions.

Acceptance: clean install on CI's supported Node runtime; dependency/secret checks,
lint/types, unit/component coverage, fresh/upgrade DB, integrated browser journeys
and production build all pass on the same candidate. Retain sanitized failure
artifacts without live credentials, cookies, payment proofs or lead PII.

### DOC-A: Remove Misleading Operational Evidence

Disable or retire [daily activity script](../../scripts/daily-adbrain-test.sh)
unless a legitimate current diagnostic use is agreed. Any retained replacement
must use actual cookie-auth contracts, correct routes and validated HTTP/body
outcomes; no approval promises or fabricated traffic success.

Update the existing API/config/data-model/operations/release references alongside
their owning fixes. Reconcile operator/merchant wording, account setup status,
stale release headings and old fixture publication tasks. Do not overwrite newer
concurrent receipts with this plan's snapshot. Document optional migrations clearly.

## Routing to Engineers

### BIZ-A: Funding Route and Commercial Authority

Owner: product owner with Meta, gateway/bank and accountant; QA records evidence.

Resolve the current operator's legal/provider relationship with the proposed
agency-owned customer accounts. Confirm account-specific automatic billing
eligibility, who bears liability, account capacity, customer Page consent and
offboarding. Identify an actual reconciliation source for charges/settlement;
no invented transfer API or substitution of one-off manual top-ups.

Freeze the annual total, tax treatment, service scope, schedule, refund/unused
funds policy and gateway-fee economics. Define the exact permitted bounded test,
maximum charge/spend, stop conditions and authorized recipient for enquiries.
Bank consent, customer consent and accountant/provider approval cannot be supplied
by a coding agent. If the required route is unavailable, return a blocked decision
with alternatives for owner review rather than implementing a different business
model silently. PAY-B and paid-pilot acceptance depend on this packet.

These are handoff packets for the owner to route; no external tickets, agents or
engineer assignments have been created by this document.

| Recipient | Send now | Return before integration |
| --- | --- | --- |
| Backend/database Dev | DB-A; reproduce DB-01..05 before editing; agree trusted-write and delivery contracts with campaign Dev | Schema/API proposal, affected callers, new migration, fresh/upgrade/direct-role regressions and compatibility/rollback notes |
| Campaign Dev | DEV-B and DEV-C design, then implementation against DB-A | Exact-child activation, capacity race tests, fresh complete spend contract and provider-uncertainty evidence |
| Creative/frontend Dev | DEV-A: accept the existing local instruction fix; coordinate current Studio recovery work before adding another implementation | Focused regressions, saved-work/retry screenshots and list of deferred durable-generation work |
| Leads Dev | DEV-D after DB-A association contract | Pagination/restart tests, attribution rules and bounded handoff acceptance |
| Existing payment Dev | PAY-A only now; start from the latest capture/failure/unpaid test receipts | Exact test order/outcome evidence, unresolved holds, no duplicate creation and zero-live-credit checks |
| DevOps | OPS-A now; OPS-B proposal and QA-A CI isolation support | Sanitized environment/catalog matrix, drift list, restore/monitoring proposal and exact candidate checks |
| QA | QA-A and independent acceptance for each packet | Reproduction, regression matrix, evidence limitations and pass/block decision |
| Owner/provider/accountant | BIZ-A automatic funding and commercial decisions | Actual supported route, current legal/account relationship, terms, limits and explicit bounded-test approvals |

Coordination: one owner for shared schema/types/query helpers; one owner for
campaign status/cron code. Agree contracts before parallel edits. Keep each
packet dependency-complete, preserve other sessions' work and test the assembled
candidate, not just individual branches. Do not open PRs or publish branches merely
because this plan names a handoff.

Every engineer returns: packet ID, exact source revision, changed paths, migration
and configuration prerequisites, reproduction before/after, commands and results,
provider evidence versus mocks, known residual risks, rollout/rollback steps and
whether any external state changed. No secrets or raw customer data.

## Final Sign-Off

QA signs off only when the relevant scenarios pass on the assembled candidate:

- Owner and wrong-tenant requests exercise both HTTP and direct database boundaries.
- No browser can forge provider observations, authority, reservations or audit actors.
- Creation/activation/pause/recovery act on only the reviewed assets and never
  silently replay uncertain external mutations.
- Complete, fresh, period-aligned spend evidence and tested capacity reservations
  cover every managed start; detection/pause limits are measured and disclosed.
- Lead import completeness, attribution limits and authorized handoff are demonstrated.
- Payment, settlement, funding, delivery and refund evidence reconcile independently.
- Database migration, restore, monitoring and rollback are tested for the exact target.
- Real customer consent, real supported funding and the separately authorized pilot
  are evidenced; mocked success does not satisfy any of these external gates.

Until then: keep the existing useful workspace available under its actual supported
limits, keep the managed money flow gated, and report progress by closed risks and
customer outcomes rather than test count or number of tables.