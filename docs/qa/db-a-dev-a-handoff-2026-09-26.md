# DB-A and DEV-A Development Handoff

Date: September 26, 2026. Status: local implementation slices, not packet closure
or release approval. Source HEAD: `9da5b07b00e54fb552796cbcf01cc5fc7c2f02e7`,
dirty `dev`. The local origin/dev reference advanced during this work; no fetch,
pull, commit, push, deployment or remote migration was performed by this worker.

## Packet Status

| Packet | Delivered here | Still required |
| --- | --- | --- |
| DB-A | Server-scoped campaign/result repository; browser write/delete restrictions; finite/nonnegative/safe-integer and period checks; same-business lead and operation FKs; server-owned draft metadata and versioned update/delete RPCs; authenticated audit provenance; fresh/upgrade/legacy SQL regressions | Independent actual local Supabase PostgREST and browser workflow acceptance; deployed grants/legacy evidence inventory; owner-reviewed legacy repair/reconciliation; managed capacity authority in DEV-B |
| DEV-A | Studio request identity persisted before POST; lost-response/reload recovery through GET; submit guard, partial-result display, deduplication, blocked-storage refusal | Durable server generation intents, same-ID/different-input rejection, atomic quota/image liability reservation, simultaneous cross-tab/request race, broader provider failure tests and browser acceptance |
| DEV-B | Enabled by DB-A contracts only; not implemented here | Reviewed destination link and exact-child delivery identity; separate durable delivery ledger; serialized managed capacity reservations; checkpointed activation/compensation and restart tests |
| DEV-C | Not implemented here | Fresh complete provider collection, explicit account-timezone period, complete scheduler pagination, measured freshness and agreed conservative pause/escalation policy |
| DEV-D | Same-business SQL association supplied by DB-A only | Durable bounded provider pagination, exact attribution, inbox keysets and privacy-safe owner-approved handoff |
| DEV-E | No cleanup or retention implementation | Reference inventory, durable cleanup intents/grace period, provider media requirements and approved financial/account retention policy |
| PAY-A | Existing payment files and uncertain orders preserved; no payment action | Coordinate with payment owner and dated provider receipts before any order recovery changes |
| PAY-B | Unchanged and gated | Account-specific funding feasibility and approved operator, tax, refund and annual service rules |

The concurrently added instruction-query fix and no-paid-call regressions belong
to the coordinator's work in the same checkout. They were preserved, not rewritten
or attributed to this worker. See [Operating Brief](../OPERATING-BRIEF.md) for the
current one-packet-per-worker handoff and payment evidence boundaries.

## Reproduction and Regression Evidence

Before application/database fixes, seven rollback-only probes reproduced accepted
campaign state forgery, result insertion, negative/reversed results, cross-business
lead association, draft version/expiry rewriting, audit actor spoofing and zero
weekly caps. Both fresh and upgraded databases failed all seven rejection tests:
14 expected failures. Other existing database tests passed.

After fixes, `TMPDIR=/tmp npm run test:meta-db` passes both schema paths, including:

- Original DB-01 through DB-05 regressions; owner SELECT and other-tenant isolation.
- Direct campaign/result/audit/draft deletes and business cascade deletion denied.
- Numeric NaN, negatives, unsafe bigint counts, half/reversed/nonfinite periods.
- Same-business lead deletion preserves business_id and nulls campaign_id only.
- Owner draft insertion resets version/time/expiry; forged p_now cannot revive an
  expired draft; two concurrent edits have one winner; operation-linked drafts
  cannot be edited/deleted; wrong-owner calls reject.
- Audit RPC is service-only, rejects a foreign actor and an implicit system actor,
  derives the owner's label from auth.users, and creates server provenance.
- Invalid legacy campaign/result/lead records remain unchanged after staged
  constraints; validation fails rather than repairing or discarding them.
- Clean fixtures pass the read-only preflight and separate validation migration.
- Existing payment, worker, operation, encrypted-token, quota and rate-limit tests.

The Studio reproduction initially failed: the POST had no durable request identity
and a lost response could not recover saved results. Its 30 tests now pass, including
remount recovery, partial results, a synchronous duplicate-submit guard, blocked
storage, and discovery of an identity already written by another tab. This last
test is not proof against two tabs writing new identities simultaneously.

Application checks:

- Seven direct trusted-repository tests pass, including denied ownership and an
  out-of-business result target. Five affected route suites pass: 56 tests.
- Audit/auto-pause suite passes: 13 tests. Draft HTTP suite passes: three tests;
  draft deletion and concurrency receive SQL coverage, not a new browser claim.
- Assembled scrubbed-environment unit/component run: 145 files passed, one skipped;
  1,806 tests passed, one paid test skipped. It includes concurrent changes present
  at discovery time, not a frozen release candidate.
- Repository lint passed. Types passed after the application slices. A later
  assembled typecheck found two errors in concurrently added
  [DevOps catalog tests](../../tests/ops-catalog.test.ts): inferred `{}` lacks
  `migrations` and `storage_buckets`. That unrelated work was not modified.
- Whitespace validation passed. No production build, hosted CI, new browser
  acceptance or provider validation is claimed here.

An independent QA Supabase stack was observed on local ports 55321/55322. This
worker only listed its containers/images; it did not migrate, authenticate against,
restart or otherwise modify that stack. QA must return actual PostgREST rejection
and positive-workflow evidence for the assembled candidate before DB-A closes.

## Authority and Caller Matrix

| Surface | Reviewed callers and authority after change |
| --- | --- |
| Campaign create | [create-service](../../src/lib/campaign/create-service.ts) uses the scoped writer with the operation service client and verified owner; HTTP and worker share this service. Existing reviewed-creative ownership checks remain |
| Campaign import | [sync route](../../src/app/api/campaigns/sync/route.ts) keeps session reads and binding checks; only verified rows cross the scoped write boundary |
| Results | [refresh route](../../src/app/api/campaigns/[id]/refresh/route.ts) retains session ownership/binding checks; scoped writer rechecks business owner and campaign membership before insertion |
| Status and deletion | [campaign route](../../src/app/api/campaigns/[id]/route.ts) uses scoped writes after the existing provider operation. Deletion still requires confirmed provider deletion; durable deletion recovery is DEV-E |
| Auto-pause | [interactive enforcement](../../src/lib/campaign/spend-enforce.ts) uses the scoped writer and does not report persistence failures as confirmed pauses. [Cron](../../src/app/api/cron/enforce-spend/route.ts) already uses a service client and explicit scheduler context; audit now uses the verified RPC |
| Draft creation | [draft POST](../../src/app/api/campaign-drafts/route.ts) and [planner](../../src/app/api/campaigns/plan/route.ts) retain session INSERT. A trigger assigns owner metadata defaults and serializes the active-draft count. Submitted version/time/expiry cannot become authority |
| Draft update/delete | [draft item route](../../src/app/api/campaign-drafts/[id]/route.ts) calls owner/version-checked SECURITY DEFINER RPCs with fixed search paths. UPDATE/DELETE grants are revoked only with this replacement present. Operation claim/checkpoint RPCs remain service-only SECURITY INVOKER |
| Audit | [logEvent](../../src/lib/audit.ts) retains its nonthrowing contract, requires a verified session actor, and calls a service-only RPC. Brand, instruction, creative approval/deletion/generation/regeneration, campaign refresh/status/deletion, lead sync, spend settings, Meta disconnect, legacy OAuth and internal traffic callers were inventoried. Cron supplies explicit cron identity; missing sessions no longer silently become system actors |
| Reads | Session-based query/preflight/draft/connection reads retain RLS. The new repository returns fixed mutation results, not an unrestricted admin client |
| Administrative utilities | Local schema/harness/fixture scripts use database administration or service clients; binding and demo scripts do not rely on owner campaign/result writes. Existing optional payment migration checks remain intact |

Owner-editable spend_limits remains a preference table, not managed financial
authority. DEV-B must use separate server-owned capacity/authorization records;
no test capture or editable preference may become entitlement. Campaign creative
UUID arrays remain unnormalized and execution ownership checks remain in place.
Immutable media membership/deletion guarantees are still DEV-E work.

## Changed Paths

Database and preflight:

- [fresh schema](../../db/schema.sql)
- [integrity migration](../../db/migrations/20260926_campaign_integrity.sql)
- [draft authority migration](../../db/migrations/20260926_draft_authority.sql)
- [trusted-write migration](../../db/migrations/20260926_trusted_campaign_writes.sql)
- [constraint validation migration](../../db/migrations/20260926_validate_campaign_integrity.sql)
- [read-only preflight](../../db/preflight/20260926_campaign_integrity.sql)
- [existing DB harness](../../scripts/check-meta-connect-db.mjs)

Application paths are linked in the caller matrix, plus the new
[trusted repository](../../src/lib/campaign/trusted-write.ts),
[types](../../src/lib/types.ts), [Studio](../../src/components/studio.tsx), and
[activity provenance display](../../src/components/workspace-home.tsx).

Tests:
[trusted repository](../../tests/campaign-trusted-write.test.ts),
[audit/auto-pause](../../tests/audit-spend-enforce.test.ts),
[sync](../../tests/campaign-sync.test.ts),
[activation](../../tests/meta-connect-w2-activation-route.test.ts),
[create](../../tests/meta-connect-w2-create-route.test.ts),
[cron](../../tests/meta-connect-w2-cron-binding.test.ts),
[refresh](../../tests/meta-connect-w2-refresh-route.test.ts), and
[Studio](../../tests/studio.test.tsx).

## Migration and Rollout Contract

1. Follow [Releasing](../RELEASING.md). Inventory the actual target, catalog,
   grants, PostgreSQL version, backups and restore evidence read-only. The SQL was
   tested with PostgreSQL 17; column-specific SET NULL requires PostgreSQL 15+.
2. Dependencies: the existing campaign-connect, WhatsApp result and reporting
   identity columns must exist. Worker compatibility is tested. The optional
   Razorpay migration is exercised by the harness but is not a dependency of
   these four migrations. No historical checksum was changed.
3. Run the preflight read-only. Nonzero counts require an evidence-backed repair
   or quarantine decision. Numerically valid historical campaign/results can
   still have been owner-authored; reconcile against the provider before treating
   them as trusted spending evidence. Legacy audit rows stay legacy_unverified.
4. Before the permission migration, quiesce affected mutation routes and drain
   in-flight create/worker/provider operations. Prepare one dependency-complete
   application/SQL candidate. Old session-write code is not compatible with the
   new grants; this is not an unrestricted rolling upgrade.
5. Apply individually reviewed incremental migrations in this order: campaign
   integrity, draft authority, trusted campaign writes. The composite unique index
   requires a table scan/lock; assess table size and use an approved lock timeout
   and maintenance window. Staged checks/FKs protect new writes without silently
   certifying legacy rows. Do not replay the whole migration directory.
6. After explicit legacy resolution, apply validate_campaign_integrity. Validate
   has its own scan/lock budget. Reload the PostgREST schema cache and run owner,
   wrong-owner, anon and service checks plus positive create/sync/refresh/pause,
   draft create/edit/delete and worker recovery workflows.
7. Keep managed paid delivery blocked until DEV-B/C and funding/commercial gates
   are accepted. No production operation is authorized by this handoff.

Rollback: stop affected mutations first. Prefer a forward fix or a tested code
revision that already supports the scoped writer and new RPCs. Do not restore
browser write privileges, turn legacy audit rows into server events, drop evidence,
or run destructive down migrations to make older code work. Recover any transmitted
provider effect from existing operation evidence; do not reissue it blindly.

## Next Dependency Decisions

QA owns actual local REST/browser acceptance; DevOps owns the concurrent catalog
type issue, deployed grants, restore and scheduler evidence. The next development
slice should agree DEV-B's separate campaign-linked delivery ledger and managed
capacity authority together with DEV-C's account-timezone spend period/freshness
contract. Reservation expiry must not release uncertain external liability.
DEV-D needs historical-form scope and a consented handoff owner; DEV-E needs an
approved retention/grace-period policy. None of these decisions is replaced by
the current owner-editable preference table or mocked provider responses.

## O-2: DEV-B Delivery and Reservation Proposal

Worker: Dev. Packet: DEV-B. Board: O-2, September 26, 2026.
Contract: CONTRACT-BC, **DRAFT / not accepted**, proposal B-2 after review of
Dev 2's C-draft-1. B-2 replaces B-1's implicit coverage arithmetic, not the board.
This is the delivery half for Dev 2, QA, DevOps and CEO review, not permission
to implement storage, change spend policy, activate campaigns or migrate a database.
Earlier implementation/test receipts above retain their original scope. O-2's
independent B acceptance supersedes their outstanding local DB-A/F5/F8 checks
only for the exact B candidate, not for every later edit or all of DEV-A.

### Source and Discriminating Evidence

- Baseline: QA candidate B, HEAD `9da5b07b00e54fb552796cbcf01cc5fc7c2f02e7`,
  manifest `9533d1d0e81069291536e6b97c020334eb1ddbf48858d31181a0181e0b5e4d13`.
  Its preserved archive/reconstruction remains QA/DevOps-owned.
- Current read-only inspection: dirty `dev` at the same HEAD, two commits behind
  the local tracking reference. This moving tree is not a frozen candidate.
- The [status handler](../../src/app/api/campaigns/[id]/route.ts) reads capacity,
  calls the provider, then calls `saveCampaign`. The
  [review payload](../../src/lib/campaign/activation.ts) lacks reviewed child IDs
  and the effective destination. DB-A trusted writes do not serialize admission.
- QA's [activation evidence](independent-acceptance-2026-09-26.md#f3-concurrent-capacity-and-uncertain-activation)
  establishes two concurrent INR 200/day admissions under an INR 2,000/week cap,
  and a repeated provider mutation after a successful call followed by failed
  local persistence. These are QA's prior failures, not a new execution by Dev.
- Falsifiable proposal: reserving capacity and creating an immutable operation
  under one business lock before any provider mutation prevents both admissions;
  a durable pre-call checkpoint prevents an uncertain retry from blindly mutating.
  The two original failing assertions are the first discriminating product checks.

### Identity and Reviewed Authority

Proposed review v2 is canonical server-generated data, not a client-authored plan:
business/user authority, local/provider campaign IDs, ad account, Page, connection
generation, sorted exact ad-set/ad IDs with parent relationships, creative/asset
revisions, effective destination, budget/schedule, currency, account timezone,
period, policy version and authority revision. Hash a versioned canonical payload.
Display names are not stable identity. Duplicate children, children outside the
bound campaign/account, and missing or ambiguous hierarchy fail review.

Normalize and validate the actual website/form/WhatsApp destination before both
review and provider creation. Recompute against current authoritative inputs at
admission and verify the actual provider object against that review. A changed
brand link, asset, child, budget, generation or schedule requires a new review.
No worker may reconstruct missing legacy child authority by activating every ad.
Imported children not explicitly reviewed for activation remain unchanged.

An operation is keyed by `(businessId, requestKey)` with a server-stored command
hash. Exact replay returns the existing operation; a different command with that
key returns `IDEMPOTENCY_CONFLICT`. A second key cannot bypass an in-flight or
uncertain operation for the same campaign. Changing review after admission fences
unsent work and invokes protective reconciliation for already transmitted work.

### Money, Period and Exposure

All shared money fields are nonnegative safe-integer minor units with explicit
currency; daily budgets and configured caps must be positive. Convert existing
rupee decimals exactly at the adapter boundary, rejecting extra precision and
unsafe sums/products rather than rounding silently. V1 supports INR, not implicit
FX conversion. SQL bigint values must also remain inside the shared safe range.

DEV-C supplies a period identity containing IANA account timezone and exact UTC
`[start, end)` instants for a Monday-to-Monday local week. Do not derive a DST week
as a fixed number of milliseconds. The capacity lock is business-wide, not per
account: account changes cannot create another copy of the same business cap.
For this bounded version, conflicting account timezones or overlapping policy
periods block new admission pending reconciliation. Multi-account calendar policy
requires joint agreement rather than silently splitting the cap.

Proposed weekly admission accounting, for each campaign in that period:

```text
S = latest trusted cumulative incurred spend, including paused campaigns
C = held reservation ceiling for the authorized interval
K = proven portion of S already covered by C, with 0 <= K <= min(S, C)
U = identified uncertain exposure outside C, never duplicated inside another hold
campaign exposure = S + (C - K) + U
business exposure = sum(campaign exposure) + unattributed liability + safety reserve
admit only when evidence is usable and proposed business exposure <= weekly cap
unknown coverage or unbounded liability => UNKNOWN, not an admission amount
```

`C - K` is remaining held exposure. For a fresh INR 200/day start with no prior
spend, the conservative ceiling is `20000 * 7 = 140000` paise, even for a midweek
start. Repeated activation reuses the same ceiling and coverage; resizing it
requires a new reviewed delta under the same lock. Prior spend cannot automatically
be credited against a newly authorized future interval. K requires provenance
linking observation, reservation/effect, account, period and authorized interval;
one observed paise cannot cover multiple holds. Unknown overlap retains the full
hold and blocks admission rather than labelling an overlapping bound exact.
The old `max(S,C)` shorthand is valid only when K is proven to equal `min(S,C)`;
it is not the general decision rule. Spend beyond a covered ceiling still counts.
Externally active campaigns must be included in the complete inventory and held
conservatively, or the business becomes unknown and cannot admit another start.

Each uncertainty record needs a stable effect/operation identity, period, amount
or an explicit unbounded marker, and linkage showing whether C already covers it.
Unbounded or unattributed unknown exposure blocks admission, never becomes zero.
An ambiguous transmission already covered by C keeps C held; it does not also
create an identical U. DEV-C publication and Dev reservation updates must agree
on this coverage linkage before either side can replace evidence or release holds.

Pausing does not erase S. Only verified inactivity plus reconciled late-spend
liability permits reducing C. Observation freshness is not settlement/finality:
a collection watermark alone cannot certify that delayed provider reporting is
finished. Without an approved lag/uncertainty policy or explicit reconciliation,
retain the hold. At week rollover, preserve the old period's unresolved records;
establish the new period's active commitments before permitting new starts.

The weekly cap is a planning guardrail, not a guaranteed provider cash ceiling,
annual entitlement or available funds. Owner-editable spend preferences cannot
grant managed financial authority. A missing managed cap/policy/authority blocks
managed admission. Existing uncapped non-managed settings must not be silently
reinterpreted as managed authorization; their compatibility is a separate case.

Account totals and campaign rows must reconcile: unattributed incurred spend
is the nonnegative account-total remainder, not the account total added again.
Unattributed spend and uncertain liability retain distinct provenance even when
combined in the fixture's `unattributed` field. Inconsistent totals are UNKNOWN.
The approved `safetyReservePaise` is additional policy headroom, not customer cash;
it is explicit even when zero in a fixture. No production reserve is inferred here.

Proposed arithmetic fixtures, all amounts in paise with otherwise usable evidence:

```json
[
  {"case":"first_start","cap":200000,"positions":[{"spend":0,"commitment":140000,"covered":0,"uncovered":0}],"unattributed":0,"safetyReserve":0,"expectedExposure":140000,"admit":true},
  {"case":"second_concurrent_start","cap":200000,"positions":[{"spend":0,"commitment":140000,"covered":0,"uncovered":0},{"spend":0,"commitment":140000,"covered":0,"uncovered":0}],"unattributed":0,"safetyReserve":0,"expectedExposure":280000,"admit":false},
  {"case":"covered_spend_and_replay","cap":200000,"positions":[{"spend":30000,"commitment":140000,"covered":30000,"uncovered":0}],"unattributed":0,"safetyReserve":0,"expectedExposure":140000,"admit":true},
  {"case":"paused_reconciled_plus_start","cap":200000,"positions":[{"spend":30000,"commitment":0,"covered":0,"uncovered":5000},{"spend":0,"commitment":140000,"covered":0,"uncovered":0}],"unattributed":0,"safetyReserve":0,"expectedExposure":175000,"admit":true},
  {"case":"uncertain_pause_keeps_hold","cap":200000,"positions":[{"spend":30000,"commitment":140000,"covered":30000,"uncovered":0},{"spend":0,"commitment":140000,"covered":0,"uncovered":0}],"unattributed":0,"safetyReserve":0,"expectedExposure":280000,"admit":false},
  {"case":"incurred_above_envelope","cap":200000,"positions":[{"spend":160000,"commitment":140000,"covered":140000,"uncovered":0}],"unattributed":0,"safetyReserve":0,"expectedExposure":160000,"admit":true},
  {"case":"unattributed_bounded_liability","cap":200000,"positions":[{"spend":0,"commitment":140000,"covered":0,"uncovered":0}],"unattributed":70000,"safetyReserve":0,"expectedExposure":210000,"admit":false},
  {"case":"coverage_unknown","cap":200000,"positions":[{"spend":30000,"commitment":140000,"covered":null,"uncovered":0}],"unattributed":0,"safetyReserve":0,"expectedExposure":null,"admit":false},
  {"case":"approved_safety_reserve","cap":200000,"positions":[{"spend":0,"commitment":140000,"covered":0,"uncovered":0}],"unattributed":0,"safetyReserve":70000,"expectedExposure":210000,"admit":false}
]
```

These fixtures test proposal arithmetic, not real provider limits or implemented
concurrency. Unknown, stale, partial, wrong-period or invalid-currency evidence
returns UNKNOWN before arithmetic, even if the numeric fixtures would fit.

### Durable Operation and Shared Interfaces

Proposed Dev-owned modules, names requiring contract acceptance before creation:
`src/lib/campaign/delivery-contracts.ts`, `delivery-store.ts`, and
`delivery-service.ts`. Keep the single admission decision in that service;
DEV-C requests verified protective pause through it rather than implementing
another activation/reservation or provider-mutation pipeline.

Internal interfaces proposed for the shared contract, not HTTP-authorized input:

| Interface | Input and result | Writer / required invariant |
| --- | --- | --- |
| `readCapacitySnapshot(scope)` | Trusted business/account/period scope -> authority/policy versions, revision, accepted observation ID, positions, holds and usable/unknown reasons | Dev store; one coherent snapshot, never a mix of independently read revisions |
| `publishSpendObservation(scope, expectedRevision, observation)` | DEV-C validated observation -> accepted/stale/conflict and new revision | Dev implements SQL/shared publication boundary; Dev 2 owns collection. Publication and reservation changes share the business lock; partial/failed runs remain diagnostics, not trusted replacement |
| `requestDelivery(actor, command)` | Verified actor; requestKey, campaignId, desiredStatus, reviewed identity -> operation/result | Dev; reload policy/authority/binding server-side, atomically recheck evidence and reserve with intent before dispatch |
| `requestProtectivePause(actor, command)` | Authorized actor/job; campaign/binding, stable requestKey, reason and triggering observation ID -> operation/result | Dev; no positive spend evidence or free capacity required, but exact target authority still required |
| `claimDeliveryStep(operationId, expectedRevision)` | Worker claim -> step, lease/fence and original target binding | Dev; persist dispatch intent before I/O, one unresolved transmission per effect |
| `recordDeliveryObservation(operationId, fence, evidence)` | Authenticated provider read/result with exact object/state/checkpoint -> new operation revision | Dev; stale worker cannot overwrite current state; observations cannot silently free uncertain capacity |
| `reconcileDelivery(actor, operationId)` | Authorized reconciliation of stored original targets -> confirmed/pending/review-required result | Dev; read before any retry of an ambiguous effect; no caller-supplied release amount |

Minimum DEV-C observation fields requested for review: `observationId`, business,
account and generation, period/timezone/currency, monotonic collection revision,
`collectionStartedAt`, `collectionCompletedAt`, provider query coverage and
watermark semantics, complete campaign inventory, per-campaign cumulative spend
and observed budgets/status, validity/completeness, continuation and unknown
reason. These are requirements for Dev 2's proposal, not a competing collector
schema. Agree exact names/types, maximum usable age, ordering rules and treatment
of lower revised spend before publication SQL is implemented. A failed latest run
may preserve historical good evidence, but cannot keep it fresh indefinitely.

Use one short transaction and fixed business-first lock order for authority,
observation publication, operation claims and capacity updates; increment a
business revision. Revalidate optimistic revisions under the lock or return
`REVISION_CONFLICT`. Never hold a database lock during provider I/O. Jobs never
trust a browser-supplied business/account or an old owner capability implicitly.

Separate operation states from desired/provider status: `reserved`, `dispatching`,
`verifying`, `confirmed`, `compensating`, `needs_reconciliation`, and
`cancelled_before_dispatch`. Persist immutable step targets, attempt/fence IDs and
known responses. A lost response or crash after dispatch is uncertain, not a new
attempt. Lease expiry lets a worker reconcile, not release capacity or resend.
If local status mirroring fails after a verified provider success, resume the
checkpointed mirror operation; do not issue ACTIVE again to repair a local row.

For newly created paused trees, verify parent PAUSED, enable only reviewed children,
then enable parent and read back the exact intended hierarchy. On partial failure,
pause the original authorized delivery targets and verify observed inactivity;
keep failed/uncertain compensation visible with exposure held. Existing active
parents or imported trees require an explicit reviewed transition plan rather
than this paused-tree shortcut. Generation/authority changes fence subsequent
activation steps. Protective pause may use only a freshly authorized credential
for the original account, never the newly selected unrelated account; if unavailable,
retain uncertainty and escalate. No database lease can unsend a provider request.

Proposed errors/results: `REVIEW_CHANGED`, `BINDING_CHANGED`,
`IDEMPOTENCY_CONFLICT`, `REVISION_CONFLICT`, `CAPACITY_EXCEEDED`,
`EVIDENCE_UNKNOWN`, `AUTHORITY_UNAVAILABLE`, `OPERATION_PENDING`, and
`RECONCILIATION_REQUIRED`. HTTP adapters distinguish rejected/no-dispatch from
accepted/pending operations. Return 202 plus operation ID for uncertain/pending
work, and 200 confirmed only after provider verification and durable persistence.
Retain 401/404 tenant protections, 409 review/key conflicts, 422 capacity rejection,
and 503 unavailable admission dependencies. No error implies liability was released.

### DB-A Compatibility and Acceptance Requests

- Dev owns coordinated additive SQL/types/shared query/Meta-client changes after
  contract acceptance. Use separate campaign-linked delivery operations and
  capacity records; do not change the create ledger's create-only/draft uniqueness.
  Keep private storage, service-only execution, same-business constraints and
  session/worker actor verification. No browser write grants or evidence backfill.
- Spend publication, cap/authority changes and all start/resume paths must obey
  the shared serialization contract. Cap reductions below exposure block new
  starts and trigger an explicit protective decision, not deletion of commitments.
  Financial/refund holds are an interface requirement, not permission to implement
  PAY-A. Existing row status cannot be promoted to managed authority.
- Proposed deployment sequence: accepted contract and tested additive migration;
  coordinated delivery/spend adapters with execution gated; independent frozen
  candidate checks; separately approved rollout. Exact migration filenames/checksums
  and rollback-compatible app artifact are Dev/DevOps outputs, not invented here.
  Review v1 callers must refresh to v2 before activation; they cannot bypass the
  new identity. Required caller/UI changes need an explicit owner/path handoff.
  An old parent-only activation app is not a safe rollback while delivery is enabled.

| Reviewer | Concrete agreement or deliverable requested |
| --- | --- |
| Dev 2 | Confirm observation envelope, business lock/revision, cumulative spend semantics, ordering, period rollover and explicit coverage/reserve accounting; resolve the C-draft-1 review items below |
| QA | Preserve both activation assertions without skip/inversion; add changed child/link/budget/generation, unknown evidence, concurrent publication/reservation, no double count, externally active inventory, restart-after-send and failed-compensation cases |
| DevOps | Supply verified same-input writable source allocation and execution slot; identify additive migration/rollback compatibility and achievable observation-to-confirmed-pause timing, including retries/outages |
| CEO/owner | Resolve explicit policy values, authority source, multi-account/calendar treatment, late-reporting uncertainty and escalation ownership; record accepted CONTRACT-BC version and permitted implementation scope |

The proposed five-minute cadence is not adopted as a default or service promise.
Maximum observation age, dispatch/reconcile deadlines, reporting-lag treatment,
sweep interval and incident escalation require named policy inputs and measured
feasibility. Missing production policy keeps new managed execution disabled.

### Checkpoint and Resources

Changed only this owned handoff. No product, test, SQL, package or board writes;
no provider requests, migrations, builds, servers, credentials or deployment work.
O-2's prior ownership conflicts are resolved; no additional active writer was
observed on this handoff. Other workers' dirty changes remain untouched.

At the initial checkpoint, `/tmp/adbrain-dev-b-o1`, `.qa-artifacts/dev-b-o1/`,
Dev 2's proposal and QA's new handoff were absent. Dev 2's proposal subsequently
became available and was reviewed below. Logical reservations remain with the
O-2 register; no source copy, heavy-run slot, terminal daemon, port, database or
VM is claimed as allocated. Do not reuse deleted QA launchers or reconstruct B
independently while DevOps supplies the common source.

Next executable product check: after QA supplies hashed activation assertions and
DevOps supplies the verified isolated writable copy/slot, adopt them in that
copy's existing activation suite, preserving its trusted-write mocks and dirty
baseline changes. Expected baseline result is two failures. Do not patch the
shared moving tests or invert expectations to obtain a passing run. Implementation
remains contract-blocked; Dev's initial cross-review is recorded below.

### Dev Review of C-draft-1

Reviewed [Dev 2's O-2 proposal](dev2-devc-contract-o1.md), revision C-draft-1.
This is Dev's response, not a claim of Dev 2 acknowledgement or CEO acceptance.

Agreement: one business capacity lock/revision; INR minor units; the explicit
Monday account-local period; old-account liability surviving reconnect; complete
inventory including paused/unmapped/deleted-cost records; immutable cumulative
observations; no lower correction, timeout or lease-based liability release;
service-only storage; and protective pause through Dev's single delivery service.
Accept C-draft-1's exact DEV-C module/test names as requests within Dev 2's scope,
and its BC-C1 through BC-C6 shared-interface requests for contract review, not
permission to implement them before CEO acceptance.

Resolved on Dev's side: B-2 adopts explicit proven coverage and approved safety
reserve from C-draft-1. Unknown coverage blocks admission. QA should verify the
new `coverage_unknown` case; no general `max(total projected,total observed)`
shortcut remains. Cumulative snapshot replacement must not sum deltas.

Remaining decisions requiring Dev 2/QA review:

1. **Coverage proof:** agree the machine-checkable reservation/observation/interval
  linkage and unique credited amounts. `providerDataThrough=null` must not
  manufacture finality. For a provider without adequate coverage evidence,
  retain UNKNOWN rather than shipping an always-assumed credit heuristic.
2. **Publication source of truth (BC-C3):** adopt the run/lease-based RPC proposed
  by Dev 2. Derive publication time, sequence, completeness and the accepted
  envelope from durable validated pages, not a caller-selected complete boolean.
  B-2's `publishSpendObservation` is the service boundary, not a second direct
  arbitrary-envelope RPC. SQL names and result unions remain acceptance outputs.
3. **Inventory and freshness (BC-C1/2):** `listSpendCampaignsPage` currently proposes
  ID/account/status but no observed budget. Either add checked budget/currency
  provenance or explicitly require Dev's provider verification before admitting
  that object's exposure; ACTIVE alone never supplies a commitment amount.
  Specify oldest-page time in the envelope or derive a conservative lower bound
  from the earliest request time; a fresh final response cannot hide stale pages.
4. **Unmapped protective targets (BC-C5):** C-draft-1 permits null local campaign
  attribution, while `requestProtectivePause` requires a local campaign ID.
  V1 should keep such scopes unknown and escalate rather than fabricate IDs or
  mutate unreviewed imported children. Broader account-level pause authority
  needs a separately reviewed target/authorization contract.
5. **Naming/read API:** propose canonical `requestKey` on Dev's internal command;
  Dev 2's `idempotencyKey` maps once at the adapter, not to a second dedupe key.
  Accept `getDeliveryOperation(actor, operationId)` with the BC-C5 result union;
  `confirmedAt` is null until verified and durably recorded. Recovery reads must
  not dispatch provider mutations. Agree exact SQLSTATE/result and HTTP mapping.
6. **Policy and enrollment:** accept the explicit C-draft-1 policy input list and
  enforcement registration before managed activation. Its unknown-active action
  remains a proposed owner-approved policy, not authority to pause arbitrary
  existing campaigns. Effective cap/authority changes must acquire the same lock.

Regressions remain pending the allocated copy and QA's hashed handoff; no expected
failure was skipped or converted into a pass. No other worker's proposal was edited.

### Proposal Validation Receipt

Node v22.12.0 inline `node:assert/strict` checks passed for the nine JSON fixtures:
safe integer amounts, covered amount bounded by both spend and ceiling, explicit
UNKNOWN on null coverage, expected exposure and admission decision. All 36 local
links resolved; ASCII, trailing whitespace and code-fence checks passed. Editor
diagnostics reported no errors before the cross-review; this is document/fixture
validation, not Node 24/Linux acceptance or a passing product regression suite.

The inspected behavior-controlling files were rehashed unchanged after review:

| Inspected path | SHA-256 |
| --- | --- |
| Campaign status route linked above | `91f2fa981aca23c0dbf81316c6c053f38126fefc3ed72f4d0e3f96c271734e25` |
| Activation review payload linked above | `58f9b07a3df58b1cf9eb7da0749a4a24064d1eb0d659bc6754fb62401df55f3a` |

Only this owned handoff changed. No product tests, provider operations or shared
services were run. No heavy-run slot or operating-system resource is held.
Next consumers: Dev 2 and QA for contract review, DevOps for isolated regression
allocation, then CEO for a single accepted CONTRACT-BC version.

## O-4: B-3 Contract Reconciliation Checkpoint

Worker: Dev / DEV-B. Board: O-4. Proposal: **B-3, DRAFT / not accepted**.
This section supersedes B-2's open field-name, type-location and adapter-mapping
requests above; B-2's reviewed identity, coverage accounting and recovery rules
remain unless explicitly refined here. It does not supersede CEO contract gates
or attribute reciprocal agreement to another worker.

Inputs read directly in the shared workspace: [C-draft-2](dev2-devc-contract-o1.md),
[QA-BC-cases-1 and R1-R6](qa-a-o1-handoff.md#contract-bc-review), and the
[DevOps source allocation](ops-environment-2026-09-26.md#workspace-and-resource-register).
The isolated source and QA artifacts have been delivered; dependency/execution
readiness, not missing source delivery, is the remaining runtime prerequisite.
The shared checkout remains dirty dev at the previously recorded HEAD. This is
contract work, not product implementation or independent acceptance of B.

### Exact C-draft-2 Mapping

Dev agrees with C-draft-2's amended envelope, BC-C2 budget evidence and B-1
cross-review as refined by B-2/B-3. The following is the concrete proposed
shared contract; Dev 2 and QA review it from this file, CEO accepts a version.

| Surface / request | B-3 mapping |
| --- | --- |
| BC-C1 shared type location | One runtime-validated domain envelope in proposed `src/lib/campaign/delivery-contracts.ts`; persistence/RPC row types alone remain in `src/lib/types.ts`. No duplicate collector envelope |
| B collectionStartedAt | C `requestStartedAt`: earliest request in the accepted collection, not the latest retry |
| B collectionCompletedAt | C `responseReceivedAt`: final response; `oldestResponseReceivedAt` remains separately required; `publishedAt` never renews freshness |
| B inventory/budget request | C `campaignInventory`, `inventoryRevision`, `effectiveDailyBudgetPaise` and `budgetEvidence`; exact complete inventory is bound to the published spend snapshot |
| BC-C2 provider contract | Accept checked effective budget and bounded hierarchy streams; preserve the existing reporting API. Unknown active budget/control is unknown admission evidence, not zero |
| BC-C3 publication | `publishSpendObservation(actor, {collectionId, leaseToken, expectedCapacityRevision})` calls `publish_spend_observation`; derive envelope/sequence/completeness from durable pages. Do not accept a caller-supplied complete observation |
| BC-C4 sweep | Accept the proposed claim/checkpoint/keyset APIs with service-verified actor, persisted high-water and lease/revision checks; no second capacity counter |
| BC-C6 evidence read | `getManagedSpendEvidence(actor, scope, period)` projects evidence from `readCapacitySnapshot(actor, scope, period)` in one coherent read. It must not independently recombine limits, holdings and observations |
| BC-C5 pause identity | Canonical `requestKey`, scoped with business ID. A legacy `idempotencyKey` may be translated once before validation; supplying both is rejected. No second dedupe domain |

Use C-draft-2's `SpendScope`, `SpendPeriod`, `SpendObservation` and `SpendEvidence`
field names and decimal-string capacity/collection revisions. Timestamps, scope,
safe money and stream/page identities are runtime validated. Add explicit unknown
reasons `coverage_unproven`, `reporting_lag_unproven`, `attribution_unverified`,
and `inconsistent_totals` rather than describing these failures as usable evidence.
These additions are proposed changes for Dev 2 to acknowledge, not edits to its file.

Store the accepted observation's inventory revision and query/stream digest with
the capacity revision. Duplicate campaign IDs, a missing terminal stream, a budget
without checked hierarchy/currency, or a mismatched inventory invalidate admission.
Account/period and ownership fences are checked server-side on every adapter.

### R1 and R2: Coverage, Reserve and Account Reconciliation

Select B-2's explicit `S + (C - K) + U` accounting, summed over independently
attributed positions, with account residual and the approved safety reserve each
added once. Agree with C-draft-2: for two campaigns with S=(160000,0), C=(140000,
140000), K=(140000,0), total exposure is 300000, not the global-max result 280000.
At 190000 exposure plus reserve 10000, a cap of 200000 passes arithmetic; one
additional paise fails. Neither arithmetic result bypasses evidence/authority gates.

Coverage record required before K can be nonzero: reservation/effect ID,
observation/collection ID, provider account/campaign, currency, exact period,
authorized interval, covered minor units and evidence of query containment and
attribution. Enforce both individual bounds and aggregate uniqueness: credits
across all reservations cannot exceed the attributable observed amount. Campaign
ID alone, a fresh GET or a fixture label is not proof. For a new zero-spend
reservation K=0 is explicit; later unknown overlap is UNKNOWN and preserves holds.
Only a verified supported provider interval/attribution contract can produce an
automated credit; its adapter tests and QA acceptance are still required.

Credit for already reported attributable spend is distinct from releasing a
remaining reservation after pause. The latter also requires verified inactivity
and reconciled reporting-lag liability. A null watermark or expired lease proves
neither finality nor zero future reporting. The B-2 bounded-U fixture requires
independent policy/evidence for that bound; it does not authorize guessing 5000.

Dev agrees to require exclusive verified business attribution for the initial
managed account model, subject to CEO acceptance. Reconcile account total 70000
against mapped campaign spend 50000 as residual 20000 and incurred total 70000,
not 120000. Unmapped/deleted cost remains in residual; known residual is distinct
from unbounded uncertainty. Negative residual, incomplete attribution streams,
shared/unverified account ownership or an unresolved previous binding blocks new
managed starts. Do not fabricate local campaign IDs or drop old-account liabilities.

### R3 and R5: Freshness and Reporting Evidence

Accept the C-draft-2 field mapping above. Check freshness at the trusted decision
time using oldest response age, as well as final-response minus earliest-request
collection span. Equality at an approved age limit is allowed; one millisecond
over is stale. Future timestamps beyond approved skew, reversed timestamps or
missing policy are invalid. Publication, restart and retry cannot reset these ages.

B-3 proposes a strict initial rule: `providerDataThrough=null` yields
`reporting_lag_unproven` for automatic managed admission. A configured maximum lag
is not evidence that the provider actually meets it. A non-null watermark must
be verified, scoped to the accepted query and within an approved lag bound; it
does not independently prove final settlement or authorize reservation release.
DEV-C may retain complete observations as historical/reporting data while the
admission projection remains unknown. Its successful HTTP fetch is not authority.

This rule may leave standard Meta observations ineligible for managed admission.
That is an explicit feasibility decision for CEO/owner, not a claim that the
provider supplies this evidence. Any alternative assurance/bounded-risk route
needs its own proven evidence, policy and contract revision before enablement.
Until approved, no undocumented allowance for a fresh-but-unbounded observation.

Unknown active delivery follows a proposed, explicitly configured
`request_verified_pause_and_escalate` policy. No production default or five-minute
service promise is introduced. The approved reserve, observation/span/lag/skew
bounds, deadline/work budgets, response ownership and confirmed-pause objective
must all be explicit; DevOps must demonstrate the achievable timing separately.
Protective pause cannot turn unknown spend into usable evidence.

### R4 and R6: Pause, Recovery and Outcome Mapping

Exact proposed internal command/result vocabulary (identifiers validated at runtime):

```ts
type ProtectivePauseCommand = {
  scope: SpendScope;
  campaignId: string;
  requestKey: string;
  reason: SpendUnknownReason | "manual" | "compensation";
  observationId: string | null;
};
type DeliveryOperationView = {
  operationId: string;
  revision: string;
  state: "pending" | "confirmed" | "unknown" | "failed";
  confirmedAt: string | null;
};
type DeliveryRequestResult =
  | { kind: "accepted"; operation: DeliveryOperationView }
  | { kind: "rejected"; code:
      "NOT_FOUND" | "UNAUTHENTICATED" | "AUTHORITY_UNAVAILABLE" |
      "REVIEW_CHANGED" | "BINDING_CHANGED" | "IDEMPOTENCY_CONFLICT" |
      "REVISION_CONFLICT" | "CAPACITY_EXCEEDED" | "EVIDENCE_UNKNOWN" |
      "INVALID_INPUT" | "STORAGE_UNAVAILABLE" };
```

`requestProtectivePause(actor, command): Promise<DeliveryRequestResult>` records
or returns the same operation. Actor verification and stored binding resolve the
original account/children; command scope is checked, never trusted. The triggering
observation may be absent for missing-evidence/manual actions, but the reason and
authenticated actor remain mandatory. No observation is fabricated for admission.

`getDeliveryOperation(actor, operationId): Promise<DeliveryOperationView | null>`
is a scoped read with no provider dispatch. `reconcileDelivery(actor, operationId):
Promise<DeliveryRequestResult>` is a separately authorized mutation/recovery path.
An unavailable store is not NOT_FOUND. Wrong-tenant and missing operation reads
share the same nondisclosing outward 404; unauthenticated reads return 401.

| Durable state | Consumer state | confirmedAt / safety meaning |
| --- | --- | --- |
| reserved, dispatching, verifying, compensating | pending | null; no confirmed delivery/pause or released exposure |
| needs_reconciliation | unknown | null; failure/timeout does not prove inactivity |
| confirmed | confirmed | verified provider evidence plus durable confirmation timestamp |
| cancelled_before_dispatch | failed | null; cancellation proven before any dispatch; release only its proven untransmitted reservation delta under the shared lock |

Failed compensation or a known provider rejection after earlier partial effects
maps to unknown, not terminal failed. Other terminal-failure meanings require a
new accepted state; the consumer cannot infer them from HTTP status. Request
rejections return the typed error, not a fake confirmed/failed operation ID.

HTTP mapping: INVALID_INPUT=400, UNAUTHENTICATED=401, NOT_FOUND=404,
AUTHORITY_UNAVAILABLE=403, review/binding/key/revision conflicts=409,
CAPACITY_EXCEEDED=422, EVIDENCE_UNKNOWN/STORAGE_UNAVAILABLE=503 before dispatch.
An accepted pending/unknown operation returns 202 and its ID; a durably confirmed
operation returns 200. Replaying a cancelled-before-dispatch operation returns
its failed view without executing it again. Reads may return 200 with a pending
view; clients must use the typed state, never interpret any 2xx as pause success.

For v1, external campaigns without a local ID are not accepted pause targets.
Keep their scope unknown, retain incurred cost/uncertainty, and escalate for
reviewed mapping/authority. A new selected account never grants authority over
an old/unmapped account; no arbitrary account-wide pause or imported-child loop.

Accept C-draft-2's sweep projection independently of delivery HTTP status:
partial/unknown collection or any required unconfirmed protective action means
503/ok=false with durable continuation/operation references. Only complete usable
in-scope evidence and durably confirmed required pauses produce ok=true and
confirmed paused IDs. A nested 202, a 200 read of pending state, or a successful
pause with still-unknown spend cannot make the sweep green.

### R1-R6 Disposition and Next Consumer

| QA request | Dev disposition in B-3 | Still required |
| --- | --- | --- |
| R1 | Explicit unique coverage and reserve-once formula; per-campaign/global-max counterexample and exact-cap boundary | Dev 2 acknowledgement, executable coverage adapter proof and QA review |
| R2 | Exclusive initial attribution, account residual once, old/unmapped liability retained | CEO policy acceptance and QA BC-12/22 |
| R3 | C-draft-2 envelope/location/timestamps/inventory accepted with explicit unknown reasons | Dev 2 acknowledges additions; accepted shared runtime schema |
| R4 | requestKey, typed command/result, read vs reconcile and all operation-state projections specified | Dev 2 agreement; QA BC-02/07/22/23; CEO unmapped-target restriction |
| R5 | Null/unproven reporting coverage blocks automatic managed admission; policy is not evidence | Provider feasibility and owner policy decision; QA BC-14/15/23/24 |
| R6 | Delivery operation status cannot imply completed sweep; distinct 202 vs 503 semantics | Dev 2 agreement and QA nested-outcome assertions |

No row is labelled QA-accepted. Dev's next consumer is Dev 2/QA directly through
this saved file, followed by CEO contract acceptance. DevOps must supply isolated
dependency installation and execution readiness before the preserved activation
regressions run. No shared install, unreserved test execution, product/SQL edit,
provider request, publication or service startup is part of this checkpoint.

### O-4 Verified Inputs and Execution Request

Read-only consumption checks completed using Node v22.12.0, without executing
the allocated dependency tree or reconstructing B:

| Input | Verified result / identity |
| --- | --- |
| Dev source `/tmp/adbrain-dev-b-o1` | All 529 manifest-listed file contents match the delivered B manifest `9533d1d0e81069291536e6b97c020334eb1ddbf48858d31181a0181e0b5e4d13`; no product overlay applied |
| [QA manifest](../../.qa-artifacts/qa-a-o1/handoff-YTrGx9/manifest.json) | SHA-256 `642bc8093c74d4c0689eff9b1516a65467e894854ed44dc70c7ada517d9fcce1`; all 19 listed artifact hashes match |
| [Activation assertions](../../.qa-artifacts/qa-a-o1/handoff-YTrGx9/reproducers/qa-activation-recheck.test.ts) | SHA-256 `2f0560e90d5a11197ee238ba137cdee97aa8a026207a16928d32c04eb564211c`; both preserved cases have historical B outcome failed |
| [QA decision vectors](../../.qa-artifacts/qa-a-o1/contract-cases-o2.json) | SHA-256 `2e8b26ea48e5c49b45e268262381e6096d3daa86f269a0a7f21e2041516377ce`; 25 cases supplied, not product tests executed |

Specific runtime blocker observed: the allocated copy has a non-symlink
`node_modules` directory, but no `node_modules/.bin/vitest` executable. The
current [DevOps O-4 receipt](ops-environment-2026-09-26.md#o-4-dependency-and-browser-fixture-handoff)
explicitly marks dependency preparation in progress, not execution-ready. Do not
infer failure or readiness from the partial directory, change it, link shared
dependencies, install another tree or run tests against an active installation.
The prior missing-QA-artifact/missing-source blockers are superseded, not repeated.

Request to DevOps, directly through this receipt: publish the completed isolated
dependency result (Node 24 executable/PATH, lock/dependency identity, install and
guard checks), confirm the Dev copy is no longer being provisioned, and allocate
the short single-worker activation regression execution. No server/DB is needed.
Once ready, Dev will preserve the current test suite, adopt the two exact QA
assertions with its trusted-write mock, record overlay hashes and run the owned
activation suite filtered to `QA F3:` with the existing Vitest configuration,
`--pool=threads --maxWorkers=1`, scrubbed placeholder environment, paid evaluation
disabled and the agreed provider-egress guard. The expected B result remains two
failures; a runtime/import/setup failure is not reproduction of either assertion.

Validation for B-3: local document links/anchors, ASCII/whitespace/fences, all six
R1-R6 dispositions, coverage arithmetic, the per-campaign 300000 counterexample,
reserve-once/exact-cap/one-paise-over and age-limit boundaries passed. The nine
B-2 JSON fixtures remain part of the handoff. This validates the draft's examples
and input integrity only; no product, browser, database, provider, Linux or hosted
acceptance is claimed.

Checkpoint: **complete for draft reconciliation and input verification**; contract
still DRAFT. Only this shared owned handoff changed. The allocated Dev source copy
is retained, unchanged at the checked manifest paths, for the upcoming regression
handoff. No dependency writes, additional source reconstruction, background worker,
heavy execution slot, server, port, database or VM was acquired. Do not delete the
allocated copy; its later cleanup remains subject to explicit release.

Next consumers: Dev 2 for B-3 agreement/deltas; QA for R1-R6 and case binding;
DevOps for the completed dependency/execution receipt; CEO for one accepted
CONTRACT-BC version and the explicit reporting-evidence/authority decisions.
The owner need not copy this response between chats.

## O-5: Canonical Integration Delta D-1

Dev / DEV-B; board O-5; **CONTRACT-BC DRAFT / not accepted**. Consolidates
[B-3](#o-4-b-3-contract-reconciliation-checkpoint) with
[C-draft-3](dev2-devc-contract-o1.md#o-4-checkpoint-c-draft-3). This compact delta
supersedes only their conflicting interface choices. No new coverage, funding,
reporting-lag or pause-authority policy is approved; QA R1-R6 remain independent.
Current source is dirty dev at `9da5b07b00e54fb552796cbcf01cc5fc7c2f02e7`;
this is a handoff-only change, not a tested product candidate.

### Five Canonical Choices

| Difference | Canonical D-1 choice | Required change |
| --- | --- | --- |
| Timestamp names | `collectionStartedAt` = earliest request of the accepted collection; `collectionCompletedAt` = final response. Retain `oldestResponseReceivedAt`, DB-derived `publishedAt`, nullable `providerDataThrough` | B-3 drops requestStartedAt/responseReceivedAt. No dual accepted wire names or fallback timestamps; retries/publication never renew age |
| Publication arguments | `publishSpendObservation(actor, {scope, period, runId, leaseToken, expectedCapacityRevision}): Promise<PublishSpendResult>` | B-3 replaces publication collectionId with runId and adds explicit scope/period. Envelope collectionId remains the identifier of that same run, not another identity. Validate all supplied scope/period fields against the stored authorized run before publication |
| Capacity read | `readCapacitySnapshot(actor, scope, period): Promise<CapacityReadResult>`; DEV-C consumes `value.evidence` only after ok=true | Remove getManagedSpendEvidence, including B-3's proposed wrapper. One coherent snapshot includes authority/policy and business capacity revisions, accepted observation ID, positions, coverage, residual/uncertainty and reserve; no independently assembled read |
| Pause/read result | C-draft-3's tagged result pattern; one general delivery view with explicit ACTIVE/PAUSED discriminator and a PAUSED-only request result, specified below | B-3 drops kind=accepted/rejected and nullable read success; C-draft-3 stops typing every operation read/reconcile as PauseResult. Use triggeringObservationId, not observationId, on PauseCommand; retain requestKey only |
| Errors and HTTP | One error union, one unknown-reason vocabulary and explicit authority-denied versus authority-unavailable distinction below | B-3 replaces blanket 403 AUTHORITY_UNAVAILABLE; C-draft-3 adds UNAUTHENTICATED and AUTHORITY_DENIED. Both preserve hidden-target 404, lease/revision conflicts and typed storage failures |

All shared domain types and validation remain in the proposed Dev-owned
`src/lib/campaign/delivery-contracts.ts`; database row/RPC types stay separate in
`src/lib/types.ts`. DEV-C filenames and single-writer boundaries do not change.
PublishSpendResult retains C-draft-3's `{ok:true,value:{outcome:"accepted"|"unchanged",
observationId,capacityRevision}}` or tagged error. Trusted completeness, sequence,
publication time and amounts come only from validated stored pages. Exact committed
publication replay may return unchanged after authority/identity verification;
it never republishes, advances the pointer or renews freshness. New publication
requires a valid lease/revision; changed content is not an identical replay.

### Operation and Error Delta

Use C-draft-3's `SpendContractResult<Value>` wrapper. Canonical shapes below refer
to its existing SpendScope, SpendUnknownReason, PauseOperationState and CapacitySnapshot;
they are draft definitions, not modules created or runtime acceptance:

```ts
type SpendContractErrorCode =
  | "INVALID_INPUT" | "UNAUTHENTICATED" | "NOT_FOUND"
  | "AUTHORITY_DENIED" | "AUTHORITY_UNAVAILABLE"
  | "REVIEW_CHANGED" | "BINDING_CHANGED" | "IDEMPOTENCY_CONFLICT"
  | "REVISION_CONFLICT" | "LEASE_LOST" | "RECONCILIATION_REQUIRED"
  | "CAPACITY_EXCEEDED" | "EVIDENCE_UNKNOWN" | "STORAGE_UNAVAILABLE";
type SpendContractResult<Value> =
  | { ok: true; value: Value }
  | { ok: false; code: SpendContractErrorCode };
type PauseCommand = {
  scope: SpendScope; campaignId: string; requestKey: string;
  reason: SpendUnknownReason | "manual" | "compensation";
  triggeringObservationId: string | null;
};
type DeliveryOperationView = {
  operationId: string; revision: string; desiredStatus: "ACTIVE" | "PAUSED";
  operationState: PauseOperationState;
  state: "pending" | "confirmed" | "unknown" | "failed";
  confirmedAt: string | null;
};
type DeliveryOperationResult = SpendContractResult<DeliveryOperationView>;
type PauseResult = SpendContractResult<DeliveryOperationView & { desiredStatus: "PAUSED" }>;
type CapacityReadResult = SpendContractResult<CapacitySnapshot>;
```

`requestProtectivePause(actor, command): Promise<PauseResult>` reloads target
authority independently of the optional triggering observation. Original local
campaign/binding only; null local IDs remain control exceptions, not commands.
`getDeliveryOperation(actor, operationId): Promise<DeliveryOperationResult>` is
read-only. `reconcileDelivery(actor, operationId): Promise<DeliveryOperationResult>`
is authorized recovery. Neither substitutes PAUSED for the stored desired status.

Keep the agreed raw/coarse projection: confirmed -> confirmed;
needs_reconciliation -> unknown; cancelled_before_dispatch -> failed; all other
listed nonterminal states -> pending. Only confirmed has a non-null confirmedAt,
after original-target verification and durable persistence. A pause consumer must
require ok=true, desiredStatus=PAUSED, operationState=confirmed, state=confirmed
and confirmedAt present. A confirmed ACTIVE operation never supplies a paused ID.
Rejection, missing target and storage failure have no success value or fake ID;
failed compensation/partial transmitted effects remain unknown, not cancelled.

Canonical SpendUnknownReason is C-draft-3's original union plus
`coverage_unproven`, `reporting_lag_unverified`, `totals_inconsistent` and
`unverified_account_attribution`. Replace B-3's reporting_lag_unproven,
inconsistent_totals and attribution_unverified names; no synonyms on the wire.
Evidence unknown reasons are not interchangeable with request error codes.

| Error or outcome | HTTP rule |
| --- | --- |
| INVALID_INPUT / UNAUTHENTICATED | 400 / 401 |
| NOT_FOUND, including wrong-tenant or invisible target | 404 without target disclosure |
| AUTHORITY_DENIED | 403 only for an already-visible target with verified actor and an explicit denied mutation capability |
| AUTHORITY_UNAVAILABLE | 503 when required authority/policy/capability cannot be established; never convert unknown authority to a known denial |
| REVIEW_CHANGED / BINDING_CHANGED / IDEMPOTENCY_CONFLICT / REVISION_CONFLICT / LEASE_LOST | 409; no implied release or retry permission |
| RECONCILIATION_REQUIRED | 409 for a rejected new command; return the scoped existing unknown operation when recoverable rather than hiding its ID in a bare error |
| CAPACITY_EXCEEDED | 422, no admission |
| EVIDENCE_UNKNOWN / STORAGE_UNAVAILABLE | 503 when no accepted operation result can be returned; an unavailable store is not NOT_FOUND |
| Accepted pending/unknown operation | 202 with its typed operation; it does not confirm delivery or pause |
| Confirmed operation or cancelled-before-dispatch replay | 200 with the respective confirmed/failed view; no repeat dispatch |
| Successful scoped read | 200 with its actual typed state, including pending/unknown; clients must not equate 2xx with confirmation |

Use tagged RPC domain conflicts, not SQL error-text matching. Map boundary input
validation 22023 to INVALID_INPUT. SQLSTATE 42501 alone cannot distinguish hidden
target, deliberate actor denial and broken service grants: use verified visibility
and explicit domain authorization results; unexpected infrastructure/grant failure
is STORAGE_UNAVAILABLE. Do not leak SQL or change tenant behavior to simplify mapping.
Expired new publishers yield LEASE_LOST; old revisions yield REVISION_CONFLICT.
An already accepted uncertain effect is retained and reconciled, never erased by
either code. Cron remains 503/ok=false for partial/unknown evidence or unconfirmed
required pauses, regardless of nested 200/202 responses.

### Delta Check Cases and Handoff

These are discriminating contract examples, not product executions:

```json
[
  {"case":"active_confirmation_is_not_pause","desiredStatus":"ACTIVE","operationState":"confirmed","state":"confirmed","confirmedAt":"2026-09-26T12:00:00.000Z","pauseConfirmed":false},
  {"case":"durable_pause_confirmation","desiredStatus":"PAUSED","operationState":"confirmed","state":"confirmed","confirmedAt":"2026-09-26T12:00:00.000Z","pauseConfirmed":true},
  {"case":"pause_without_durable_timestamp","desiredStatus":"PAUSED","operationState":"confirmed","state":"confirmed","confirmedAt":null,"pauseConfirmed":false},
  {"case":"pause_pending_is_not_confirmation","desiredStatus":"PAUSED","operationState":"verifying","state":"pending","confirmedAt":null,"pauseConfirmed":false},
  {"case":"raw_state_mismatch_is_not_confirmation","desiredStatus":"PAUSED","operationState":"needs_reconciliation","state":"confirmed","confirmedAt":"2026-09-26T12:00:00.000Z","pauseConfirmed":false}
]
```

Dev 2's next action: acknowledge this D-1 mapping or return exact field/type/semantic
corrections against it, not another independent set of aliases. QA reviews the
ACTIVE-as-pause, hidden-target/denial/unavailability, stale publication and nested
sweep cases with R1-R6. CEO records one accepted contract after review. Strict
watermark/coverage restrictions still may block all managed admission with current
Meta evidence; this interface agreement does not resolve provider feasibility.

DevOps' latest saved readiness section was still in progress when read. No
dependency or test execution is inferred from terminal success or directory
presence. Baseline regressions follow its completed readiness/slot handoff.
Only this receipt changes; Dev's allocated copy remains retained with no edits
by this turn. No installation, product tests, service, database, provider action,
Git publication or runtime-resource claim.

D-1 checkpoint: **complete, document/fixture validation passed** on Node v22.12.0.
Validated all five canonical rows, 45 local links/anchors, ASCII/whitespace/fences,
the nine preserved exposure fixtures and five pause-discriminator examples. These
are contract consistency checks, not product, SQL, Linux or provider acceptance.
The two expected activation failures remain preserved and unexecuted by this turn.
Next consumer: Dev 2 for explicit D-1 agreement/corrections, then QA/CEO review.
No owner transcript relay is required; this saved delta is the deliverable.

## O-6: Activation Baseline Execution R-1

Dev / DEV-B / board O-6. Checkpoint: **execution complete; two safety failures
reproduced, not fixed**. CONTRACT-BC remains DRAFT / not accepted. DevOps retains
release execution; no Git publication or production action was taken by Dev.

Consumed the completed DevOps runtime handoff and Dev 2's explicit D-1 agreement.
QA's O-6 receipt now accepts the five canonical D-1 choices, with coverage-proof
storage and provider/policy feasibility still open. Earlier missing runtime and
peer-review statements above are historical, not current blockers.

### Exact Source and Execution

- Shared discovery: dirty dev at 9da5b07b00e54fb552796cbcf01cc5fc7c2f02e7,
  two commits behind origin/dev. All peer changes were preserved.
- Executed only in /tmp/adbrain-dev-b-o1. All 529 candidate B source hashes
  matched before and after execution; source manifest remains
  9533d1d0e81069291536e6b97c020334eb1ddbf48858d31181a0181e0b5e4d13.
- Added only tests/qa-activation-recheck.test.ts to that copy, byte-identical to
  QA's selected artifact: SHA-256
  2f0560e90d5a11197ee238ba137cdee97aa8a026207a16928d32c04eb564211c.
  Trusted-write mocks and both safety assertions are unchanged. No shared test
  suite was modified; permanent adoption belongs in the existing owned suite.
- Node v24.21.0, macOS arm64, Vitest 4.1.11, independently installed dependencies.
  Package lock 9d82d5a71cedb3d12518fef5856f15a92ce46a29b4812e592d413d6e663a48b0
  and installed lock f0f21529292ec90545bdd9552c70cdd79fe11b5f19c66041e3f34d882f9570ca
  matched the handoff. No dependency installation was needed.
- Scrubbed placeholder environment, paid evaluations/payments/logging disabled;
  frozen unit guard 31abc8b977d4cd23b7569028fcb5e95e5916d907ee1fea7e4808875a13038709.
  No environment credentials were loaded. The guard is not an OS sandbox.
- Command: node node_modules/vitest/vitest.mjs run
  tests/qa-activation-recheck.test.ts -t 'QA ' --maxWorkers=1, with default and
  JSON reporters. Full argv and environment are in the execution receipt below.
- Runner PID 20225; test PID 20226. Started 2026-09-26T11:11:29.584Z;
  completed 2026-09-26T11:11:31.020Z. Exit 1; no signal or runner error.

| Preserved safety case | Actual result | Interpretation |
| --- | --- | --- |
| Concurrent INR 200/day starts under INR 2000/week cap | FAIL: expected one successful response, received two | Route admits combined INR 2800/week; first assertion fails before its separate provider-call count assertion |
| Provider success, failed local save, then retry | FAIL: expected one activation call, received two | Initial 500 and initial one-call assertions passed; retry repeats the mocked provider mutation |

Exactly two tests ran: zero passed, two failed, zero pending/skipped. Failures
are the expected behavioral assertions, not imports, guard rejection or setup
errors. This is fresh developer baseline reproduction against actual route code
with in-process dependencies mocked, not a real Meta operation or a fix.

Evidence:

- [Execution receipt](../../.qa-artifacts/dev-b-o1/activation-o6-ISVpdm/execution.json),
  SHA-256 babc096c6e3a93aa96f7f36178720c89bf42525e7e9829bfa66553a6144faa33.
- [Vitest JSON](../../.qa-artifacts/dev-b-o1/activation-o6-ISVpdm/vitest.json),
  SHA-256 a36d443c4bf41a0e6935bae42fb95821122cee1add91ed6275e66aa2e8fac3b6.
- [Standard output](../../.qa-artifacts/dev-b-o1/activation-o6-ISVpdm/stdout.log),
  SHA-256 a649bf4c2eafff7631a9a031ad5a29e2abac9e5b081ca59097ebddc49f9e0b1a.
- [Standard error](../../.qa-artifacts/dev-b-o1/activation-o6-ISVpdm/stderr.log),
  SHA-256 1c32cd11907f50f11705bc3af266529a84645a6931d5c4669e2e8f0a750b7673.

Input-check correction: the first preflight incorrectly compared the whole
manifest JSON byte hash with B's canonical digest and stopped before mutation.
The corrected check hashes JSON.stringify(manifest.files), as DevOps' assembly
tool specifies, then verifies every file. It passed; no source repair occurred.

### Slot Release and Next Consumer

**Dev's short regression execution slot is released.** Dev 2 may now run its
guarded spend/F8 baseline in its own allocated copy under the delivered execution
contract. No Dev process, server, database, VM, port or heavy slot remains held.
Dev retains /tmp/adbrain-dev-b-o1, its dependencies and staged fixture, plus the
owned .qa-artifacts/dev-b-o1 evidence. Nothing was deleted from another worker.

CEO and QA consume the failure evidence and peer D-1 agreement. Delivery repair
still waits for an accepted CONTRACT-BC version and explicit implementation scope;
no failing assertion was skipped, inverted or wrapped as an expected CI failure.
No full suite, Linux, hosted CI, browser, SQL, provider or production acceptance
is claimed. Focused evidence classification passed; fixture editor diagnostics
reported no errors. Receipt validation passed: 49 local links/anchors, formatting,
four evidence hashes, failing exit status and explicit slot release.

## O-6: Coverage Storage Addendum D-2

Dev / DEV-B. **DRAFT for QA, Dev 2 and CEO review; no implementation authority.**
This addresses QA's remaining coverage storage request after its scoped D-1
acceptance. D-1's five canonical interfaces are unchanged. These are proposed
internal persistence rules, not existing tables, implemented SQL or provider proof.

### Immutable Coverage Snapshot

One coverage set belongs to one accepted observation. A newer observation replaces
the set used by capacity reads; credits from historical observations are never
added to current credits. Old sets remain immutable audit evidence. Proposed
internal relations, all server-written and scoped to business/account/period:

| Relation | Required identity and constraints |
| --- | --- |
| coverage_sets | Primary key observation_id; unique run_id; composite foreign key to that observation's business, account, generation, currency and period. Store adapter_id/version, proof_manifest_hash and evaluated capacity revision. One immutable set, including explicit UNKNOWN results, per accepted observation |
| coverage_slices | Primary key (observation_id, slice_key). Composite foreign key to coverage_sets; immutable provider campaign, source page/item identities and digests, query identity, liability interval [start,end), amount_paise and provenance payload. slice_key is derived by the approved server adapter from the underlying liability identity, not a caller UUID or page position |
| coverage_allocations | Primary key (observation_id, slice_key), also a composite foreign key to coverage_slices. Composite foreign key binds reservation_id/effect_id to the same business, account, provider campaign, generation, currency and period. Each indivisible slice can credit at most one reservation; a second reservation cannot claim it |

Paise amounts are nonnegative PostgreSQL bigint bounded by JavaScript's safe
integer maximum, with checked aggregate arithmetic. Period and liability interval
start must precede end; coverage must lie inside both the observation period and
the persisted authorized effect interval. Allocation amount equals its slice's
amount, never a caller-selected fraction. No proportional splitting of aggregate
provider rows is supported by this initial proposal. If finer disjoint slices
cannot be proven, overlap stays unknown, not automatically zero or min(S,C).

The adapter must reject duplicate or overlapping descriptions of the same
underlying liability, including different source row IDs for the same spend.
Time overlap alone does not establish duplicate liability: distinct provider
events may share a time interval. Native event identity or a documented disjoint
aggregation partition is required; hashing caller input does not prove uniqueness.
Without such a source guarantee, no coverage set can be classified proven.

### Atomic Publication and Recovery

Use D-1's existing publishSpendObservation boundary; there is no caller credit API.
Derive candidate slices from immutable stored pages outside the transaction, with
no provider request or DB lock held together. In the publishing transaction:

1. Recheck visibility/authority, exact stored run/scope/period/query/page digests,
  current lease token and expected business capacity revision under the existing
  business-wide serialization lock. Stale lease/revision returns D-1's conflict.
2. Validate immutable reservation/effect attribution and interval containment.
  Enforce slice uniqueness and sum(credit for reservation) <= its ceiling;
  sum(credit for campaign) <= attributable observed campaign spend. Every spend
  slice contributes to incurred spend only once; account residual stays separate.
3. Persist observation, complete coverage set, allocations, pointer and incremented
  capacity revision atomically. Missing/unsupported proof publishes honest UNKNOWN
  evidence with coverage_unproven; it cannot enable admission or release holds.
  Invalid conflicting allocations reject publication, not silently drop a claim.
4. Same accepted run and exact trusted content returns the original immutable
  result without advancing pointer, revision or timestamps, even after a newer
  observation. Different content under the same identity is IDEMPOTENCY_CONFLICT.
  Recheck actor visibility on replay. A lost response is recovered by that replay;
  a rolled-back transaction leaves no partial credits for restart to accumulate.

FK/check/unique constraints enforce identity and individual invariants. Aggregate
bounds and source partition checks additionally require the guarded publishing
transaction; a CHECK constraint alone cannot prove a cross-row sum. Browser roles
cannot insert/update/delete these rows or invoke a credit-writing RPC. Shared
authority/schema migrations remain Dev-owned and gated on contract acceptance.

### Supported Proof Adapter and Acceptance

**No production Meta coverage-proof adapter is currently evidenced or supported.**
Neither Meta campaign totals, a fresh fetch, a configured lag allowance nor an
operator assertion establishes interval attribution/uniqueness/finality. Dev 2's
collector may persist those observations, but the shared verifier must return
coverage_unproven when it cannot establish the required source contract. Null
providerDataThrough independently remains reporting_lag_unverified. No synthetic
fixture adapter is a production fallback, and this addendum does not claim the
supported-adapter portion of QA's request is complete.

A future adapter registration needs provider documentation or authorized captured
evidence demonstrating stable liability identity, disjoint partitions, interval
semantics and correction/revision handling, plus independently accepted tests.
Account/campaign/query/generation/period and persisted effect identity must all be
verified. Absence of this evidence is a concrete feasibility gate for CEO/owner,
not permission to weaken the strict contract or perform live provider actions.

Next acceptance checks: QA/Dev 2 review these proposed constraints against BC-27/28;
after implementation approval, actual SQL tests must cover concurrent double
credit, exact/changed replay, cross-tenant/interval rejection, aggregate overflow,
lease/revision races, newer-observation replacement and crash/restart atomicity.
No such SQL or adapter test has run here. R-1's released slot remains released;
this document-only addendum starts no execution, service or provider resource.

D-2 checkpoint: **draft delivery complete; document validation passed** on Node
v24.21.0. Checked required constraint/gate statements, 49 local links/anchors,
ASCII/whitespace/fences and all 14 retained contract examples. Pre-close validation
is retained as handoff-validation.json beside R-1's execution artifacts; its hash
identifies the document before this completion note. Next consumers are Dev 2
and QA for D-2 review, then CEO for the accepted contract and implementation scope.
The unsupported production proof adapter remains an explicitly unresolved request.

## O-8: Issue 28 Allocation Request

Worker: Dev. New packet: GitHub issue #28, TanStack Query campaign-list
integration. Board O-8 and the issue were read directly on September 26.
Prior DEV-B is **checkpointed and parked**, not accepted or repaired. R-1's
execution slot remains released; the old B source, fixture and evidence are
retained without further edits. No new delivery-contract drafting is underway.

Owner explicitly requests tested code and an issue-linked PR to dev. Intended
implementation paths are src/lib/meta-connect-ui/use-campaign-list.ts,
src/components/campaigns.tsx, their focused existing tests and the minimal scoped
query-provider integration identified from those call sites. Package/lock edits
are permitted only in the allocated issue worktree. No shared dependency install,
delivery/payment mutation change or reuse of production credentials is planned.

**Concrete blocker: the issue worktree allocation is not delivered.** At this
checkpoint git worktree list --porcelain lists the shared dev checkout and the
retained G-1 release worktree, plus three prunable historical release entries;
none is an issue #28 allocation. Shared dev is still at
9da5b07b00e54fb552796cbcf01cc5fc7c2f02e7, four commits behind origin/dev, with
unpublished tracked/untracked changes. DevOps' shared receipt has no O-8 issue
allocation entry. The old /tmp/adbrain-dev-b-o1 source is not a current-dev Git
worktree and is not a substitute. No shared branch switch, self-allocation or
dependency modification was attempted.

Request ISSUE-28-ALLOCATION-1 to DevOps: after the authorized shared-history
reconciliation, supply the clean worktree path, feature branch, exact current-dev
base SHA and dependency/runtime handoff. Retain sole shared lockfile integration
and publication ownership; identify the issue branch publication handoff when
the tested commit is ready. No browser/build/DB slot is claimed by Dev now.

Next consumer: DevOps for allocation, then Dev for implementation and focused
tests, then QA for exact-commit review and the issue-linked PR workflow. No
product code, tests, dependency installation, commit, push or PR was produced
by this allocation checkpoint. The issue's tenant/cursor/cancellation/invalidation
and desktop/mobile acceptance criteria remain pending, not waived.

## O-9: Issue 28 Implementation Handoff

Dev / GitHub issue #28. **Implementation and focused author checks complete;
published as [PR #31](https://github.com/vanshulgoyal101/adbrain/pull/31) to dev
under O-10. Independent acceptance remains pending.** An unexpected Ready Preview
deployment requires DevOps containment/policy review below. The O-8 allocation
blocker is superseded by O-9's completed handoff. DEV-B remains parked with its
old source and evidence retained; no new delivery-contract work was undertaken.

### Exact Candidate

- Worktree: /tmp/adbrain-issue-28-o9, clean after push; upstream equals final head.
- Branch: feature/issue-28-tanstack-query.
- Base: a7445f565586a2c4b484036b3bc12b01af28c7ea.
- Final head: **bab47d0ac46527cc1a012cfd4d8cd0b53b7ab0c1**.
  Two pushed commits: 853d197f2b4ab6ca0460e628f8c9c6319c9d8d21 adds the integration;
  bab47d0 preserves immediate status selection during pending search debounce.
  Review the complete range from base to final head, not only the second commit.
- Exactly five changed paths: package.json, package-lock.json,
  src/lib/meta-connect-ui/use-campaign-list.ts, src/components/campaigns.tsx and
  tests/campaign-audience.test.tsx. No shared source/dependency edits, schema or
  environment changes. Neither duplicate O-8 allocation was used or deleted.
- [Source and validation manifest](../../.qa-artifacts/dev-b-o1/issue-28-handoff-final.json)
  records all five hashes and binds them to the tested commit.

### Behavior and Reuse

The existing hook now uses useInfiniteQuery with a component-local QueryClient,
not a module singleton or global application provider. Keys include owner,
business, normalized search and status; cursors remain page parameters within
that exact scope. Query cancellation consumes the supplied AbortSignal. SSR data
seeds only the original unfiltered key; incoming unfiltered server pages cannot
replace an active filtered result. Previous keys are removed on transition and
the local client clears on unmount. Sign-out uses login navigation/router refresh;
owner changes are separately isolated by the key.

Paging preserves first-seen row order, last-seen duplicate values and merged
results. Explicit refresh restarts at the first page. Existing success handlers
update cached pages and invalidate only this tenant's list reads. Creation,
activation, payments and paid generation remain outside Query: no automatic
mutation retry or cache-based spend authority was introduced.

Policy is explicit: 30-second stale time, 60-second GC safety window with earlier
key/unmount cleanup, no automatic retries, mount/focus/reconnect/interval refetch,
and networkMode always so an offline read reports failure instead of silently
remaining paused. Search retains its 250ms debounce; empty search/status changes
are immediate. No active-cache age setting is a provider-freshness guarantee.

Pinned @tanstack/react-query 5.104.0 and its sole added dependency,
@tanstack/query-core 5.104.0, both MIT. Registry metadata supports React ^18 || ^19;
this source uses React 19.2.4 / Next 16.3.5. Official infinite-query/cancellation
and defaults documentation informed the adapter. The existing Meta client expects
a different response envelope, so the list's plain response contract remains
unchanged. No competing query library or broader state rewrite was added.

### Actual Checks

- Independent worktree install, Node v24.21.0/macOS arm64, --ignore-scripts;
  npm audit --audit-level=high returned zero vulnerabilities.
- [Affected Vitest run](../../.qa-artifacts/dev-b-o1/issue-28-tests-final.json):
  **78 passed, zero failed/skipped** across campaign-audience, campaign-sync and
  meta-connect-w3-campaign-flow. Includes 12 new hook lifecycle cases. Executed
  with DevOps' frozen unit network preload, scrubbed placeholder environment,
  paid evaluation/logging disabled and --maxWorkers=1. One existing composer
  test emitted an act warning; it passed, and the warning was not suppressed.
- Touched-file ESLint and worktree tsc --noEmit passed. Editor diagnostics clean.
- [Offline browser receipt](../../.qa-artifacts/dev-b-o1/issue-28-browser-kRaMdL/receipt.json):
  actual Campaigns component, React, Query and project CSS bundled using the
  existing esbuild/Playwright fixture pattern; Chrome at **1440/390/320px passed**.
  Initial seed/no redundant read, cursor de-duplication, filters, error recovery,
  one synthetic pause with targeted invalidation, no clipped controls/overflow,
  no runtime errors or unexpected requests. All API transport intercepted;
  no app server, database, real Meta call, credentials or paid action.
- [Reproduction harness](../../.qa-artifacts/dev-b-o1/issue-28-browser.mjs) and
  screenshots remain private evidence, not part of the implementation commit.
  The first browser run exposed zero-GC removal before React subscribed; the
  committed fix uses the GC safety window plus explicit previous-key cleanup.
  Final browser source hashes exactly match the committed five-file candidate.

This is not authenticated Next-route, full Next build, Linux, full coverage,
hosted CI, real-provider or production acceptance. No heavy server/DB slot or
background process remains held; Chrome and the short fixture execution exited.

### Review and Publication Requests

ISSUE-28-REVIEW-1 to QA: review final head bab47d0 against base a7445f5 and the exact
evidence above. Prioritize tenant/SSR lifecycle, cancellation, cursor refresh,
action invalidation and the deliberately disabled retry/refetch defaults.
Record actual findings or scoped no-blocking-findings tied to this SHA; do not
self-approve under the shared GitHub account or infer a second human reviewer.

ISSUE-28-PUBLISH-1 superseded by O-10's explicit feature-publication authority:
Dev pushed the exact tested branch and opened PR #31 with Fixes #28. Gitleaks
scanned both commits with redacted output and found no leaks. The VS Code PR
tool failed with an Enterprise Managed User authorization error; the existing
GitHub CLI identity was verified as vanshulgoyal101 and created the PR. No auth
or credential changes. Hosted secrets passed; build remains in progress in
[CI run 36242426141](https://github.com/vanshulgoyal101/adbrain/actions/runs/36242426141).
QA can review this exact diff now. DevOps retains integration and release;
integrate the two new lock entries separately from issue #27. Verify issue
closure only after accepted integration because dev is not the default branch.

### O-10 Unexpected Preview: Immediate DevOps Handoff

ISSUE-28-PREVIEW-1: **stop further feature publication until the effective policy
is resolved.** Before push, current remote main and candidate vercel.json both
had wildcard false/main true/dev false. The live Vercel UI confirmed linked
vanshulgoyal101/adbrain, empty root directory, Automatic ignored-build behavior
and Node 24.x. Nevertheless, GitHub reports Deployment has completed, and the
[linked deployment](https://vercel.com/vanshul-goyals-projects/adbrain/FfVWJnkYZsbcLcAEyLAmp4DJyVzz)
is **Ready / Preview**, source feature/issue-28-tanstack-query at bab47d0.
Configuration intent did not establish effective suppression. This supersedes
any earlier no-deployment implication in the author manifest/PR description.

DevOps: contain/remove this specific unintended preview, verify its environment
credential scope and runtime side effects without exposing secret values, and
resolve the Git deployment policy before another feature push, including #27.
Do not change production or treat the successful Vercel status as acceptance.
Dev did not open the preview application or call its APIs, change hosting
settings/credentials, deploy through CLI, migrate, merge, or promote to main.
Production impact and preview isolation are not established. QA and hosted CI
can continue against the published source; no code/dependency rerun is needed
solely because this hosting discrepancy was discovered.

Rollback: revert both commits as one dependency-complete five-file change,
restoring the old hook/caller and both dependency manifests together; no migration, credential or provider rollback
is required. Retain the issue worktree/dependencies and Dev-owned evidence for QA
and DevOps. The tested implementation is handed off, not the entire issue closed.