# Worker 2 Handoff

## 1. Baseline commit, contract version, completed task IDs

- Baseline: `d8d7890` (`Verify displayed preview bytes with bounded comparisons`).
- Contract: Meta Instant Connect v1, C0 proposed contract.
- Completed task IDs: W2-01 initial C0 contracts; W2-03 pure preflight core;
  W2-05 pure operation decision/checkpoint core; W2-T01 initial regression;
  migration delta supplied for W2-02/W2-06.
- Concurrent paths observed and left untouched: `docs/ROADMAP.md`,
  `docs/META-INSTANT-CONNECT-PLAN.md`, `docs/meta-connect-workers/**`,
  `src/lib/meta/connect-contracts.ts`, and `tests/meta-connect-w1-contracts.test.ts`.

## 2. Exact changed paths

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


## 3. Exports/routes delivered and consumers

- `src/lib/campaign/connect-contracts.ts`: `DraftDTO`, `ReviewDTO`,
  `OperationDTO`, `DraftInput`, `PlanRequest`, `CreateCampaignRequest`, and
  `campaignActivationPatchSchema` for Worker 3 and campaign routes.
- `src/lib/campaign/preflight.ts`: injected `runPreflight` and canonical review
  payload builder; unresolved geography never broadens to nationwide.
- `src/lib/campaign/operations.ts`: injected claim/replay/conflict/checkpoint/
  reconciliation state transitions; no in-memory executor is implied.
- Worker 1's pending C0 connection contracts remain read-only. Runtime route
  integration with `withMetaConnection` is pending that server-only export.
- The existing activation route consumes `campaignActivationPatchSchema`; active
  requests without a 64-character confirmation digest and generation are rejected.

## 4. Test commands and exact outcomes

- Baseline inspection: `git status --short && git log -3 --oneline`; baseline is
  `d8d7890` with concurrent untracked Worker 1 files left untouched.
- `npm run test -- --pool=threads --maxWorkers=2 tests/meta-connect-w2-safety.test.ts`:
  1 file, 2 tests passed.
- `npm run test -- --pool=threads --maxWorkers=2 tests/meta-connect-w2-safety-core.test.ts tests/meta-connect-w2-contracts.test.ts tests/meta-connect-w2-safety.test.ts`:
  3 files, 9 tests passed.
- W2-T01 now rejects foreign business and cross-brand creative before
  `metaClientForBusiness`; provider call count is zero.
- `npm run test -- --pool=threads --maxWorkers=2 tests/meta-connect-w2-contracts.test.ts tests/meta-connect-w2-safety.test.ts tests/meta-connect-w2-safety-core.test.ts tests/api-contract.test.ts tests/meta-client.test.ts`:
  5 files, 20 tests passed.
- `npm run lint`: 0 errors; one concurrent Worker 3 warning for an unused
  `ApiResult` import in `src/lib/meta-connect-ui/client.ts`.
- `git diff --check`: passed.
- `npm run typecheck`: blocked by concurrent Worker 1 changes in
  `src/app/api/meta/accounts/route.ts` (duplicate `supabase` declaration).

## 5. Not run, external blockers, mocked versus real evidence

- No live Meta or paid provider calls made.
- No database migration applied and no production database evidence collected.
- Worker 1 connection authorization and `withMetaConnection` exports are not yet
  available in this checkout; dependent route integration remains pending.
- Real isolated DB operation/lease tests are not run; no approved local DB
  executor is available in this worker slice.
- Existing create and planner routes currently use the legacy credential resolver.
- Planner and draft/operation HTTP persistence routes remain integration work:
  the existing planner still performs legacy Meta reads/mutation and must be
  converted once consolidated draft storage/types and the authorization port are
  available. No fake draft persistence was added.

## 6. Migration order/config variable names only

- Worker 2 will supply an ordered campaign-connect migration for drafts,
  campaign operations, and campaign binding columns to Worker 1.
- `src/lib/types.ts` and `db/schema.sql` are Worker 1-owned and will not be edited.
- No secret values or new configuration variables are introduced at this stage.

## 7. Remaining integration work with owner and reproducible case

- Worker 1: publish the server-only authorized business/connection executor and
  safe connection DTO integration. Reproducible dependency: preflight and create
  need `withMetaConnection(..., { purpose: "create_paused", binding })`.
- Worker 1: consolidate `db/migrations/20260907_campaign_connect.sql` and
  generated/manual database types; the migration was not applied.
- Worker 3: consume campaign DTO schemas, draft envelopes, and activation PATCH
  schema after C0 agreement.
- Worker 2: wire the pure preflight and operation cores into durable DB-backed
  draft/create/operation routes after Worker 1 publishes the authorization port.
- Coordinator: integrate shared contract revisions and run serial full build,
  typecheck, lint, and database concurrency gates.

## 8. Explicit release boundary

No live migration, paid calls, commit/push, deployment, live account creation, or
live campaign creation has been performed by Worker 2.