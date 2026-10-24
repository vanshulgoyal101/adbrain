# Release Workflow

AdBrain's deployment reference: `main` is production and the only long-lived branch;
Vercel deploys it automatically. Dated release receipts live in git history and the
PRs, not here. Last verified: 2026-10-23.

## Startup Fast Path

The release process ([AGENTS.md](../AGENTS.md)).

1. Branch from current `origin/main` in an isolated worktree under
   `adbrain-wt/`, build a small complete slice and open a PR to `main` with
   auto-merge enabled. The branch need not be up to date with `main`.
2. Required checks are `build`, `test`, `core` and `secrets`
   ([ci.yml](../.github/workflows/ci.yml)); `audit` and `docs` also run but do
   not block. A change to generation, validation, prompts, models, timeouts, the
   planner, Meta calls or CSP adds or updates a `test:core` test with recorded real
   responses. Update the matching doc in the same PR.
3. Low-risk PRs (no migration, money, tenant/auth or config change) merge
   automatically on green CI. QA reviews high-risk changes only; there is no
   coordinator or second-QA approval gate.
4. Vercel deploys `main` only ([vercel.json](../vercel.json)). The
   [production guard](#production-guard) runs `npm run smoke:core` after each
   Production deployment and rolls back automatically on failure. The author
   also checks the change in production. If the core breaks, roll back first and
   debug second; a non-core change that breaks the core is reverted.
5. DevOps owns migrations, money and tenant releases, production settings,
   secrets and rollback. Never force-push or run `npm run db:push` against
   production. Charges, refunds and ad spend need explicit financial authorization.

## Enforced Controls and Limits

| Control | Verified setting |
| --- | --- |
| CI triggers | Pushes and PRs targeting `main` |
| CI jobs (current source) | `build`; `lint` (lint + typecheck), `unit` (vitest in 3 shards) and `metadb` (real PostgreSQL), aggregated by the required `test` check; `core` (`test:core`, generation holds); non-blocking `audit` and `docs`; all on Node 24 |
| Secret job | Gitleaks with repository configuration |
| Main protection | PR required; required checks `build`, `test`, `core` and `secrets`; branches need not be up to date |
| Administrators | Protection applies to admins too |
| Approvals | Zero required approvals for the solo-owner workflow; CI is still required |
| Force pushes / branch deletion | Disabled on `main` |
| Vercel Git deployment (current source) | `**: false`, `main: true` |

These controls are split between [.github/workflows/ci.yml](../.github/workflows/ci.yml),
[vercel.json](../vercel.json), and GitHub branch-protection settings. Direct CLI
deployments are not blocked by Git branch protection; never use `vercel --prod` to
skip review.

**The corrected checked-in wildcard disables slash-containing Git branches.** Earlier
single-star configurations did not.
Before pushing a feature or release branch, inspect effective remote deployment
rules and preview credentials rather than relying on an old receipt or local JSON
alone. Do not assume a preview URL implies a preview database, harmless cron
behavior, or safe provider credentials. Re-enabling previews is a separate
environment change; direct CLI deployments remain a separate path.

Gitleaks PR scans need the built-in `GITHUB_TOKEN`. The secrets job has read-only
contents and pull-request permissions; comments are disabled. Do not remove the
token or grant write access to fix a read-only scan. The exact `operation-key-1`
allowlist entry is a synthetic idempotency test value, not a credential. Do not
exclude entire test directories or suppress uninvestigated findings.

## Database and Credential Safety

- `.env.local` points at production Supabase, not the local QA database. The
  production project reference is `kmzuxrvfrwwpwmoovwcp`; verify the actual target
  before every database command. Never print secrets to establish that identity.
- `npm run db:push` now rejects non-loopback targets. It is a full-schema tool
   for disposable local databases, not a production migration command. A local
   tunnel can still point at a remote database; verify what is behind the address.
- `npm run db:migrate -- --migration <filename.sql>` previews one migration and
   its SHA-256 without connecting. Applying requires `--apply`, explicit `PGHOST`,
   `PGDATABASE`, `PGUSER`, a verified port (`PGPORT` defaults to 5432), and a
   securely supplied password. Remote targets
   additionally require `--target 'host:port/database@user'` matching exactly.
   Remote TLS certificate verification is mandatory; use `PGSSLROOTCERT` when needed.
- The runner serializes migrations under a transaction advisory lock and records
   filename/checksum in `private.schema_migrations`. An identical applied file is
   skipped; checksum drift fails. Failed SQL rolls back with no ledger entry.
   Historical migrations predate this ledger: never replay the directory or assume
   an absent ledger entry means a historical migration has not run. Inspect deployed
   state and apply only the individually reviewed incremental migration.
- Review migrations against existing data, test fresh and upgrade paths, and
  define backup/restore, compatibility, and sequencing before applying remotely.
- **Add a migration (#227):** add only `db/migrations/<yyyymmdd>_<name>.sql` plus
  its own checks. Do not edit `db/schema.sql` (frozen base) or
  `db/schema.base-migrations.txt`. `node scripts/build-schema.mjs` prints the full
  fresh-install schema: the base plus every migration not in that list, in
  filename order, with its exact text. `npm run db:push`, `npm run test:meta-db`
  and the schema tests all use it, so two migration PRs never conflict. Name a
  migration so it sorts after the ones it depends on.
- **Supabase advisors (#359):** run `node scripts/advisors.mjs` before and after
  every migration release. It reads the production security and performance
  advisors (read-only) and exits 1 on any WARN or ERROR outside its reviewed
  `ACCEPTED` list. A new finding blocks the release until it is fixed or accepted
  in that list with a reason, through a PR.
- **Release a money or migration PR (#228, DevOps):**
  `node scripts/release.mjs --pr <n> --dry-run`, then the same without `--dry-run`.
  Preflight is read-only: the PR targets `main` without conflicts, the required
  checks are green on its head, the latest QA verdict naming that head approves it
  and names each new migration's sha256, and the PR only adds migrations. A PR with
  a migration or money code (payments, spend, activation or budget) also needs the
  CTO (#259): the latest `CTO review of <sha>: **approved**` of that head, or of an
  earlier head whose patch against main has the same `git patch-id`. The
  release then dry-runs each pending migration (rolled back), applies it with its
  ledger row through the Management API (same lock, timeouts and checksum guard as
  the runner), reloads the PostgREST schema, merges with `--match-head-commit <full
  sha>` and waits for the production guard, following a newer production commit
  when it contains the merge. It prints a receipt for the issue. `--dry-run` stops
  before the apply and the merge. On any failure it stops and prints the recovery
  step; after a failed apply it reads the ledger and active sessions first and
  never resends the SQL. Rerunning skips migrations already in the ledger.
- The local campaign hardening changes require the reporting-identity migration
   before the new web code, and the worker migration before enabling worker mode.
   See [worker rollout](OPERATIONS.md#campaign-worker-rollout). Neither new migration
   nor a worker deployment is authorized merely by publishing code.
- Credential backfills and encryption-key changes require explicit planning.
  Do not replace an encryption key without preserving access to existing tokens.
- Local QA uses the existing `adbrain-qa` Colima profile and
  [scripts/local-meta-qa.mjs](../scripts/local-meta-qa.mjs). Its launcher
  asserts loopback Supabase targets and isolates provider configuration. Plain
  `npm run dev` does not itself provide that isolation. Do not create paid staging
  resources or reuse production credentials to bypass the lack of free staging.
- Real Meta consent requires the user in the browser. Never collect passwords or
  tokens in chat. Connection verification must not create or activate campaigns.

## Rollback and Incident Handling

1. Stop further promotions or mutations and identify the exact failing deployment
   and affected workflow. Preserve logs without exposing credentials.
2. Identify the last known-good deployment and check its compatibility with the
   current database and encrypted credentials. Code rollback does not undo data.
3. Prefer a reviewed revert PR with required checks for a code regression. If an
   urgent deployment rollback is explicitly approved, verify the exact target and
   record the action, then reconcile Git so the next push cannot reintroduce it.
4. Do not force-reset `main`, run destructive down migrations, or restore a
   database as an improvised code rollback. Data recovery needs its own plan.
5. Verify the affected workflow after recovery and record the cause and evidence.

### Production guard

[`production-guard.yml`](../.github/workflows/production-guard.yml) runs without
anyone watching (owner-approved automatic rollback, #111):

- **After each successful Production deployment** it waits until
  `adbrain.vanshul.com` serves that commit, then runs
  `npm run smoke:core`, which views five pages read-only and then prepares one campaign review without sending it (one retry after 60 s). If the smoke still fails, it rolls
  production back to the newest earlier READY production deployment and opens a
  `core` `bug` issue with the failing step.
- **Daily at 03:30 UTC** it runs the same smoke and opens an issue on failure
  (no rollback).
- **After each push to `main`, and every 15 minutes if GitHub fires the schedule**
  [`production-drift.yml`](../.github/workflows/production-drift.yml) waits until
  15 minutes after main HEAD landed, then fails and opens one
  `Production is not main HEAD` issue if that commit is not live. A run whose
  commit is no longer main HEAD passes and leaves the check to the newer run.

Every step is bounded below the 45-minute job limit, because a cancelled job
opens no issue (#210). `playwright install --with-deps` gets 8 minutes; the
Ubuntu apt mirror has stalled for 11-15 minutes. After that the guard installs
Chromium without OS packages and still runs the smoke, but a failure then only
opens the issue and does not roll back. If the browser install also fails, the
issue says "smoke did not run". Each smoke attempt gets 10 minutes; a hang
counts as a FAIL.

It needs repository secrets `SMOKE_EMAIL`, `SMOKE_PASSWORD` and `VERCEL_TOKEN`.
Without `VERCEL_TOKEN`, the rollback, the wait-for-commit step and the drift
check are skipped. Steps run in `bash` with pipefail, so `| tee` cannot turn a
failed smoke green (#153). To prove that, run the workflow manually with
`force_fail`: it must end red, without a rollback or an issue.
The rollback drill input `drill` forces the same FAIL, then really rolls
production back and opens a `[DRILL]` core bug; restore with the recovery steps
below.

Recovery after an automatic rollback: Vercel stops promoting new production
deployments until one is promoted manually. Fix forward or revert through a PR.
When the fixed commit's deployment is READY, run
`npx --yes vercel@60.1.3 promote <deployment-url> --scope vanshul-goyals-projects`,
then rerun the workflow with `workflow_dispatch` and close the issue.
