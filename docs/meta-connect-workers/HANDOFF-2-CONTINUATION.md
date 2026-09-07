# Worker 2 Handoff (Continuation Session)

## 1. Baseline commit, contract version, completed task IDs

- Baseline: `d8d7890` (`Verify displayed preview bytes with bounded comparisons`).
- Contract: Meta Instant Connect v1, C0 proposed contract.
- Completed task IDs: W2-01 contracts; W2-02 draft HTTP persistence; W2-03
  preflight core and route; W2-04 planner persistence and durable paused create;
  W2-05 durable operation claim/checkpoint/reconciliation; W2-06 binding-aware
  consumers and unsafe internal mutation disablement; W2-T01 through W2-T12 plus
  runtime route coverage.
- Concurrent paths observed and left untouched: `docs/ROADMAP.md`,
  `docs/META-INSTANT-CONNECT-PLAN.md`, `docs/meta-connect-workers/**`,
  `src/lib/meta/connect-contracts.ts`, and `tests/meta-connect-w1-contracts.test.ts`.

## 2. Exact changed paths

Session 1 (baseline):
- `docs/meta-connect-workers/HANDOFF-2.md` (this handoff).
- `src/lib/campaign/connect-contracts.ts`
- `src/lib/campaign/preflight.ts`
- `src/lib/campaign/operations.ts`
- `tests/meta-connect-w2-contracts.test.ts`
- `tests/meta-connect-w2-safety.test.ts`
- `tests/meta-connect-w2-safety-core.test.ts`
- `src/app/api/campaigns/create/route.ts`
- `src/app/api/campaigns/[id]/route.ts`
- `db/migrations/20260907_campaign_connect.sql`

Session 2 (continuation):
- `tests/meta-connect-w2-plan-validation.test.ts` (new)
- `tests/meta-connect-w2-operations-comprehensive.test.ts` (new)
- `tests/meta-connect-w2-oauth-activation.test.ts` (new)
- `src/lib/campaign/planner-draft.ts` (new)
- `src/lib/campaign/draft-store.ts` (new)
- `tests/meta-connect-w2-draft-store.test.ts` (new)
- `src/lib/campaign/preflight-service.ts` (new)
- `src/lib/campaign/binding.ts` (new)
- `tests/meta-connect-w2-planner-route.test.ts` (new)
- `tests/meta-connect-w2-refresh-route.test.ts` (new)
- `tests/meta-connect-w2-leads-sync-route.test.ts` (new)
- `tests/meta-connect-w2-preflight-service.test.ts` (new)
- `tests/meta-connect-w2-binding.test.ts` (new)
- `src/lib/campaign/operation-store.ts` (new)
- `tests/meta-connect-w2-operation-store.test.ts` (new)
- `tests/meta-connect-w2-executor.test.ts` (new)
- `tests/meta-connect-w2-activation-route.test.ts` (new)
- `docs/meta-connect-workers/HANDOFF-2-CONSUMER-INSPECTION.md` (new)
- `src/app/api/campaigns/lead-forms/route.ts` (authorized current-connection read)
- `src/lib/meta/client.ts` (additive mutation checkpoint callback)
- `tests/meta-client.test.ts` (checkpoint sequence coverage)
- `tests/api-routes.test.ts` (lead-form boundary and traffic mutation regressions)
- `src/app/api/campaigns/plan/route.ts` (plan-only fail-closed conversion)
- `src/app/api/campaign-drafts/route.ts` (durable draft POST)
- `src/app/api/campaign-drafts/[id]/route.ts` (durable draft GET/PUT)
- `src/app/api/campaigns/preflight/route.ts` (review envelope)
- `src/app/api/campaigns/operations/[id]/route.ts` (safe operation DTO)
- `src/lib/campaign/preflight-runtime.ts` (shared DB/Meta preflight adapter)
- `tests/meta-connect-w2-draft-routes.test.ts` (new)
- `tests/meta-connect-w2-preflight-route.test.ts` (new)
- `tests/meta-connect-w2-operation-route.test.ts` (new)
- `tests/meta-connect-w2-create-route.test.ts` (new)
- `src/app/api/campaigns/[id]/refresh/route.ts` (binding-aware insight reads)
- `src/app/api/leads/sync/route.ts` (authorized current-connection lead reads)
- `src/app/api/campaigns/sync/route.ts` (fail-closed until binding storage)
- `src/app/api/cron/enforce-spend/route.ts` (scheduled binding-aware pause)
- `src/lib/campaign/spend-enforce.ts` (user-triggered binding-aware pause)
- `tests/meta-connect-w2-cron-binding.test.ts` (new)
- `tests/audit-spend-enforce.test.ts` (updated binding-aware fixtures/regressions)
- Removed: `tests/meta-connect-w2-plan-separation.test.ts` (replaced by more comprehensive plan-validation)

## 3. Exports/routes delivered and consumers

- `src/lib/campaign/connect-contracts.ts`: `DraftDTO`, `ReviewDTO`,
  `OperationDTO`, `DraftInput`, `PlanRequest`, `CreateCampaignRequest`, and
  `campaignActivationPatchSchema` for Worker 3 and campaign routes. Strict
  Zod schemas validated by comprehensive offline tests.
- `src/lib/campaign/preflight.ts`: injected `runPreflight` and canonical review
  payload builder plus recursive canonicalization and stale-review freshness
  checks; unresolved geography never broadens to nationwide.
- `src/lib/campaign/preflight-service.ts`: injected orchestration port that
  checks owned/non-expired draft and requested version before loading exact
  creatives, form, connection, and geography data.
- `src/lib/campaign/binding.ts`: pure original account/Page/generation guard;
  unmapped old rows, account switches, disconnected connections, and reconnect
  generation changes become explicit blockers.
- `src/lib/campaign/draft-store.ts`: typed draft lifecycle policy for ownership,
  seven-day expiry, active-draft limit, and optimistic version updates.
- `src/lib/campaign/operation-store.ts`: typed durable claim/reclaim/race port and
  browser-safe operation DTO projection.
- `src/lib/campaign/operations.ts`: injected claim/replay/conflict/checkpoint/
  reconciliation state transitions plus an injected restartable phase executor;
  no in-memory queue or unattended executor is implied.
- Worker 1's C0 connection contracts remain read-only. `withMetaConnection` and
  the consolidated campaign DB/type/RPC contracts now exist and are used by the
  runtime campaign handlers.
- The existing activation route consumes `campaignActivationPatchSchema`; active
  requests without a 64-character confirmation digest and generation are rejected.

## 4. Comprehensive offline test suite (W2-T01 through W2-T10)

**Test files and scope:**

1. `meta-connect-w2-contracts.test.ts`: 3 tests
   - Schema validation (strict fields, no extra properties)
   - Incomplete drafts allowed (preflight gates completeness)
   - Activation requires digest + generation

2. `meta-connect-w2-safety.test.ts`: 5 tests (W2-T01 plus authorized paused-create, capability, and input boundaries)
   - Foreign business rejected before metaClientForBusiness call
   - Cross-brand creative rejected before metaClientForBusiness call
  - Existing paused-create path uses `withMetaConnection` and blocks unresolved
    geography before `createLeadCampaign`
  - Unknown paused-create capability and malformed inputs stop before provider mutation

3. `meta-connect-w2-safety-core.test.ts`: 6 tests
   - Preflight blocks unresolved geography
   - Preflight blocks missing form/capability/creative
   - Operation claim → replay on terminal state
   - Operation conflict on changed payload
   - External ID checkpointing and reconciliation
   - Stale draft version detection

4. `meta-connect-w2-plan-validation.test.ts`: 11 tests (W2-T02 through W2-T05)
   - W2-T04: Valid draft passes schema without Meta calls
   - W2-T02: Rejects missing/null form (preflight gate)
   - W2-T03: Rejects negative and oversized budgets without Meta calls
   - Invalid creative IDs: Rejects non-UUID formats
   - W2-T05: Allows partial targeting (completion at preflight)
   - Schema requirements validation
   - Mode support (manual and guided)

5. `meta-connect-w2-operations-comprehensive.test.ts`: 16 tests (W2-T06 through W2-T10 plus W2-T12 pure lease behavior)
   - W2-T06: Duplicate create replays; conflicting payload rejected (409)
   - W2-T06: Cross-business operation rejected with conflict decision
   - W2-T07: Timeout after creation retains external IDs
   - W2-T07: Blind retry on timeout rejected (must reconcile)
   - W2-T08: DB save failure marks needs_reconciliation with known IDs
   - W2-T08: External IDs preserved across all state transitions
   - W2-T09: Campaign binding mismatch detected (different adaccount/page)
   - W2-T10: Forged cross-business context rejected at claim time
   - W2-T10: Secrets never leaked in sanitizedError
   - W2-T05: Draft version mismatch renders operation stale
   - W2-T05: Connection generation mismatch renders operation stale
   - W2-T12: Active lease returns busy for second worker
   - W2-T12: Exactly one new lease holder after expiry
   - W2-T12: Connection generation changes conflict, not reclaim

6. `meta-connect-w2-oauth-activation.test.ts`: 2 tests (W2-T11)
   - Successful OAuth callback stores token/discovery but never creates or activates campaigns
   - OAuth provider cancellation redirects safely with zero campaign calls

7. `src/lib/campaign/planner-draft.ts`: pure W2-04 conversion core
   - Validates planner output as untrusted input
   - Keeps only known approved creative IDs
   - Requires selected lead form to exist in injected form IDs
   - Rejects bad budgets instead of clamping them
   - Maps only already-known locations without Meta calls

8. `meta-connect-w2-draft-store.test.ts`: 10 tests (W2-02)
  - Version-one draft creation and bounded seven-day expiry
  - Business ownership rejection before repository access
  - Active draft limit enforcement
  - Expired reads return not found without input leakage
  - Optimistic update increments version
  - Stale tab cannot overwrite newer version
  - Atomic repository version miss becomes conflict
  - Migration contract: composite tenant consistency and atomic draft update
  - Migration contract: durable operation claim/checkpoint/finish functions

9. `meta-connect-w2-preflight-service.test.ts`: 4 tests (W2-03/W2-05)
  - Loads exact owned draft inputs into pure preflight
  - Stale version stops before provider-dependent loaders
  - Other-owner draft stops before provider-dependent loaders
  - Expired draft stops before provider-dependent loaders

10. `meta-connect-w2-binding.test.ts`: 5 tests (W2-06)
   - Bound campaign returns original binding and generation
   - Old rows without trustworthy binding are blocked
   - Account/Page switches are blocked
   - Reconnect generation changes are blocked
   - Disconnected connection is blocked

11. `meta-connect-w2-operation-store.test.ts`: 3 tests (W2-05)
  - Persists a new claim and projects a safe DTO
  - Reclaims an expired operation through the repository port
  - Returns the latest busy decision when an atomic race loses

12. `meta-connect-w2-executor.test.ts`: 7 tests (W2-05/W2-T08)
  - Ordered campaign/adset/creative/ad checkpoints
  - Resume from persisted phase without rerunning campaign
  - Ambiguous failure enters reconciliation with known IDs
  - Known pre-transmission failure becomes failed
  - Lease loss stops further phases
  - Final persistence failure never reports success
  - Terminal operation replay performs no external step

13. `meta-connect-w2-planner-route.test.ts`: 1 test (W2-T04)
  - Completed planner proposal persists a DraftDTO with zero `createLeadCampaign` calls

14. `meta-connect-w2-refresh-route.test.ts`: 2 tests (W2-06)
  - Insight reads use stored account/Page/generation through `read_insights`
  - Old rows without binding are blocked before provider access

15. `meta-connect-w2-leads-sync-route.test.ts`: 1 test (W2-06)
  - Current-connection lead reads use the authorized `read_leads` boundary

16. `meta-connect-w2-activation-route.test.ts`: 4 tests (W2-04/W2-06)
  - Stale activation generation blocked before provider access
  - Pause remains compatible
  - Unknown activation capability blocked
  - Delete uses stored account/Page/generation binding

17. `meta-connect-w2-cron-binding.test.ts`: 2 tests (W2-06)
  - Scheduled auto-pause uses verified scheduler and original binding
  - Unmapped campaign is skipped without provider access

18. `meta-connect-w2-draft-routes.test.ts`: 3 tests (W2-02)
  - POST creates a versioned owned DraftDTO
  - GET hides expired drafts
  - PUT returns atomic optimistic conflict

19. `meta-connect-w2-preflight-route.test.ts`: 2 tests (W2-03)
  - Review envelope uses authorized current connection and no legacy resolver
  - Stale draft version blocks before provider-dependent loaders

20. `meta-connect-w2-operation-route.test.ts`: 1 test (W2-05)
  - Reconciliation DTO does not expose raw errors or external IDs

21. `meta-connect-w2-create-route.test.ts`: 4 tests (W2-04/W2-05)
  - Durable claim/checkpoint/bound paused save/finish
  - Terminal idempotency replay without Meta access
  - Stale draft rejection before claim
  - Lease-loss reconciliation without false success

**Test results:**
```
Prior full suite: npm run test -- --pool=threads --maxWorkers=2
  Test Files  91 passed | 1 skipped (92)
  Tests       728 passed | 1 skipped (729)
  Duration    94.31s

Latest full suite after runtime campaign integration:
  Test Files  108 passed | 1 skipped (109)
  Tests       822 passed | 1 skipped (823)

Current Worker 2 tests only:
  Test Files  21 passed plus MetaClient coverage
  Tests       102 passed
  Typecheck:  pass
  Lint:       pass
```

All Worker 2 pure logic, runtime handlers, durable create flow, and consumer
guards are validated. The full repository typecheck, lint, and diff checks pass.

## 5. Not run, external blockers, mocked versus real evidence

- No live Meta or paid provider calls made.
- No database migration applied and no production database evidence collected.
- Worker 1 connection authorization and `withMetaConnection` are available, and
  the orchestrator has consolidated the campaign DB tables, binding columns, and
  RPC/type contracts into the authoritative schema/types.
- Real isolated DB operation/lease concurrency tests not run; no approved local DB
  executor available in this worker slice.
- Campaign sync remains intentionally disabled until binding storage is typed.
  Create, lead-form, refresh, status/delete, lead-sync, cron, and spend-enforcement
  paths now use the authorized/binding-aware boundary where their current schemas
  permit it.
- Draft/preflight/operation HTTP persistence routes are wired. The planner now
  persists an owned DraftDTO and never creates a Meta object.
- Durable create is wired through draft -> preflight -> idempotent operation claim
  -> paused Meta mutation -> external-ID checkpoints -> bound local campaign save
  -> fenced operation finish. Terminal keys replay and unknown outcomes reconcile.
- W2-06 consumer inspection is documented in
  `docs/meta-connect-workers/HANDOFF-2-CONSUMER-INSPECTION.md`.
- Unsafe internal traffic-runner campaign creation is disabled in
  `src/app/api/internal/meta-traffic/route.ts`; the read-only traffic checks remain
  allowlisted as before.
- `GET /api/campaigns/lead-forms` now uses `requireOwnedBusiness` and
  `withMetaConnection({ purpose: "create_paused" })`; it no longer calls the
  legacy credential resolver.
- Existing `POST /api/campaigns/create` now requires the frozen durable request,
  rejects non-INR/invalid capability/incomplete geography, and persists original
  account/Page/generation binding on success.
- Active `PATCH /api/campaigns/[id]` now uses the authorized connection boundary
  with the reviewed generation and fails closed when activation capability is
  unknown or blocked; pause remains backward-compatible pending stored binding
  columns.
- Guided `POST /api/campaigns/plan` no longer creates Meta objects. It validates
  planner output into `DraftInput` and returns a safe 503 until durable draft
  persistence is typed and wired; this intentionally prevents a false “created”
  response or hidden Graph mutation.
- Refresh, status/pause/delete, and lead sync now block old unmapped rows or use
  the stored binding/current authorized connection as appropriate. The cron and
  spend-enforcement paths remain pending scheduled/binding-aware integration.
- Campaign sync, cron spend enforcement, and user-triggered spend auto-pause still
  use legacy credentials. They require the consolidated campaign binding columns
  plus a scheduled/binding-aware execution adapter; they were intentionally not
  converted with an unsafe current-workspace fallback.
- `MetaClient.createLeadCampaign` accepts an additive `onCheckpoint` callback and
  emits each campaign, uploaded image hash, ad set, creative, and ad ID as soon
  as the provider returns it. Existing callers remain compatible.

## 6. Migration order/config variable names only

- Worker 2 supplies `db/migrations/20260907_campaign_connect.sql` for campaign
  drafts, operations, and binding columns (NOT APPLIED).
- Table `campaign_drafts`: ownership, version control, expiry, RLS by business
  owner.
- Table `campaign_operations`: lease-based concurrency, external ID checkpointing,
  reconciliation state, RLS by business owner.
- Columns added to `campaigns`: meta_ad_account_id, meta_page_id,
  meta_connection_generation for campaign binding.
- Migration now includes an idempotent atomic draft-version update function plus
  tenant/generation-fenced operation claim, checkpoint, and finish functions with
  restricted `authenticated`/`service_role` execute grants.
- `campaign_operations` now stores the resulting local `campaign_id` and requires
  a non-null draft reference; operation claim/checkpoint/finish functions fence
  on business and connection generation.
- `src/lib/types.ts` and `db/schema.sql` are Worker 1-owned and will not be edited
  by Worker 2.

## 7. Remaining integration work with owner

- **Worker 1**: Finish database type consolidation for Worker 2's migration
  delta. `withMetaConnection` exists, but route wiring still needs typed
  `campaign_drafts`, `campaign_operations`, and campaign binding columns.
- **Worker 1**: Consolidate `db/migrations/20260907_campaign_connect.sql` with
  Worker 1's connection migration and updated database types; migration not
  applied by Worker 2.
- **Worker 3**: Consume campaign DTO schemas, draft envelopes, and activation
  PATCH schema after C0 agreement.
- **Worker 2**: Wire pure preflight and operation cores into durable DB-backed
  draft/create/operation routes once Worker 1 publishes the consolidated DB
  types. The server connection authorization export now exists.
- **Coordinator**: Resolve Worker 1 concurrent changes (duplicate supabase in
  accounts route); run full build/typecheck/lint/DB gates.

## 8. Explicit release boundary

No live migration, paid calls, commit/push, deployment, live account creation, or
live campaign creation has been performed by Worker 2 in this or prior session.
