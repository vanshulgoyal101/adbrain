# DEV-C Observation Contract Proposal

Worker: Dev 2. Packet: DEV-C. Board: O-2, September 26, 2026.
CONTRACT-BC: **DRAFT, not accepted**. Current proposal: C-draft-3 under board O-4.
O-2 is the original assignment; the O-1 filename is retained. The final
[O-4 checkpoint](#o-4-checkpoint-c-draft-3) supersedes older availability statements
and the identified B-1/C-draft-2 mappings below. Earlier checks remain historical.
Latest assignment: [Issue 27 accounting repair](#issue-27-accounting-repair). DEV-C is parked,
not accepted; its prior implementation and evidence remain preserved.
Previous checkpoint: [O-6 D-1 agreement](#o-6-d-1-agreement-and-regression-preparation).
D-1 supersedes this document's earlier conflicting interface choices. C-draft-3
is not a competing final interface decision. Prior missing-input blockers are historical.
Deliverable: spend half of the joint contract and bounded shared-interface requests.
The earlier DEV-C scope did not authorize collector, enforcement, SQL, provider
or production changes; the current issue-specific authorization is recorded below.

## Issue 27 Accounting Repair

Dev 2: QA's truncation-usage blocker is repaired locally at
`ff4615f950183538efe8ee7acc4cbb0e81c585e2`, parent/published PR #29 head
`da4f209b4edffe29a1277fbfe96b6677e35d305f`. Worktree
`/tmp/adbrain-issue-27-o9`, branch `feature/issue-27-ai-sdk`, clean/ahead one.
Review only `git diff da4f209 ff4615f`; no push under the publication hold.

SDK usage extraction now precedes terminal truncation rejection. LLMError retains
provider, model and original reported tokens. The facade records the physical
failed attempt once, inside the shared producer rather than per waiting caller.
Interview/planner pass known failure usage once to their existing persistence
callbacks; creative generation retains it with earlier attempt receipts through
the existing failedVariantUsage path. Truncation remains terminal, with no extra
completion or image request and no raw completion text added to the error.

Regression evidence: both plain-JSON and schema-backed Gemini reproductions
failed before the fix, then passed with two shared callers, one HTTP call,
8 prompt / 2 completion / 17 total tokens, and one recorded call. Four additional
task cases cover planner/interview failure callbacks and creative receipts with
and without an earlier repair. Final scrubbed Node 24 affected run:
`npm test -- tests/llm tests/creative-pipeline.test.tsx tests/planner.test.ts tests/interview.test.ts tests/creative-generation-route.test.ts tests/creative-assistant-route.test.ts tests/meta-connect-w2-planner-route.test.ts --maxWorkers=1 --silent --reporter=dot`
passed **167 tests across 13 files, zero failures/skips**, in 19.77 seconds.
Lint, typecheck, whitespace and editor checks passed. No dependency changes or
repeated audit/build; no live database/provider, deployment or GitHub write.

Next owner: QA re-reviews the local delta against its published P1. This is author
evidence, not independent acceptance or proof of durable database delivery.
DevOps retains deployment-policy containment; no push or merge is authorized by
this repair. No server or shared test resource is held.

## O-10 Issue 27 Implementation

Worker: Dev 2. [Issue #27](https://github.com/vanshulgoyal101/adbrain/issues/27)
is published in [PR #29](https://github.com/vanshulgoyal101/adbrain/pull/29)
to `dev`, not independently accepted or merged.
O-9 allocation and O-10 issue-local implementation/publication authority were consumed;
there is no allocation or dependency-install approval blocker.

- Exact source: `/tmp/adbrain-issue-27-o9`, branch `feature/issue-27-ai-sdk`, clean
  commit `da4f209b4edffe29a1277fbfe96b6677e35d305f`, based on current origin/dev
  `a7445f565586a2c4b484036b3bc12b01af28c7ea`. Nineteen issue-only files; shared
  application source, dependencies, index and peer worktrees were not modified.
- Reuse: pinned AI SDK 7.0.116, Google 4.0.82, OpenAI-compatible 3.0.57, all
  Apache-2.0 and Node >=22/Zod 4 compatible. No model/provider-order/account or
  image-service change. SDK retries zero; original routing, key cooldowns,
  thinking/reasoning limits, usage, tolerant JSON and bounded task repair remain.
  Existing task schemas now drive structured output; compatible models retain
  JSON-object wire mode. Native provider schema capability is not live-certified.
- Author evidence: scrubbed Node 24, no env files or real provider credentials.
  `npm test -- tests/llm tests/creative tests/planner.test.ts tests/interview.test.ts tests/meta-connect-w2-planner-route.test.ts tests/brand-autofill-route.test.ts tests/instructions.test.ts --maxWorkers=1 --silent --reporter=dot`:
  **220 passed, one existing paid-evaluation skip**, 21 passed files/one skipped,
  17.98 seconds. Includes instruction-read no-paid-call safeguards; the LLM subset
  has 71 passing tests. `npm run lint`, `npm run typecheck`, editor diagnostics,
  `git diff --check` and `npm audit --audit-level=high` passed; audit found zero
  vulnerabilities. These are local mocked checks, not hosted/provider evidence.
- Publication completed under the owner's explicit instruction to reuse verified
  O-10 deployment-policy evidence and completed tests. The exact clean commit
  above was pushed only to `feature/issue-27-ai-sdk`; deployment and CI files are
  unchanged from the verified base. The earlier Vercel metadata 403 is historical,
  not an outstanding publication prerequisite. No tests were rerun for publication.
  The PR extension's Enterprise Managed User account was denied access; existing
  authenticated `gh` CLI created PR #29 successfully without credential changes.
- Next owners: QA reviews PR #29 at the exact head above; required hosted
  coverage/build/secret checks and independent QA remain acceptance gates.
  DevOps retains integration/release authority. No manual deployment, migration,
  paid provider call or merge was performed. Do not mark #27 accepted yet.
- **Confirmed publication-policy mismatch:** GitHub reports Vercel
  "Deployment has completed" for this exact head. Deployment `6678880815`,
  created `2026-09-26T12:34:31Z`, is `Preview`, `production_environment:false`.
  [Vercel status target](https://vercel.com/vanshul-goyals-projects/adbrain/BKcwCphv6WjKATYswzmr2oNr3cfx).
  This contradicts the reused disabled-feature policy; the PR prominently records
  it. DevOps must investigate effective Git policy and preview isolation before
  further publication/promotion. No settings or credentials were changed, and
  the deployed application was not accessed. PR head/base match the tested source
  and `dev`; secrets passed and build was running at the publication checkpoint.
- Rollback: the commit is dependency-complete; revert adapters, schema call sites,
  facade, tests and package/lock together through the reviewed release workflow.
  No migrations or new environment settings. No server or heavy test resource is
  held; retain this worktree and its dependencies for QA/publication.

## Source and Current Evidence

Read-only source review used dirty dev at
`9da5b07b00e54fb552796cbcf01cc5fc7c2f02e7`, two commits behind the local origin/dev
reference. This is not a frozen candidate and no source reconstruction was done.
The [O-2 board](../ORCHESTRATION.md) assigns reconstruction once to DevOps.

The [independent QA report](independent-acceptance-2026-09-26.md) identifies B by
that HEAD plus manifest SHA-256
`9533d1d0e81069291536e6b97c020334eb1ddbf48858d31181a0181e0b5e4d13` (529 files).
B's stale-zero and missing-result cron assertions fail; their expected rejection
must be preserved. DB-A and F5/F8 have separate accepted B-local scope. This
proposal neither reruns nor extends that acceptance.

Local controlling behavior inspected:

- [Spend cron](../../src/app/api/cron/enforce-spend/route.ts) reads unpaginated
  limits, campaigns and results, substitutes zero for absent results, and can
  return success without inspecting observation age or reporting period.
- [Spend arithmetic](../../src/lib/campaign/spend.ts) uses rupees and the larger
  of weekly projected commitment and tracked snapshots. It is not an atomic
  reservation or a managed financial authorization.
- [Meta client](../../src/lib/meta/client.ts) has a cursor campaign-list method,
  but getCampaignInsights supplies no explicit time range or account currency.
  [Insights decoding](../../src/lib/meta/insights.ts) treats an empty data array
  or missing spend as zero. Do not reuse that reporting convenience as authority.
- [DevOps feasibility receipt](ops-environment-2026-09-26.md#scheduler-feasibility-and-cost-approval)
  documents daily Hobby scheduling and no verified short confirmed-pause bound.
  Five minutes remains a proposal, not an approved default or guarantee.

Local hypothesis: requiring a complete, valid, correctly bound, current-period
observation at the decision boundary prevents the stale/missing success cases.
Cheapest discriminating check: adopt QA's two unchanged cron assertions in the
allocated isolated copy; B must fail both, the future integrated implementation
must pass both without skipping them or manufacturing zero-spend evidence.

## Scope and Ownership

Dev 2 owns observation collection/evaluation, durable continuation consumption and
honest sweep results. Dev owns delivery decisions/reservations, verified protective
pause, provider-client changes, SQL and shared types. There is one capacity
decision implementation, not a second one inside the collector.

O-2 resolves earlier DB-A/F8 file overlaps. Preserve those edits and instruction
assertions. This turn changes only this receipt. No newly conflicting writer was
observed in this document. Shared files and the central board remain untouched.

After acceptance, proposed exact Dev 2 module names are
`src/lib/campaign/spend-observations.ts` (validation and freshness),
`src/lib/campaign/spend-collection.ts` (bounded orchestration), and
`src/lib/campaign/spend-repository.ts` (typed calls to Dev-supplied RPCs).
Proposed new test: `tests/spend-collection.test.ts`.
These are filename requests, not files created or permission to implement now.
Existing owned integration surfaces are
[spend-enforce](../../src/lib/campaign/spend-enforce.ts),
[spend arithmetic](../../src/lib/campaign/spend.ts), the cron above,
[audit/spend tests](../../tests/audit-spend-enforce.test.ts),
[cron tests](../../tests/meta-connect-w2-cron-binding.test.ts), and
[spend-query tests](../../tests/spend-queries.test.ts).

## Identity, Units and Period

Propose one managed capacity key per business. Observation publication, binding
changes and reservation acquisition use the same database capacity revision and
short row lock. Account, connection generation, policy revision and exact period
are required inputs; old account liabilities survive reconnection in their own
scope. A new binding never implies the old account stopped spending.

Delivery identity stays Dev-owned: business, local/provider campaign, account,
Page, generation, exact reviewed ad-set/ad hierarchy, normalized effective link,
creative revisions and review digest. Observation IDs reference this authority;
they cannot create it. Dev reloads the stored original target for protective pause
and rechecks permission before every mutation, including after reconnection.

For the initial managed path, require verified exclusive account attribution to
one business. A shared/unverified account is unknown for authorization. Account
spend includes all its campaigns, including paused, externally created, unmapped
and deleted/archived objects that incurred cost in the period. Local campaign
status or absence must not remove liability. Unknown local attribution is null,
not a fabricated campaign association. External active objects trigger a control
exception; Dev's delivery service determines what can safely be paused.

Proposed period: calendar week starting Monday 00:00 in the verified account IANA
timezone, ending at the next Monday 00:00, represented as UTC [start, end).
Example fixture: Asia/Kolkata week of 2026-09-21 is
`[2026-09-20T18:30:00.000Z, 2026-09-27T18:30:00.000Z)`.
Do not derive weeks from server timezone or assume every week is 168 UTC hours.
DST, timezone changes and backfilled prior periods require distinct period keys.
CEO/Dev must accept this week definition; it is not an existing customer promise.

The Meta adapter translates an explicit local-date range to provider semantics
and verifies returned dates. No implicit date_preset. Inclusive provider date_stop
is not the exclusive UTC end. Current-week queries request week start through the
current account-local date and record that query separately from the full budget
week. A response timestamp does not prove all spend up to that instant was reported.

Boundary amounts: currency INR, safe integer paise in [0, 9007199254740991].
Parse provider decimal strings exactly, rejecting exponent notation, negatives,
NaN/Infinity, excessive fractional digits and overflow; no parseFloat/round/clamp.
Existing rupee values require a checked canonical two-decimal conversion; a value
that cannot round-trip is invalid, not silently rounded. Check aggregate addition
and multiplication for overflow. Other currencies are explicit unsupported states
until an approved contract exists. Media spend excludes taxes, cash balance,
annual allocation and customer entitlement; no exchange-rate or tax assumptions.

## Observation Envelope

Proposed shared shapes for Dev to publish in its proposed
`src/lib/campaign/delivery-contracts.ts`, aligning with B-1. Database row/RPC types
remain in [types](../../src/lib/types.ts); do not create competing envelope types.
All strings are validated at runtime; database revision bigint values cross JSON
as decimal strings. UUIDs, safe generation integers, UTC instants and IANA zones
are validated, not trusted because TypeScript accepts string/number.

```ts
type SpendScope = {
  businessId: string;
  accountId: string;
  connectionGeneration: number;
  policyRevision: string;
};
type SpendPeriod = {
  key: string;
  timezone: string;
  startsAt: string;
  endsAtExclusive: string;
};
type SpendUnknownReason =
  | "missing" | "stale" | "partial" | "invalid_amount" | "invalid_currency"
  | "period_mismatch" | "binding_changed" | "inventory_changed"
  | "uncontrolled_delivery" | "provider_error" | "repeated_cursor"
  | "cursor_expired" | "deadline" | "storage_error" | "lease_lost"
  | "correction_requires_reconciliation" | "policy_unapproved";
type SpendObservation = {
  observationId: string;
  collectionId: string;
  scope: SpendScope;
  period: SpendPeriod;
  source: "meta_insights";
  currency: "INR";
  query: { sinceLocalDate: string; untilLocalDateInclusive: string };
  inventoryRevision: string;
  collectionSequence: string;
  requestStartedAt: string;
  oldestResponseReceivedAt: string;
  responseReceivedAt: string;
  publishedAt: string;
  providerDataThrough: string | null;
  completeness: "complete" | "partial";
  validity: "valid" | "invalid";
  reasons: SpendUnknownReason[];
  accountMediaSpendPaise: number | null;
  campaignInventory: Array<{ metaCampaignId: string; effectiveStatus: string; effectiveDailyBudgetPaise: number | null; budgetEvidence: "verified" | "unknown" }>;
  campaignSpend: Array<{ metaCampaignId: string; campaignId: string | null; mediaSpendPaise: number }>;
  pages: { expectedStreams: number; completedStreams: number; received: number; digest: string };
  continuationId: string | null;
};
type SpendEvidence =
  | { state: "usable"; capacityRevision: string; observation: SpendObservation }
  | { state: "unknown"; capacityRevision: string; reasons: SpendUnknownReason[]; lastComplete: SpendObservation | null };
```

Usable requires complete + valid, no reasons, exact scope/period/policy match,
all streams accounted for, validated account total and any required attribution
reconciliation, and freshness under the approved policy. A partial collection may
store validated rows, but has null account total until completeness is proven.
Missing money never appears as zero. Empty responses qualify as verified zero
only under an explicitly tested provider contract with full range/currency/scope
coverage; until then they are unknown. Missing campaign rows are not inferred zero
from a nonempty account total. Persist raw response digests, not secrets or lead PII.

Use responseReceivedAt/requestStartedAt and oldest page response time for bounded
collection age; never renew freshness from publication/retry timestamps. Keep
providerDataThrough null unless supplied or verifiably established. A recently
fetched observation can be reporting-lagged; approved lag allowance, provider
controls and financial reserve are independent safeguards, not settlement proof.

Here requestStartedAt is the first request and responseReceivedAt the final
response of the collection. Use trusted decision time minus oldestResponseReceivedAt
<= maxObservationAgeMs; timestamps ahead of allowed clock skew invalidate evidence.
Inventory covers every discovered campaign independently of returned spend rows.
Active objects with unknown/unbounded budgets cannot produce usable admission
evidence. Dev's verified hierarchy/budget adapter supplies effective budgets;
parent daily_budget alone is not an ad-set-budget calculation.

Append observations immutably. Publishing a lower collectionSequence, an expired
lease, a different binding or the wrong expected capacityRevision cannot replace
the current pointer. Equal identity/digest is idempotent; unequal digest conflicts.
Provider downward corrections remain recorded but do not automatically release
capacity: flag reconciliation. Later-period rows never overwrite earlier periods.
Higher known incurred spend is retained even while a new run is partial/stale.

## Collection and Recovery Protocol

1. Claim a durable run for scope/period; persist a DB-assigned sequence, lease
   token, deadline, query fingerprint and inventory revision before provider reads.
   Only one live collector claim for that scope; overlapping cron calls return the
   existing run. Neither a process timestamp nor a browser ID is the ordering fence.
2. Enumerate eligible managed businesses with bounded keyset pages, not the
   owner-editable auto_pause flag alone. Persist a sweep high-water key and cursor.
   New managed starts must register with enforcement before delivery is permitted;
   entities added after the sweep boundary enter a subsequent sweep and cannot
   inherit the current sweep's success. Dev owns that activation prerequisite.
3. Within each scope collect account totals, full campaign inventory and required
   per-campaign spend using independent bounded streams. Provider after-cursors
   stay tied to account, query fingerprint and connection generation; never follow
   arbitrary paging.next URLs. No ACTIVE-only spend filter. A busy campaign gets
   a bounded page quantum before yielding so it cannot starve other scopes.
4. Each received page is validated and durably checkpointed with rows, digest and
   next cursor in one short transaction. Unique stream/page identity makes a retry
   after lost acknowledgement idempotent. Reordered/duplicate/conflicting rows are
   not summed as spend deltas. No DB transaction spans a provider request.
5. Completion requires every stream to terminate and a stable inventory revision.
   Repeated/missing cursors, caps, timeouts, malformed rows or generation changes
   produce explicit partial/unknown state. Recheck inventory/binding before publish.
   Detected provider churn invalidates the run. Graph pages are not an atomic
   provider snapshot; do not claim protection against undetectable external edits.
6. Resume using the persisted checkpoint after a crash. Expired read-only leases
   can be reclaimed with a new lease token and fencing; stale writers cannot publish.
   Expired provider cursors restart that stream under a new attempt, retaining old
   evidence without combining attempts. Collection deadlines bound retries; no
   successful sweep heartbeat while continuations or unknown accounts remain.
7. A failed publication does not permit activation or imply provider pause. Retain
   the run and retry the identical checkpoint/publication or reconcile conflicts.
   A complete prior snapshot remains historical evidence, but a newer known gap,
   changed inventory or uncontrolled active object can invalidate its usability.

Required durable storage, names proposed for Dev's migration review:
private spend_collection_runs, spend_collection_pages, spend_observations and
spend_sweep_runs. Dev supplies their SQL/types; Dev 2 supplies the repository adapter.
Use unique scope/period/request keys, sequence/lease fencing, page digests and
same-business operation/campaign relationships. No browser mutation grants; any
owner-visible read model retains RLS. Account observations must not cascade away
when a campaign is deleted. Retention is held pending policy, not automatically
pruned by this packet. No historical result backfill may invent completeness.

## Exposure and Delivery Boundary

Dev implements the single transactional capacity decision. Proposal for review:
incurred observed media spend + outstanding unobserved/future reservation exposure
+ disjoint uncertain liability + approved safety reserve must fit approved authority.
Never use max(total projected weekly, total observed) as an unexplained substitute.

B-1's per-campaign total-envelope alternative is conditionally compatible: with
S incurred, C total held envelope and proven covered=min(S,C), then
S + (C - covered) = max(S,C). This is per campaign/period/coverage identity, not
max(sum(S),sum(C)). It must not erase spend on one campaign because a different
campaign has unused commitment. Coverage ambiguity remains unknown, not admission.

Each reservation carries business/account/period, reviewed child IDs, authorized
interval, approved ceiling and an explicit reconciled-covered amount. Remaining
exposure = ceiling minus reconciled coverage, never below zero. Only attributable,
matching-period evidence with a proven coverage boundary can move held liability
into observed spend. Cumulative snapshots replace observations; they are not deltas.
Ambiguous work already held by a reservation is not added a second time as a new
uncertain liability. Unattributed uncertainty stays a separate identified hold.

If coverage cannot be established, retain the full hold and mark the allocation
unknown for new starts; do not pretend the conservative overlapping bound is an
exact net total. Provider reporting without a reliable watermark cannot release
capacity merely because a GET returned. Dev/QA must agree the coverage proof and
reconciliation rules; this is a contract issue, not a collector heuristic.

Illustrative fixtures, all amounts in paise:

| Case | Required result |
| --- | --- |
| Authority 200000, no incurred spend/holds, two requests each 140000 | First may reserve; serialized second cannot reserve, combined 280000 exceeds authority |
| Incurred 30000, reservation ceiling 140000 with proven covered 30000 | Exposure is 140000, not 170000; coverage and observation must share provenance |
| Incurred 30000, reservation 140000, coverage unknown | No new managed start; retain full hold, never assume 30000 is attributable |
| Snapshot 30000 followed by same-period snapshot 35000 | Observed spend is 35000, not 65000; resulting holds change only through reconciliation |
| Campaign paused or local mirror deleted after 35000 incurred | That 35000 remains period liability; confirmed inactivity alone does not settle reporting lag |
| Lease expires after an uncertain external activation | Hold remains; no blind reactivation and no automatic capacity release |

Publication, capacity acquisition and observation invalidation share a business
lock/revision. Acquire with the expected observation and capacity revision; stale
revision returns conflict and recomputes. DEV-C never independently reserves,
activates, releases holds or directly updates parent/child provider status.

## Freshness, Pause and Honest Outcomes

Required policy inputs: approved policyRevision, maxObservationAgeMs,
maxCollectionSpanMs, maxProviderReportingLagMs, clockSkewAllowanceMs,
collectionDeadlineMs, page/work budgets, detection-to-confirmed-pause objective,
safetyReservePaise, and unknownActiveAction. No silent production defaults.
Absent/unapproved policy blocks managed starts and unattended enablement.
Test fixtures may explicitly set maxObservationAgeMs=300000 and the other limits;
this number does not establish an achievable production promise.

Propose unknownActiveAction="request_verified_pause_and_escalate" for managed
delivery, subject to CEO/owner approval and DevOps feasibility. DEV-C sends Dev's
delivery service a durable idempotent protective-pause request, original binding
and reason. Pause must remain possible when spend collection fails. A capability
or binding mismatch does not authorize pausing an unrelated account or imported
children. Unknown/failed pause remains visible and escalated; no fabricated success.
Intentional unmanaged preferences do not silently grant managed pause authority.

Known complete incurred spend reaching/exceeding the approved weekly cap requests
protective pause. A cap reduction below committed exposure also requires Dev's
explicit protective decision. Admission permits exposure equal to the cap only
under the approved reserve policy; committed exposure is not itself proof of
incurred spend. Unknown-active treatment remains the separate proposed policy.

Measure firstInvalidEvidenceAt, detectedAt, pauseRequestedAt, providerConfirmedAt
and persistedConfirmationAt. Separate observation age, provider lag, queue delay,
request latency and confirmed-pause delay. Report bound violations and unknown
confirmation, not just HTTP latency. DevOps owns independent alert/heartbeat
delivery and scheduler feasibility; collector output is not evidence an alert arrived.

Proposed sweep result: sweepId, state complete/partial/failed, completed scope IDs,
unknown scope/reason pairs, continuationId, counts of attempted/completed streams,
pause operation IDs with pending/confirmed/unknown/failed status, and timestamps.
200 with ok=true only for a fully completed in-scope sweep with all required
protective actions durably confirmed. Partial/failed is 503 with ok=false and a
durable continuation reference. A protective pause does not make stale evidence
fresh; that sweep remains incomplete. Preserve the existing swept field during
caller transition, but never populate its paused IDs from a request acknowledgement.

## Exact Shared-Interface Requests to Dev

All signatures below are proposed, not implemented. Named result unions distinguish
conflict, invalid evidence, unavailable storage and provider uncertainty. Every RPC
validates scope/actor or scheduler authority server-side and is service-only; passing
a business UUID is not authorization. Dev defines the SQL contract before Dev 2
builds the adapter. No general-purpose administrative table client is exposed.

| Request / sole writer | Exact proposed surface | Minimum test / blocking consumer |
| --- | --- | --- |
| BC-C1 / Dev | Add SpendScope, SpendPeriod, SpendObservation, SpendEvidence and their runtime-validation contract to proposed delivery-contracts.ts, with DB RPC types in src/lib/types.ts; confirm one business capacity revision | Invalid units/period/currency reject; DEV-C validator and DEV-B decision use the same envelope |
| BC-C2 / Dev | In MetaClient add getAccountSpendPage({ sinceLocalDate, untilLocalDateInclusive, after? }): Promise<{ rows: Array<{ accountId: string; metaCampaignId: string; currency: string; spendDecimal: string; dateStart: string; dateStop: string }>; nextCursor: string \| null }>, getAccountSpendTotal({ sinceLocalDate, untilLocalDateInclusive }): Promise<{ accountId: string; currency: string; spendDecimal: string; dateStart: string; dateStop: string }>, and listSpendCampaignsPage({ after? }): Promise<{ campaigns: Array<{ id: string; accountId: string; effectiveStatus: string }>; nextCursor: string \| null }> | Page-two-only spend, explicit request/returned dates, currency mismatch, missing spend/empty result reject; complete inventory including externally active objects. Preserve existing getCampaignInsights reporting API |
| BC-C3 / Dev | SQL claim_spend_collection(p_scope jsonb, p_period jsonb, p_request_key uuid, p_expected_capacity_revision bigint), checkpoint_spend_collection(p_run_id uuid, p_lease_token uuid, p_stream_key text, p_page_key text, p_digest text, p_page jsonb, p_next_cursor text), publish_spend_observation(p_run_id uuid, p_lease_token uuid, p_expected_capacity_revision bigint), get_spend_evidence(p_scope jsonb, p_period jsonb) | Owner/service grants, duplicate same digest, conflict different digest, expired writer, out-of-order completion and shared reservation/publication race; collector cannot supply its own published time, sequence or complete flag |
| BC-C4 / Dev | SQL claim_spend_sweep(p_request_key uuid), checkpoint_spend_sweep(p_sweep_id uuid, p_lease_token uuid, p_expected_revision bigint, p_progress jsonb); keyset list_managed_spend_scopes(p_sweep_id uuid, p_after_business_id uuid, p_limit integer) | >1000 scopes, persisted high-water, duplicate run, crash after checkpoint and cursor bounds; no dependence on deletable owner preferences |
| BC-C5 / Dev | In proposed Dev-owned src/lib/campaign/delivery-service.ts: requestProtectivePause(actor, { scope, campaignId, reason, observationId, idempotencyKey }): Promise<{ operationId: string; state: "pending" \| "confirmed" \| "unknown" \| "failed"; confirmedAt: string \| null }>; expose matching reconciliation/read method getDeliveryOperation(actor, operationId) | Stale evidence does not prevent an authorized pause; provider success/local failure remains recoverable; duplicate request returns same operation; DEV-C never implements a second mutation loop |
| BC-C6 / Dev | Shared getManagedSpendEvidence(actor, scope, period): Promise<SpendEvidence> query adapter and append_verified_audit_event support for agreed spend collection/pause outcome actions | Reporting snapshot/owner preference cannot authorize managed spending; audit must distinguish partial/requested from confirmed; older reporting callers remain compatible |

Publication derives completeness from durable validated streams; no caller can
declare success by choosing a boolean. Expected capacity revision is checked
against Dev's reservation authority, not a separate DEV-C-only counter. JSONB is
a transport boundary with explicit allowlisted fields and size bounds, not an
unrestricted table mutation API. Errors: ownership denial; binding/revision/lease
conflict; invalid/partial evidence; provider unavailable; storage unavailable.
Dev returns exact SQLSTATE/RPC result unions and tests before consumer coding.

C-draft-2 amendment to BC-C2: each listSpendCampaignsPage campaign also returns
effectiveDailyBudgetPaise: number | null and budgetEvidence: "verified" | "unknown".
Reuse Dev's verified budget/hierarchy reader with bounded child streams; no
unbounded nested traversal or treating an absent parent budget as verified zero.

No edits requested to current historical migrations. Proposed new migration name
for Dev to confirm: `20260926_spend_observations.sql`; any managed authority/delivery
migration is a separate Dev-owned prerequisite. Dev reviews public wrappers/private
storage with fixed search paths and explicit grants, same-business FKs and
noncascading liability retention. DevOps reviews locks, expand/adopt/contract order,
PostgREST cache reload and rollback-compatible app floor. Preserve DB-A RPC callers.

Rollout remains disabled until both delivery and observation adapters are deployed
against accepted storage and independently tested. Rollback first disables new
managed starts while retaining collection, authorized pause/reconciliation and
durable liabilities. No rollback to parent-only activation, destructive down
migration or restored owner financial writes; DevOps supplies the compatible
artifact and separately approved release procedure.

## QA Cases and Regression Adoption

| ID | Setup and required assertion |
| --- | --- |
| C-01 | Original B active campaign + zero snapshot dated 2020: no successful sweep; unknown stale; no start authority |
| C-02 | Original B active campaign + no snapshot: no successful sweep; unknown missing, never synthesized zero |
| C-03 | More than 1000 businesses/campaigns/results and one page-two-only liability: all in-scope rows accounted for; busy campaign cannot crowd out another |
| C-04 | Failure on a later provider/local page: partial state, no complete publication or success heartbeat; resume from durable checkpoint |
| C-05 | Repeated cursor, conflicting duplicate row, malformed amount, missing date/currency or exhausted deadline: unknown; bounded termination |
| C-06 | Exact age threshold, future clock beyond allowed skew, oldest page stale despite fresh publish: fixture-defined boundary; no freshness renewal on retry |
| C-07 | Kolkata example, DST week, midnight/week rollover and timezone change: explicit nonoverlapping period keys; old liability retained |
| C-08 | Two collectors/out-of-order completion or expired lease: one current publication; late writer cannot replace state |
| C-09 | Concurrent complete publication and reservation: shared revision serializes decision; no start based on a superseded observation |
| C-10 | Externally activated/unmapped campaign or reconnect with old active account: unknown control state; liability included, no unrelated provider mutation |
| C-11 | Provider pause accepted but verification/local save fails: pending/unknown operation and retained reservation; no confirmed paused IDs or blind new mutation |
| C-12 | Cumulative snapshots, downward correction, partial new scan and paused/deleted campaign: no delta summation, silent lower liability or lost history |
| C-13 | Missing policy or unsupported cadence: managed start blocked; test fixture values never become production defaults |
| C-14 | Cross-business read/write, authenticated direct insert and wrong-generation checkpoint: denied; authorized service workflow remains valid |

QA's original two stale/missing assertions must first reproduce in the provisioned
B-based copy. Adopt them into the owned cron suite without changing expected results.
Additional cases above are proposed acceptance, not tests executed in this turn.
The two activation and two lead-pagination baseline failures remain their owners'
responsibility and must not be inverted, skipped or relabelled passed.

## Delivery, Validation and Resources

Completed now: this draft with concrete envelope, period, continuation, uncertainty,
policy, interface/ownership requests and acceptance cases. Only documentation
validation is permitted/needed for this deliverable: local links, required contract
sections, ASCII/whitespace/fences and the illustrative period/arithmetic fixtures.
No application unit, browser, database, build, provider or hosted checks run here.

Documentation checks passed for C-draft-1: 13 local links, all six interface
requests and 14 QA case IDs, sections, ASCII/whitespace/fences, exposure arithmetic
and both Kolkata week boundaries. Editor diagnostics reported no errors. C-draft-2
requires the same focused check plus B-1 cross-review/arithmetic checks below.

O-2 logical reservations: /tmp/adbrain-dev2-devc-o1 source copy and
.qa-artifacts/dev2-devc-o1/ immutable run namespace. Actual provisioning, manifest,
overlay hashes and dedicated execution allocation are pending DevOps receipt.
No workspace copy/artifact namespace/server/database/container/port has been
created or occupied by this turn; no heavy-run slot is held. Short read-only and
document-validation executions terminate normally. DevOps retains the first heavy
slot. Never use removed QA paths or independently reconstruct B a second time.

Next consumer actions, not automatic cross-chat dispatch:

1. Dev reviews BC-C1 through BC-C6 and the exposure coverage proof; returns exact
   agreement or a conflicting delivery proposal. Dev 2 will review that proposal
   when handed off; no agreement is inferred from silence.
2. QA supplies preserved assertions/overlay hashes and reviews C-01 through C-14.
3. DevOps supplies the same identified baseline as Dev, independent writable copy,
   execution slot, current-source delta and achievable cadence/recovery limits.
4. CEO records accepted CONTRACT-BC version, week/exposure/pause policy decisions,
   exact interface writers and permission for dependent implementation. Owner
   approval remains required for infrastructure expenditure and live operations.

Regression execution is waiting on QA artifacts and DevOps allocation; product
implementation is contract-blocked. Neither blocks this completed draft. Full
DEV-A, DEV-D, DEV-E and PAY-A/B remain outside this assignment. No publication,
credential change, production migration, provider object or spending action occurred.

## Dev 2 Review of B-1

Reviewed Dev's [B-1 proposal](db-a-dev-a-handoff-2026-09-26.md#o-2-dev-b-delivery-and-reservation-proposal)
after completing the first document check. This is a bounded technical response,
not CEO acceptance or authorization to edit Dev's files.

- Agree: exact reviewed identity; safe INR minor units; Monday account-local week;
  one business-wide lock and revision; conflict on stale evidence; retained old
  account/period liability; immutable intent before I/O; no lock across provider
  I/O; no free capacity from lease expiry; pause through Dev's durable service.
- Conditionally agree with per-campaign max(S,C)+U, where C is explicitly a total
  envelope and its coverage matches S. The covered-spend fixture gives 140000 in
  both proposals. Add S=(160000,0), C=(140000,140000): per-campaign exposure is
  300000, while the old global max gives 280000. Require this case in joint tests.
- Still open: whether every observed campaign cost is included in its C, how
  unreserved/external effects map to U, and when late-reporting reconciliation
  permits release. Do not automatically subtract spend by campaign ID alone.
  Dev's paused-reconciled fixture requires proof for its C=0 and bounded U=5000;
  it is not permission to estimate an uncertainty amount without policy/evidence.
- Agree on blocking conflicting account calendars/overlapping periods; this draft
  additionally proposes verified exclusive business attribution per account.
  CEO must accept that restriction or commission the shared-account model.
- Envelope alignment supplied: collection start/end timestamps, oldest response,
  complete inventory including observed status/effective-budget validity,
  per-campaign cumulative values and explicit nullable provider watermark.
  B-1 names collectionStartedAt/collectionCompletedAt; propose mapping to
  requestStartedAt/responseReceivedAt above and selecting exactly one naming set.
- Shared API reconciliation remains open: use B-1 readCapacitySnapshot as the
  coherent authority/evidence read, not a competing getManagedSpendEvidence read
  assembled from independent queries. Dev may expose the latter only as a wrapper
  over that same snapshot. publishSpendObservation must derive trusted completeness
  from checkpointed storage and use BC-C3, not accept a caller-asserted complete row.
- Align pause requestKey with B-1 rather than introduce a second idempotency domain.
  BC-C5's coarse state is an adapter projection of B-1's operation states:
  confirmed -> confirmed, needs_reconciliation -> unknown, other nonterminal
  states -> pending. getDeliveryOperation must expose the stored operation;
  reconcileDelivery performs authorized recovery, never an implicit read-side
  retry. Final typed commands/result unions and terminal-failure mapping remain
  Dev's requested response; no independent DEV-C operation state machine.

Requested next response from Dev: accept or revise those coverage, field-name,
snapshot/publication and pause-state mappings. Remaining prerequisites are actual
QA artifact handoff, DevOps source/slot allocation and CEO's accepted contract;
neither proposal is represented as accepted by this cross-review.

## O-4 Checkpoint: C-draft-3

Worker Dev 2 / DEV-C / board O-4 / CONTRACT-BC DRAFT, not accepted.
Checkpoint state: complete, document/fixture/source-integrity checks passed.
This is not product or contract acceptance. This section is the current file-based
handoff; the owner need not relay a chat transcript. Only this owned receipt is
being changed. No ownership transfer or product implementation is implied.

### Delivered Inputs Consumed

Read [O-4](../ORCHESTRATION.md#file-based-handoffs),
[Dev B-2](db-a-dev-a-handoff-2026-09-26.md#money-period-and-exposure),
[QA-BC-cases-1 and R1-R6](qa-a-o1-handoff.md#contract-bc-review), and
[DevOps' allocation](ops-environment-2026-09-26.md#workspace-and-resource-register)
from the shared workspace. Do not use B's older receipt copies as current dispatch.

Delivered source: /tmp/adbrain-dev2-devc-o1, independently writable B source with
529 manifest files, HEAD 9da5b07b00e54fb552796cbcf01cc5fc7c2f02e7 and manifest
9533d1d0e81069291536e6b97c020334eb1ddbf48858d31181a0181e0b5e4d13.
It is not a Git checkout; receipt identity is not a new commit. No source overlay
has been applied by Dev 2. Dependencies and execution readiness are separate from
source delivery, and will be checked rather than inferred from that delivery.

Delivered QA artifacts to consume, not recreate:

| Input | SHA-256 / expected meaning |
| --- | --- |
| [QA manifest](../../.qa-artifacts/qa-a-o1/handoff-YTrGx9/manifest.json) | 642bc8093c74d4c0689eff9b1516a65467e894854ed44dc70c7ada517d9fcce1; 19 preserved artifacts |
| [Spend reproducer](../../.qa-artifacts/qa-a-o1/handoff-YTrGx9/reproducers/qa-cron-recheck.test.ts) | 2080e2cf755cea24955d9ec6ac6d43590277b38f480b921adc9d18f94fd6268b; both stale and missing parameters retained, historical B failures |
| [F8 reproducer](../../.qa-artifacts/qa-a-o1/handoff-YTrGx9/reproducers/qa-instructions-recheck.test.ts) | b492941faf8973573f90e3011b8a0b5fca2f30924ae6ace73868f1e51dc83081; historical B pass |
| [QA decision vectors](../../.qa-artifacts/qa-a-o1/contract-cases-o2.json) | 2e8b26ea48e5c49b45e268262381e6096d3daa86f269a0a7f21e2041516377ce; 25 draft specifications, not executed product tests |

### B-2 and QA Decisions

These are Dev 2's explicit technical agreements/proposals for Dev and QA to review,
not an assertion that those workers or CEO accepted C-draft-3.

| Request | Dev 2 disposition | Exact controlling rule / remaining decision |
| --- | --- | --- |
| R1 / exposure | Agree with B-2 | Use S + C - K + U per uniquely attributed position, plus known residual incurred spend, disjoint account uncertainty and safety reserve once. K is proven coverage, not automatically min(S,C). Unknown coverage blocks admission. Dev owns the only decision function |
| R2 / account residual | Agree with B-2; specify partition below | Count verified account incurred total once, partitioned into mapped campaign spend and residual. Shared/unverified account or inconsistent totals stays unknown. Exclusive attribution is proposed v1 scope, still needs CEO acceptance |
| R3 / envelope | Exact mapping proposed below | Adopt B's collectionStartedAt/collectionCompletedAt; retain oldestResponseReceivedAt and DB publishedAt. One domain type location, complete inventory and checked budget evidence, no competing aliases |
| R4 / protective target | Agree with B-2's bounded v1 | requestKey only; local campaign required for mutation. Provider-only target remains visible unknown + escalation, not a fabricated local ID or account-wide pause. Specify raw/coarse state projection below |
| R5 / reporting lag | Strict v1 proposal below | An absent provider watermark never becomes zero lag from a recent fetch or a configured number. Keep admission unknown without validated reporting/coverage evidence. Provider-finality and release proof remain distinct |
| R6 / HTTP and sweep | Agree; exact mapping below | A nested 202 delivery acknowledgement cannot produce sweep 200/ok=true. Required pauses need verified provider state plus durable confirmation; stale/partial evidence remains unknown even after pause |

R1 proof proposal: Dev stores coverage credits identified by business, account,
period, provider campaign, reservation/effect ID, observation ID, immutable
evidence-slice ID, authorized [start,end) interval and amountPaise. In one business
transaction, validate interval containment, identity and provenance, sum credited
amounts against both the source slice's proven spend and the reservation ceiling,
and reject duplicate credit identities. Replays do not recredit. Multiple holds
cannot each claim the same source amount. Observation/generation changes cannot
relabel evidence to bypass uniqueness. A whole-week cumulative row without the
necessary interval/effect evidence supplies S, not an automatic K. An absent
overlap proof is null/UNKNOWN; a proved disjoint interval can have K=0.
Dev must return the exact storage constraints and accepted proof source; none of
today's reporting fields are declared sufficient evidence for this by the draft.

R2 partition: let A be the verified account total and M the sum of unique mapped
campaign rows for the same query/period. Residual R=A-M must be nonnegative and
include unmapped/deleted spend, not discard it. Validate all returned campaign
rows, including unmapped rows, against A; contradictory sums produce UNKNOWN,
not a negative residual clamped to zero. Use M+R=A once in the decision, not A+M.
Known unmapped incurred spend is not itself uncertain additional liability.
Unbounded external delivery is a separate control/uncertainty gate even with a
known residual. Complete account totals do not excuse partial campaign inventory
or missing attribution required for coverage. Preserve original-account liability
across selection changes; conflicting calendars block new admission as in B-2.

### Canonical Interface Mapping

This section supersedes incompatible names/signatures in BC-C1 through BC-C6 and
the B-1 review. Exact filenames requested remain unchanged and ownership stays
with the O-4 register. Dev supplies shared types/SQL/client before Dev 2 consumers.

| Surface / writer | Canonical C-draft-3 request |
| --- | --- |
| Domain types / Dev | Proposed src/lib/campaign/delivery-contracts.ts is the sole home of SpendScope, SpendPeriod, SpendObservation, SpendEvidence, CapacitySnapshot, PauseCommand, PauseResult and error unions. src/lib/types.ts holds generated database row/RPC types only |
| Observation timestamps / Dev | Rename requestStartedAt -> collectionStartedAt and responseReceivedAt -> collectionCompletedAt; keep oldestResponseReceivedAt, publishedAt and providerDataThrough: string or null. No dual accepted names or fallback timestamps |
| Inventory / Dev | Retain campaignInventory with provider campaign ID, effectiveStatus, effectiveDailyBudgetPaise: number or null, budgetEvidence: verified or unknown; immutable inventoryRevision binds all pages and spend rows. Scope's currency/query/binding provenance must match the inventory |
| Capacity read / Dev | readCapacitySnapshot(actor, scope, period): Promise<CapacityReadResult>. One transaction returns authority/policy revisions, business capacityRevision, accepted observation ID, SpendEvidence, positions/coverage/uncertainty and reserve. Remove independent getManagedSpendEvidence; DEV-C projects snapshot.evidence |
| Publication / Dev | publishSpendObservation(actor, { scope, period, runId, leaseToken, expectedCapacityRevision }): Promise<PublishSpendResult>. Invoke BC-C3 publish_spend_observation against stored validated pages. No caller-supplied observation, amount, completeness, sequence or publication timestamp |
| Protective request / Dev | requestProtectivePause(actor, command: PauseCommand): Promise<PauseResult>. command contains requestKey, scope, campaignId, reason and triggeringObservationId: string or null. Null supports missing-evidence pauses; target authority is reloaded independently of observation availability |
| Read/recovery / Dev | getDeliveryOperation(actor, operationId): Promise<PauseResult> is read-only; reconcileDelivery(actor, operationId): Promise<PauseResult> explicitly performs authorized recovery. Both apply the same scoped operation visibility and raw/coarse state mapping |
| Collector / Dev 2 | Proposed spend-repository.ts calls shared publication/capacity boundaries and the agreed claim/checkpoint RPCs; spend-collection.ts orchestrates bounded reads; spend-observations.ts validates evidence. No direct capacity writes or provider status mutation |

PauseCommand accepts only an authorized local campaign target with stored original
binding. When inventory contains only a provider ID, DEV-C does not invoke that
command; it records a control exception with null operation ID and escalation
required. This is deliberately not an instruction to import the object in order
to obtain mutation authority. Reading inventory/spend remains permitted under
the verified account read capability; pausing needs separate target authority.

Proposed transport/domain results, with UUID, revisions, dates and scope validated
by the single shared boundary:

```ts
type SpendContractErrorCode =
  | "INVALID_INPUT" | "NOT_FOUND" | "REVIEW_CHANGED" | "BINDING_CHANGED"
  | "IDEMPOTENCY_CONFLICT" | "REVISION_CONFLICT" | "LEASE_LOST"
  | "CAPACITY_EXCEEDED" | "EVIDENCE_UNKNOWN" | "AUTHORITY_UNAVAILABLE"
  | "RECONCILIATION_REQUIRED" | "STORAGE_UNAVAILABLE";
type SpendContractResult<Value> =
  | { ok: true; value: Value }
  | { ok: false; code: SpendContractErrorCode };
type PublishSpendResult = SpendContractResult<{
  outcome: "accepted" | "unchanged";
  observationId: string;
  capacityRevision: string;
}>;
type CapacityReadResult = SpendContractResult<CapacitySnapshot>;
type PauseOperationState =
  | "reserved" | "dispatching" | "verifying" | "confirmed"
  | "compensating" | "needs_reconciliation" | "cancelled_before_dispatch";
type PauseResult = SpendContractResult<{
  operationId: string;
  desiredStatus: "PAUSED";
  operationState: PauseOperationState;
  state: "pending" | "confirmed" | "unknown" | "failed";
  confirmedAt: string | null;
}>;
```

CapacitySnapshot embeds the existing SpendEvidence envelope, coherent authority,
positions and coverage identifiers described above. Dev's exact storage DTO is
still an acceptance output; no implementation should guess absent fields.
Add unknown reasons reporting_lag_unverified, totals_inconsistent and
unverified_account_attribution to the shared SpendUnknownReason union. A complete
valid collection may be published as evidence while its admission eligibility is
unknown; publication is not permission to spend or to release coverage holds.

Projection applies to a PAUSED operation only: confirmed -> confirmed only after
verification of all required original targets and persisted confirmation;
needs_reconciliation -> unknown; cancelled_before_dispatch -> failed;
reserved/dispatching/verifying/compensating -> pending. All nonconfirmed states
have confirmedAt=null. confirmedAt denotes persisted completion; retain separate
providerConfirmedAt in the durable evidence/timing receipt. Never project a
confirmed activation operation as a confirmed protective pause. A provider
rejection after dispatch must be reconciled, not labelled cancelled-before-send.

Duplicate identical publication returns unchanged; stale expected revision,
ordering or changed inventory returns REVISION_CONFLICT; expired writer returns
LEASE_LOST; insufficient evidence returns EVIDENCE_UNKNOWN. Lower corrections
stay recorded and require reconciliation, never automatic liability release.
Domain outcomes use the result union, not leaked SQL text. Grant/ownership denial
(SQLSTATE 42501) and input validation (22023) are mapped at the adapter; unexpected
DB errors become STORAGE_UNAVAILABLE. Domain conflicts are explicit RPC results.
Dev must confirm this tagged-result contract before implementing SQL consumers.

HTTP mapping proposal: invalid input 400; unauthenticated 401; invisible/missing
target 404; review/binding/key/revision/lease conflicts 409; capacity exceeded 422;
unavailable authority/evidence/storage 503. A stored pending/unknown delivery
operation returns 202 with its ID, not a bare dependency rejection. A confirmed
pause returns 200 only after durable confirmation. The spend cron still returns
503/ok=false for any incomplete scope/evidence or unconfirmed required pause,
even if an individual delivery endpoint legitimately returned 202 or 200.

### Null Watermark and Required Policy

R5 v1 rule: providerDataThrough=null is reporting_lag_unverified for managed
admission. Configured maxProviderReportingLagMs alone does not prove actual lag.
A non-null watermark also needs an approved, verified semantic meaning and a
passing age bound; it is not automatically provider finality or coverage proof.
Current reporting responses do not establish either condition. Contract tests
may provide explicit synthetic proofs; production cannot inherit those fixtures.

Continue collection, retain observed incurred spend/holds, and permit authorized
protective pause while admission is unknown. Owner approval of a measured,
bounded-liability alternative would require a new contract revision, not a
fallback to fresh-fetch-means-fresh-money. The strict v1 rule may prevent managed
starts with the currently available provider evidence; that limitation is explicit.
Hold release additionally requires verified inactivity and reconciled late effects;
no elapsed deadline or watermark alone releases money.

Age boundary is trustedNow-oldestResponseReceivedAt <= maxObservationAgeMs;
future timestamps beyond clockSkewAllowanceMs are invalid. All policy fields
listed earlier, including safetyReservePaise and unknownActiveAction, are required
and versioned. A zero reserve is allowed only when explicitly approved in the
applicable policy, not supplied by a decoder default. Proposed managed unknown
action remains request_verified_pause_and_escalate for authorized targets, visible
escalation for unmapped targets. DevOps/owner must approve feasibility, responders
and values; no production five-minute promise or automatic policy approval.

### Discriminating Checks and Next Consumer

Contract check: B-2's nine arithmetic fixtures must retain explicit null coverage
rejection, and QA BC-12/13 must give 70000 incurred (not 120000), one reserve,
exact-cap admission and one-paise-over rejection. QA BC-15/21 must reject
300001ms-old evidence and preserve the 169-hour DST week. These are document/
fixture checks, not alternate implementations accepted instead of product tests.

Historical route oracle remains unchanged: both stale-zero and missing-result
variants must reject ok=true. Baseline expected outcome is two failures, followed
by passing assertions only after contract-approved product fixes. Preserve F8's
passing instruction-read oracle. Do not weaken either parameter or mock stored
zero evidence into the missing case.

Next Dev response: confirm canonical DTO/error/SQL/publication mappings and supply
the exact coverage-proof constraints; no duplicate decision or read model.
Next QA response: assess C-draft-3/B-2 against R1-R6, especially strict watermark
and unmapped-target rules. Next DevOps response: dependency-install/runtime and
isolated execution readiness for the already delivered Dev 2 source. Its released
preparation slot is not a dedicated test execution allocation. CEO decides the
single accepted contract and explicit policy/implementation scope.

Resources: retain the delivered /tmp/adbrain-dev2-devc-o1 source reservation;
Dev 2 has made no changes inside it and no dependency symlink/install. No service,
port, database, VM or heavy-run slot is held. No provider, browser, credential,
Git publication or production action occurred. Source and QA handoff are delivered;
only dependency/execution readiness and contract acceptance remain prerequisites.

### C-draft-3 Validation Receipt

Executed synchronous `node` with stdin assertions using node:assert/strict,
node:fs, node:path and node:crypto on Node v22.12.0; exit 0. No application imports,
environment-file loading, package installation, source-copy mutation or provider
requests. Read-only git rev-parse HEAD and git branch --show-current confirmed
the shared checkout remains dev at 9da5b07b00e54fb552796cbcf01cc5fc7c2f02e7.
That is not a clean-tree or runtime acceptance claim.

- Document: 23 local links/anchors, required O-4 sections, ASCII, whitespace and
  balanced fences pass. The first check mishandled an empty-path same-document
  anchor; corrected the checker to resolve it to this file, then reran successfully.
  Editor diagnostics reported no errors.
- QA: verified the manifest checksum, all 19 artifact checksums, decision-vector
  checksum and 25 unique case IDs. The original stale/missing/F8 file contents
  match QA's handoff. They were inspected/verified, not adopted or executed yet.
- B-2: all nine arithmetic fixtures pass safe amount/coverage bounds, expected
  exposure and admission assertions. QA BC-12 residual, BC-13 exact cap plus one
  paise, BC-15 stale oldest page and BC-21 169-hour DST arithmetic checks pass.
  This is fixture consistency, not a model accepted in place of product behavior.
- Allocation: independently rehashed all 529 files in /tmp/adbrain-dev2-devc-o1;
  exact file set and per-file hashes match B, no extra files/symlinks. Source
  manifest file checksum is
  4ff97c3a6f324a8155256327f846ebc4e62a580937bdbc9b8ab5df5e0c922c8e.
  node_modules is absent. No overlays, source changes or reconstruction occurred.

Peer receipt identities consumed (SHA-256, not new acceptance claims):

| Input | SHA-256 |
| --- | --- |
| Dev B-2 delivery handoff | 5bbdff04d9f061af5883660a7b7852539770875695040e567bf97f235f288ab6 |
| QA acceptance handoff | 2f2e611229f72ac7b332fc91b7de1ee9e3962ad6deede8fb005b98ff1757e484 |
| DevOps operations receipt | 2f4adf3aa6733ef7fa86fa36ef0a004e90546bcb3ffff994838ff5de7d62010c |
| O-4 orchestration board | a5402c33b8af2c2b6868eb6556b613a4420d699b2f9e221ceccf5992aebe0a51 |

Next acceptance check after DevOps readiness: adopt the unchanged QA stale/missing
assertions into the isolated owned cron suite, retain F8, and run focused Vitest
with the QA filter, one worker, scrubbed placeholder configuration and paid
evaluation disabled. Expected baseline: two spend failures and F8 pass. Product
implementation and any subsequent passing-fix claim still require accepted
CONTRACT-BC and Dev's tested shared interfaces. No request to relay this receipt;
Dev, QA, DevOps and CEO consume their named requests directly from this file.

## O-5 Input Review

Dev 2 / DEV-C / board O-5. CONTRACT-BC remains DRAFT / not accepted.
This is a compact input/blocker checkpoint, not C-draft-4 or another naming scheme.
Read the shared O-5 board, Dev's latest B-3 checkpoint, QA's completed O-4
R1-R6 review and DevOps' O-4 dependency/browser receipt directly.

QA now supports the explicit coverage formula, reserve counted once, account
residual arithmetic, required inventory/oldest-page content, null-watermark
uncertainty and sweep/operation separation. Those objections are materially
advanced, not six unchanged blockers. Coverage-proof storage/source, exact shared
API consolidation and owner/provider feasibility remain unaccepted.

Dev 2's response to the shared-interface owner, for its O-5 consolidation:

| O-5 difference | Dev 2 position; no independent renaming |
| --- | --- |
| Timestamp names | Either existing pair is acceptable. Dev selects one; preserve earliest request, final response, oldest-page age and no freshness renewal by publication/retry |
| Publication arguments | collectionId or runId is not a safety disagreement. Dev selects one; bind the actor and immutable stored scope/period, lease and expected business revision, deriving all trusted contents from validated pages |
| Capacity read | Accept the coherent snapshot directly or a projection wrapper over that exact snapshot. A wrapper must not perform independent evidence/authority reads |
| Pause/read result | Accept Dev's consolidated result naming only with stored PAUSED intent/operation-kind evidence before claiming a confirmed pause, nullable observation ID, explicit missing versus unavailable outcomes, and read-only lookup distinct from reconciliation |
| Errors and HTTP | Distinguish known authority denial from inability to verify authority; retain tenant-safe 401/404 behavior, explicit lease/revision/storage outcomes and the rule that nested 2xx never alone means sweep success |

These are review criteria and flexibility on names, not advance approval of an
unseen delta. Dev remains the sole writer of the canonical mapping. No new type
or error vocabulary is introduced here. QA's
[BC-26 through BC-32 supplement](../../.qa-artifacts/qa-a-o1/contract-cases-o4.json)
is the next discriminating input: prior-interval coverage, duplicate credit,
missing-observation pause, every state projection, exact age boundary and confirmed
ACTIVE versus PAUSED must be checked against Dev's consolidated mapping.

Specific current blocker: Dev's saved handoff ends at the B-3 checkpoint and
does not yet contain the O-5 consolidated delta requested by the coordinator.
DevOps' saved dependency receipt still says preparation is in progress, not
execution-ready. Terminal progress is not a substitute for that completed handoff.
Do not interrupt either worker, install/link dependencies, rename toward B-3 or
run regressions against an actively provisioned copy to bypass these gates.

Next consumers: Dev supplies the compact consolidated mapping; Dev 2 then checks
it against these requirements and QA BC-26 through BC-32. DevOps supplies completed
guarded dependency/execution readiness before the unchanged stale/missing and F8
regressions run. CEO still owns contract acceptance. Source and original QA
artifacts remain delivered, not missing dependencies.

Changed only this owned receipt; retained /tmp/adbrain-dev2-devc-o1 reservation
without modifying it. No product, SQL, package, test or peer-document edits;
no server, DB, provider action, publication, heavy slot or background process.
Checkpoint: complete for O-5 input review and blocker recording, not contract or
product acceptance. Node v22.12.0 stdin node:assert/strict checks passed: 25 local
links/anchors, five delta rows, ASCII/whitespace/fences, seven unique BC-26 through
BC-32 IDs and Given/When/Then structures. Supplement checksum matches QA's receipt:
74ac3093e22c9063804dcbc14c7e2954b00ca5cc14bc1ce6094698d8ddaf1ca3.
No vector was executed against product code or rewritten to make it pass.

Pinned receipt inputs (SHA-256): Dev B-3
ab12ee72a734fcf56f682eebad8fc2f354be8a25c24cf28e024fe1b270ee03a0;
QA O-4 29c211a4a594921daff7d597e6b44ffa39886f291d8309a00d9e023952484957;
DevOps 2f4adf3aa6733ef7fa86fa36ef0a004e90546bcb3ffff994838ff5de7d62010c.
Next acceptance check is the consolidated Dev delta against the five rows and
QA supplement, not another full proposal or a rerun of prior input checks.

## O-6 D-1 Agreement and Regression Preparation

Dev 2 / DEV-C / board O-6. CONTRACT-BC remains DRAFT / not accepted.
Read the finalized [D-1 canonical delta](db-a-dev-a-handoff-2026-09-26.md#o-5-canonical-integration-delta-d-1)
and [completed runtime handoff](ops-environment-2026-09-26.md#unit-execution-contract-and-slots)
directly. Both previous missing-input blockers are superseded. Software release
authority is recorded in O-6, but DevOps remains the executor; this worker is not
publishing code or performing financial/provider/schema actions.

**Dev 2 agrees with D-1 without a field/type/semantic correction.** It is the
single canonical mapping for this packet, subject to QA and CEO acceptance:

| Difference | Dev 2 agreement |
| --- | --- |
| Timestamp names | collectionStartedAt/collectionCompletedAt, earliest/final semantics, separate oldestResponseReceivedAt, DB publishedAt and nullable providerDataThrough; no alternate wire names |
| Publication arguments | actor plus scope, period, runId, leaseToken and expectedCapacityRevision; stored run verification, trusted stored-page derivation and unchanged replay without freshness renewal |
| Capacity read | readCapacitySnapshot returns CapacityReadResult; consume value.evidence only after ok=true. Remove getManagedSpendEvidence and all independently assembled reads |
| Pause/read result | PauseResult for the PAUSED-only request; DeliveryOperationResult for general read/reconcile, with stored desiredStatus and raw/coarse states. Use triggeringObservationId and requestKey; no second naming or idempotency domain |
| Errors and HTTP | Adopt D-1's complete error/reason unions, authority denied 403 versus unavailable 503, tenant-safe 401/404, lease/revision conflicts, storage distinction and SQLSTATE handling. Nested 200/202 cannot make an incomplete sweep successful |

QA supplement review against D-1 and its retained B-3 safety rules:

| Vector | Review result |
| --- | --- |
| BC-26 | Per-position explicit coverage yields 300000, not global-max 280000; D-1 preserves this rule |
| BC-27 | Prior-interval spend with proven zero overlap stays additional: 170000; campaign identity alone gives no coverage credit |
| BC-28 | Individual and aggregate credit bounds, idempotent exact replay and changed-content conflict retained; concrete storage/proof-source tests still required |
| BC-29 | Nullable triggeringObservationId permits an authorized missing-evidence pause; original-target authority is checked independently, no fabricated observation |
| BC-30 | Every raw state has a projection; cancelled_before_dispatch is failed, not pending; getDeliveryOperation is read-only and unconfirmed results have null confirmedAt |
| BC-31 | Inclusive oldest-page age threshold preserved; retry/publication cannot reset age. Fixture values are not production defaults |
| BC-32 | Stored desiredStatus=PAUSED, both confirmed states and durable confirmedAt are all required. A confirmed ACTIVE operation never contributes a paused ID |

This is contract review, not execution of the vectors against product/SQL. No
claim of QA acceptance, supported provider watermark/coverage or usable production
managed admission follows. Shared runtime schema/storage implementation still
waits for CEO's accepted CONTRACT-BC version and explicit permitted scope.

Runtime delivered: independent Node 24.21.0/macOS arm64 dependencies in
/tmp/adbrain-dev2-devc-o1; B source manifest remains
9533d1d0e81069291536e6b97c020334eb1ddbf48858d31181a0181e0b5e4d13.
Use only DevOps' frozen network preload and scrubbed placeholder environment.
No dependency installation, shared configuration or application source change is
needed. Staging selected QA cron/F8 files is permitted; running them waits for
Dev's recorded completion/release of the preceding short regression slot.

Prepared isolated overlays are tests/qa-cron-recheck.test.ts and
tests/qa-instructions-recheck.test.ts, exact copies of QA's hashed inputs for
baseline reproduction only. No modification to required shared CI or permanent
duplication of the existing owned suites; integration into those suites follows
the approved implementation. Expected baseline is two spend failures and F8 pass.
An import/setup/guard failure is not either spend reproduction.

Checkpoint: complete for D-1 agreement and isolated assertion staging; no product
regression run or full contract acceptance claimed. Source reservation remains
held; no heavy slot, server, DB, port, VM or background execution is held.

### O-6 Verified Staging Receipt

Node 24.21.0/macOS checks passed: 27 document links/anchors, seven BC-26..32
review mappings and all five D-1 pause-discriminator examples. D-1 input receipt
SHA-256: e17bd091a1708b3e7088e23e34d136a14d599aa268287bf8783fe5576536f8be.
These are contract checks, not a passing application suite.

Verified B's 529 source hashes before staging; verified the same 529 hashes and
the exact 531-file non-dependency path set afterward. Both new files are
byte-identical to QA's preserved assertions and have no TypeScript parse errors.
Syntax checking used the isolated TypeScript package under the frozen no-network
preload; it imported no application modules and ran no Vitest tests.

| Isolated overlay | SHA-256 |
| --- | --- |
| tests/qa-cron-recheck.test.ts | 2080e2cf755cea24955d9ec6ac6d43590277b38f480b921adc9d18f94fd6268b |
| tests/qa-instructions-recheck.test.ts | b492941faf8973573f90e3011b8a0b5fca2f30924ae6ace73868f1e51dc83081 |

Verified package-lock SHA-256
9d82d5a71cedb3d12518fef5856f15a92ce46a29b4812e592d413d6e663a48b0;
installed dependency-lock SHA-256
f0f21529292ec90545bdd9552c70cdd79fe11b5f19c66041e3f34d882f9570ca;
frozen guard SHA-256
31abc8b977d4cd23b7569028fcb5e95e5916d907ee1fea7e4808875a13038709.
No package/configuration changes were needed.

Immutable [staging receipt and full manifest](../../.qa-artifacts/dev2-devc-o1/o6-staging-bUkDoJ/receipt.json),
SHA-256 fba38ef6746004afa09bd02dcb99f847badba7afa29aeede8797a08e52d76fdb.
Combined manifest SHA-256:
8a1430bfb81c50a69ddff03af59579ec72ac8f803e4ff985b0da307055f783f8.
Encoding is recorded in that receipt. The owned artifact namespace is Git-ignored
and outside Playwright cleanup. QA's source artifacts were not modified.

Current execution dependency, checked after staging: Dev's saved handoff still
ends at D-1 and has no completion/release of its preceding regression slot.
Do not confuse an earlier documentation checkpoint's no-resource statement with
release of the newly assigned O-6 test slot. Runtime/dependencies are ready;
waiting for slot release is the only remaining prerequisite for baseline execution.

Next: after that explicit release, run both prepared files from the Dev 2 copy
using the handed-off scrubbed Node 24 environment and frozen guard, QA name filter
and maxWorkers=1. Save actual exit/assertion results in a fresh immutable run
directory, distinguish expected safety failures from setup errors, and release
the short slot immediately after completion. Do not repair product behavior until
the separate CONTRACT-BC gate opens. QA and CEO can consume this D-1 agreement
now without waiting for the serialized test run or another transcript relay.

## O-8 Issue 27 Handoff

Dev 2 / board O-8 / new packet: GitHub issue
[#27, AI SDK integration](https://github.com/vanshulgoyal101/adbrain/issues/27).
DEV-C leaves the active implementation queue. D-1 agreement and the staged
stale/missing/F8 assertions remain preserved, not implemented or accepted fixes.
Release any prior claim to a DEV-C execution slot; none is running. Retain the
B source/dependency copy and immutable staging receipt as evidence, not as the
new SDK implementation workspace. No evidence deletion or shared branch change.

Read issue #27 directly from GitHub, O-8 and the release workflow. Intended scope
is the existing LLM facade/provider adapters and relevant tests, with issue-only
pinned dependencies in the allocated worktree. Preserve provider/key/model order,
cooldowns, budget/cache behavior, usage/cost, errors, structured-output compatibility,
cancellation and deadlines. No image/model/prompt overhaul or paid provider calls.
QA owns independent exact-commit review; DevOps retains final dependency and
publication coordination. A tested issue-linked PR to dev is the requested output.

Concrete allocation blocker at this checkpoint: git worktree list --porcelain
contains the shared dev checkout, the retained G-1 release worktree and three
prunable historical release entries; no issue-27 worktree is registered. Shared
dev remains 9da5b07b00e54fb552796cbcf01cc5fc7c2f02e7, behind its tracking ref by
four commits, with unpublished changes. The current DevOps receipt has no O-8
issue-27 path/branch allocation. Do not infer allocation from the old B copy or
create/switch a competing worktree while DevOps owns reconciliation/allocation.

Request to DevOps: complete the O-8 preservation/reconciliation checkpoint and
publish the #27 worktree's absolute path, feature branch, verified current-dev
base SHA and dependency/publication ownership. This is the only blocker identified
before implementation; no dependency compatibility or test failure is claimed.
Next Dev 2 action on that handoff: inspect the facade's controlling adapters and
nearby tests, select/audit pinned direct-provider SDK versions, then implement and
validate the smallest behavior-preserving change. No PR before a real tested diff.

This checkpoint changes only this owned receipt. No SDK packages installed,
application/test edits, Git commit/push, provider request or PR creation occurred.
No runtime resource held. The allocation request is saved for direct DevOps
consumption; the owner need not relay a transcript.