# Worker 1 Handoff

## 1. Baseline and ownership

- Baseline commit: `d8d789071c74a7a93b1f270a0c4f119aff79aa34`.
- Contract version: Integration Contracts v1.
- Scope: secure Meta connection backend, encrypted credential storage, OAuth
  attempts, discovery, selection, connection/recovery APIs, and guided-only
  provisioning behavior.
- Not owned: campaign client/routes, campaign migrations, React components/pages,
  package/config files, live migrations, provider mutations, commits, or deployment.

## 2. Implemented work

- **Contracts and authorization:** browser-safe Zod DTOs; explicit session-derived
  business ownership; server-only Meta execution boundary; generation and original
  account/Page binding checks; scheduled-job boundary.
- **Credential security:** AES-256-GCM with tenant-bound AAD, random nonce, key ID,
  PostgreSQL `bytea` conversion, fail-closed key/decrypt behavior, and no environment
  credential fallback. Runtime resolution reads only `meta_connections` plus private
  encrypted token RPCs; no application code directly reads `meta_credentials`.
- **Storage boundary:** authoritative schema and controlled migration define private
  token/attempt tables, safe connection metadata, private-schema revocation, pinned
  `SECURITY DEFINER` RPCs, service-role-only execution, and atomic selection commit.
  The old plaintext table is excluded from new schema installs and browser access is
  revoked during controlled migration.
- **Migration tooling:** `scripts/migrate-meta-credentials.mjs` is dry-run by default,
  requires an explicit confirmation for writes, verifies business ownership, encrypts
  legacy tokens, marks migrated connections `reauth_required`, and never prints secrets.
- **OAuth lifecycle:** bounded/future-rejecting signed state, per-attempt browser
  binding cookie, durable one-time claim, server-side token exchange and inspection,
  actual granted permissions/expiry capture, encrypted persistence, clean completion,
  cancellation/failure/retry states, and no raw provider error forwarding.
- **Discovery and selection:** bounded same-host cursor pagination, provider business
  identity/timezone/Page-task capture, explicit shared-business relationship pairs,
  safe candidate DTOs, disabled/currency/timezone blockers, deterministic selection,
  auto-commit only for one complete eligible pair, and explicit selection otherwise.
- **Lifecycle APIs:** contextual start, owner-scoped attempt/status polling, selection,
  retry, generation-fenced recheck, server-only disconnect, and signed Meta
  deauthorization with subject-scoped local revocation. Automated ad-account
  provisioning remains disabled and guided setup is the only fallback.

## 3. Validation evidence

- Worker 1 schema, encrypted storage, resolver, OAuth, discovery, selection and
  contract suite: **55 tests passed**.
- Worker 1-owned lint and diagnostics: pass.
- Static search: no direct `private` schema access or legacy `meta_credentials` reads
  remain in application code or migration tooling.
- `node --check scripts/migrate-meta-credentials.mjs`: pass.
- `git diff --check`: pass.
- Full AdBrain validation now passes: **798 tests passed / 1 skipped**, lint,
  typecheck, production build, and coverage (**798 passed / 1 skipped; 64.26%
  statements, 57.46% branches, 65.00% functions, 65.22% lines**).

## 4. Operational gates still required

- Run isolated Postgres tests for anon/authenticated denial, service-role RPC access,
  tenant separation, generation races, migration counts, encryption/decryption, and
  legacy-table cutover. These tests have not been run.
- This checkout has no `psql`, `postgres`, `pg_isready`, Docker, or Supabase CLI
  available, so isolated database execution is genuinely blocked here; do not
  substitute a mocked repository test for that gate.
- Apply the migration only in a controlled non-production environment after review;
  no migration has been applied by Worker 1.
- Verify the actual Meta app configuration, requested/granted permissions, returned
  `business` fields, Page tasks, Graph version, App Review status, redirect origin,
  and mobile behavior with an approved test account.
- Run a controlled OAuth smoke test. No live OAuth exchange, Meta mutation, paid call,
  commit, push, or deployment was performed.
- The mixed disconnect assertion has been updated to validate the new
  `meta_connections` path; no stale plaintext-delete test remains in the current
  checkout.
- Keep account provisioning disabled until Meta endpoint eligibility, billing owner,
  required fields, durable executor, and unknown-outcome reconciliation are approved.

## 5. Integration notes

- Worker 2 can consume `withMetaConnection`, `ConnectionDTO`, generation fencing, and
  the typed RPC contracts. Its campaign migration still needs coordinator integration
  into the authoritative schema/types.
- Worker 3 consumes only browser-safe DTOs and the owner-scoped status/attempt routes;
  no client component imports server-only accessors.
- The implementation deliberately treats missing relationship evidence, incomplete
  pagination, unknown permissions, unsupported currency, expired tokens, and stale
  generations as blocked or recoverable states rather than success.