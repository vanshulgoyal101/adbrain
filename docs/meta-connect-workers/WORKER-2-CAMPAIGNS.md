# Worker 2: Campaign Safety and Resumable Operations

Read [coordination](README.md), [contracts](CONTRACTS.md), and parent sections
2, 5-8, 10-12 of [the plan](../META-INSTANT-CONNECT-PLAN.md).
Own campaign backend behavior and the existing Meta campaign client, not connection
routes, credentials, shared DB types, or React components.

## Before editing

1. Read AGENTS.md, relevant installed Next route docs, and package/test conventions.
2. Inspect create/plan/activation handlers and client methods that directly mutate
   Meta. Trace just the campaign binding/ownership and cheapest regression test first.
3. Record baseline and files in HANDOFF-2. Start while Worker 1 builds: pure
   preflight/operation functions accept injected ports; tests use local fixtures.
4. First failing check: a foreign-business request makes zero Meta calls and a
   same-owner different-business creative is rejected. Fix the controlling create
   path without editing another worker's credential resolver.

## Ordered tasks

### W2-01: Publish campaign contracts

- Add safe campaign schemas and tests from v1. Freeze plan request compatibility
  and activation PATCH schema after reading existing handlers; publish at C0.
- UI uses DraftDTO/ReviewDTO/OperationDTO; no second `metaReady` flag as authority.
- Map existing typed targeting/budget inputs; reject nonfinite, negative, oversized,
  unsupported values. Draft storage can be incomplete, execution cannot.
- Keep existing MetaClient exports stable for Worker 1. Any required new export
  is additive and covered by tests; no unrelated client refactor.

### W2-02: Saved drafts and DB contract

- Implement private draft storage routes from contract, ownership, optimistic
  versioning, expiry and limits. Version conflict must not overwrite a newer tab.
- Add separate campaign migration with draft/operation definitions and binding
  columns. Give Worker 1 the exact schema/RPC/type delta, migration order and tests.
- Never duplicate `Database`, write `as any` to silence unavailable RPC types, or
  edit consolidated schema. Continue pure logic while integration is pending.
- Draft references are authorized again by connection-start and preflight; a UUID
  is not a capability. Server owns return destination. Goal is bounded text, not
  HTML and not a provider token or full unfiltered chat history.

### W2-03: Shared preflight

- Before any provider read/write, authorize business then fetch every creative
  using both requested IDs and business_id. Reject unavailable IDs explicitly,
  not silently substitute a partial creative set or truncate excess IDs.
- Verify approved state, image/headline, Page/form access, current grant, account
  binding/status, objective eligibility and supported currency.
- Geographic failure, ambiguity or partial resolution is a blocker. Nationwide
  requires an explicitly reviewed intent; no catch-and-default-to-India path.
- Effective budget = per-set budget times actual reviewed set count. Use existing
  money helpers/guardrails, currency rules, finite limits and explicit review.
- Preflight returns a canonical hash of the exact normalized review payload,
  business, draft version, selected assets and connection generation. Store/recompute
  server-side; a browser-provided hash alone is not approval or integrity proof.
- Recheck at execution time. Changed creative, targeting, budget, grant, generation
  or form invalidates review. Unknown billing/capability is never canActivate=true.

### W2-04: Separate planning, paused creation and activation

- AI planner only proposes and saves a draft. Validate LLM output like untrusted
  input. No Graph create in planning, even if the old handler did so.
- Both manual and guided paths call the same preflight and paused-creation service.
- Creation requires explicit reviewed draft/version/hash/generation/idempotency key.
  All created campaign/adset/ad objects are paused where the API permits; test the
  exact request payload status, not just local `campaign.status`.
- Activation remains distinct: fresh preflight, explicit UI confirmation, existing
  spend guards, stored account binding and stale-review rejection. No callback or
  reconnect path activates or resubmits a saved spending action.
- Preserve safe existing pause/delete/status behavior; do not require an activation
  confirmation to pause. Disable only unsafe legacy creation paths, not recovery.

### W2-05: Durable operation and partial-result handling

- Insert/claim a persisted operation before first Meta mutation. Idempotency key
  scoped to business+kind, canonical payload hash, lease and generation fencing.
- Record each external ID as soon as available, not only the final aggregate return.
  Adapt owned MetaClient methods for step-level checkpointing where needed.
- Double click/retry with same key returns same operation; changed payload -> 409.
- Failure before transmission may be retried under policy; timeout after possible
  transmission -> needs_reconciliation. Never rerun the entire create pipeline blindly.
- Lease expiry does not prove no external side effect. Reconcile known IDs before
  retry; absence of reliable provider correlation is a support blocker, not a guess.
- Persisted external orphan remains visible even when local campaign insert fails.
  Compensation is explicit, supported, and audited; do not claim transaction rollback
  deleted external resources or automatically delete ambiguous objects.
- Implement restartable executor logic against persisted jobs with an injected
  transport/clock. No in-memory singleton queue, unawaited background work or polling
  GET that secretly creates ads. If durable hosting executor is unapproved, keep
  unattended execution disabled and document the deployment gate.

### W2-06: Bind all existing campaign consumers

- Create stores exact ad account/Page/generation. Old rows without trustworthy
  mappings remain write-blocked until a verified migration/reconciliation supplies them.
- Inspect owned refresh/report/sync/lead-form/lead-sync/status/delete/cron paths
  for tenant safety and original binding. Changes to default workspace connection
  must not rehome existing campaign operations.
- Use Worker 1 scheduled authorization boundary for cron, no fake user session
  or arbitrary service-role business ID. Preserve Hobby-compatible cron config.
- Internal traffic runner must not bypass new safety rules; disable unsupported
  mutation modes instead of retaining shared environment credentials. Do not run it.
- Keep existing spend limitations honest; do not advertise a hard real-time cap
  based on daily scheduled checks.

## Required tests and proof

| Test ID | Setup | Must assert |
| --- | --- | --- |
| W2-T01 | Foreign business and same-owner other-brand creative | Zero provider calls; explicit rejection |
| W2-T02 | Missing form/grants/currency/geography resolution | Blocked preflight, never broaden targeting |
| W2-T03 | A/B two sets and large/NaN budgets | Correct total and input rejection |
| W2-T04 | Guided planner completes | Draft returned; zero Meta mutation calls |
| W2-T05 | Draft/version/connection changes after review | Stale create/activate rejected |
| W2-T06 | Duplicate create and conflicting payload | Same operation once or 409; no second create |
| W2-T07 | Timeout after campaign/adset creation | Known IDs retained; reconciliation; no blind retry |
| W2-T08 | Final DB save failure and worker restart | Recoverable operation, no false success or orphan loss |
| W2-T09 | Account A campaign; workspace switched to B | Original verified binding or reconnect blocker |
| W2-T10 | Forged job context/other-owner operation/draft | Access denied before secret or provider access |
| W2-T11 | OAuth completes for activation intent | Zero activation until fresh explicit confirmation |
| W2-T12 | Local DB two workers claim same operation | One lease holder; generation/tenant constraints enforced |

Use explicit offline network denial; mock paid LLM and Meta calls. Real local DB
concurrency tests are a separate gate, not satisfied by map-based repository fakes.
Keep migration, executor-host selection and live provider verification marked
blocked where authorization/environment is absent.

## Handoff

Publish HANDOFF-2 with C0 exports, SQL/type delta for Worker 1, API examples for
Worker 3, known legacy call sites, mutation checkpoints, tests and remaining gates.
Do not change Worker 1 files to make a mock integration work. Preserve unowned
changes and explicitly state no live account/campaign creation or deployment.