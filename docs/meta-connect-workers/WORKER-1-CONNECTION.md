# Worker 1: Secure Connection Backend

Read [coordination](README.md), [contracts](CONTRACTS.md), and parent sections
2-7, 8-9, 11-14 of [the plan](../META-INSTANT-CONNECT-PLAN.md).
Own the backend that establishes which business may use which Meta credentials.
Do not implement campaign UI, campaign mutations, or edit the shared campaign client.

## Before editing

1. Read AGENTS.md and relevant installed Next docs for route handlers, cookies,
   server-only code and async request APIs. Inspect package/test conventions.
2. Record baseline and inspect existing OAuth, credentials, env, schema, migrations,
   Supabase server/admin and their nearby tests. A previous migration may overlap
   credential-hardening work; reconcile the source rather than adding duplicate SQL.
3. Check the ownership map. Record exact new files and C0 exports in HANDOFF-1.
   Never inspect or print sibling-repository secrets, production tokens or `.env.local`.
4. First falsifiable test: incomplete/expired/wrong-business credentials must not
   return environment credentials. Add a focused regression and make it pass.

## Ordered tasks

### W1-01: Publish contracts first

- Implement strict v1 safe schemas, exported DTOs and server boundary signatures.
- Add fixture/schema tests in `tests/meta-connect-w1-contracts.test.ts`.
- Preserve MetaClient exports; publish an interface dependency to Worker 2, not
  an edit in its client file. No temporary route that returns ready=true.
- C0 report lists exact export names, route envelopes, cookie approach, and
  unavailable dependencies. Publish early so other workers can replace fixture types.

### W1-02: Authorize and fail closed

- Session-derived owner check for explicit business ID before all private reads
  and Graph calls. Never use oldest/primary business for an explicit operation.
- Implement authorized connection executor, separate trusted scheduled-job context,
  typed unavailable/reauth/conflict errors, and original-account binding checks.
- Remove environment fallback for tenant credentials; do not preserve it behind
  a default-on flag. Migration of a named single tenant is a manual approved step.
- Inventory existing resolver consumers and notify Worker 2 of signature/call-path
  impact. Keep read compatibility only if it cannot bypass authorization.

### W1-03: Private encrypted schema and migration

- Translate illustrative DDL into a reviewed migration: constraints, indexes,
  tenant FKs, revoke/default privileges, nonexposed private schema, narrow RPCs.
- Implement AES-256-GCM with Node crypto, random nonce, versioned AAD, key ring,
  startup/key validation and audited rotation. Tokens never enter safe DTOs.
- Schema must allow candidate reconnect token plus committed token. Transaction
  swaps selected assets/token only when generation/revision still match.
- Implement a dry-run-by-default backfill command requiring an explicit local/test
  target allowlist. Do not execute a live backfill. Never log plaintext or ciphertext
  dumps; counts/row IDs and safe error categories suffice.
- Document expand/backfill/restrict/cutover/drop ordering, old backup retention and
  secure rollback. Check deletion/FK order before removing token rows.
- After receiving Worker 2 migration, incorporate its definitions into consolidated
  schema/types. Do not edit its migration; report any defect back to its owner.

### W1-04: OAuth attempt lifecycle

- POST start: strict body/origin/CSRF/rate limit, current owner, validated saved
  intent, crypto-random state hashed at rest, expiring attempt, expected generation.
- Browser-binding design must support simultaneous tabs. Use an existing valid
  browser binding or attempt-scoped bindings, not one overwritten cookie per start.
  Cookies HttpOnly/Secure/SameSite=Lax; document local HTTP test handling.
- Callback: require state even on provider error; validate state hash, binding,
  user, business, expiry; claim once atomically before code exchange. Duplicate
  callback may show previous status but cannot repeat exchange or commit.
- Server exchange/token validation checks app/subject/granted scopes/assets and
  actual expiry. Never save requested scopes as proof of granted permissions.
- Persist encrypted pending result; bound discovery within request budget or
  persist explicit retriable stages. No `void asyncWork()` after returning.
- Clean completion redirect; safe completion status only. Host/origin from server
  config, not request-supplied arbitrary host. Validate actual cookie/CSP behavior
  with Worker 3 later, without weakening global headers.
- Retry read/discovery failures safely; code-exchange failure requires a new
  attempt. Expired, cancelled and fenced attempts cannot later connect.

### W1-05: Discovery and deterministic selection

- Independent typed discovery adapter: supported Graph version, timeout, abort,
  size limits, cursor pagination, deduplication, rate-limit backoff, redacted errors.
- Verify account status, Page tasks, business relationships, granted asset scope,
  currency/timezone. Missing fields -> unknown, not eligible.
- Complete single compatible pair may auto-link. Partial snapshot never does.
  Ambiguous/shared/personal relationships require confirmation with verified access;
  name similarity alone never establishes compatibility or authority.
- Recheck selected pair on POST select. Reject stale revision and unlisted pair.
  Existing selection lost during reconnect -> explicit replacement confirmation.
- Commit only after durable save; audit safe IDs, reason, request ID, no grants
  containing access tokens. Selection changed after discovery fences old workers.

### W1-06: Status, recovery, lifecycle and guided provisioning

- Implement all v1 connection HTTP routes and safe error/capability DTOs.
- Add safe official Meta action URL registry; no raw provider URL/message passthrough.
- Recheck is read-only validation; disconnect clears authority and invalidates jobs
  but does not claim to pause already-running ads. Notify Worker 2 of generation
  invalidation semantics so its operation claims can enforce them.
- Verify/decode current documented signed-request format for deauthorization and
  deletion callbacks; replay-safe subject invalidation and cleanup receipts.
  If official contract cannot be verified, report the blocker, do not invent one.
- Provisioning v1 returns guided setup/admin-required only. Record evidence needed
  for optional adapter: permission, endpoint, customer portfolio, fields, billing,
  currency, timezone, executor and reconciliation. Never make a live creation call.
- Add feature-disabled behavior for unavailable configuration without misreporting
  existing business records as absent. No public Meta login button that always fails.

## Required tests and proof

| Test ID | Setup | Must assert |
| --- | --- | --- |
| W1-T01 | Missing/expired/partial row with env token set | No fallback client or Graph request |
| W1-T02 | Owner A versus B; same owner two businesses | Secret/attempt/status cannot cross business |
| W1-T03 | Tamper ciphertext, tag, tenant AAD, key ID | Decrypt fails closed; no token in output |
| W1-T04 | State replay, wrong cookie/user, expired/future issue time, two tabs | Only valid bound attempt can exchange once |
| W1-T05 | Token has fewer grants, wrong app, invalid data access | Never marks requested capabilities available |
| W1-T06 | 201+ assets, partial page, duplicate, unrelated pair | Complete pagination; no unsafe auto-link |
| W1-T07 | Reconnect versus disconnect/new selection race | Generation fencing; old grant not overwritten |
| W1-T08 | DB write fails after exchange/discovery | No connected success DTO |
| W1-T09 | anon/authenticated real local DB roles | Secret SELECT/INSERT/UPDATE/RPC denied |
| W1-T10 | Guided creation with missing external proof | No account-create request ever issued |

Mocks prove orchestration, not RLS. Run real DB role tests only on an explicitly
isolated local/test database. Without it mark W1-T09 blocked and keep release blocked.
Include token/code/state redaction assertions and deny-by-default network interception.

## Done versus blocked

Done means owned code and focused tests pass, no unowned edits, C0 exports match,
and HANDOFF-1 has actual evidence. Full feature release also needs real DB/callback
validation, Worker 2 draft schema and Worker 3 browser integration. Report these
separately; never label a mocked OAuth path production verified.