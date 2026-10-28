# Release Workflow

AdBrain's deployment reference: `main` is production and the only long-lived branch;
Vercel deploys it automatically. Dated release receipts live in git history and the
PRs, not here. Last verified: 2026-10-23.

## Startup Fast Path

The release process ([AGENTS.md](../AGENTS.md)).

1. Branch from current `origin/next` in an isolated worktree under
   `adbrain-wt/`, build a small complete slice and open a PR to `next` with
   auto-merge enabled. The branch need not be up to date. See [Deploy train](#deploy-train).
2. Required checks are `build`, `test`, `core` and `secrets`
   ([ci.yml](../.github/workflows/ci.yml)), plus `core-approval`
   ([core-approval.yml](../.github/workflows/core-approval.yml), #926): a PR that
   touches `src/lib/meta/`, `src/lib/campaign/`, the Meta, campaign, managed,
   payments or spend-limit APIs, money paths or `db/migrations/` stays pending until
   a QA verdict, `Reviewer review of <sha>: **approved**` or `CTO review of <sha>:
   **approved**` names its head (or an earlier head with the same patch). The deploy
   train and a revert labelled `rollback` pass. Hold with `gh pr merge <n>
   --disable-auto`. `audit` and `docs` also run but do not block. A change to generation, validation, prompts, models, timeouts, the
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
- **Code review (#423):** PRs touching high-risk paths (migrations; `src/lib/{meta,payments,managed,supabase,security}`;
  `src/app/api/{auth,payments,meta,spend-limits}`; middleware) get one advisory AI review comment from
  [ai-review.yml](../.github/workflows/ai-review.yml), on open and each push: free Groq
  `openai/gpt-oss-120b` (production's planner uses another model, so it doesn't eat its rate
  limit), $0, secret `GROQ_REVIEW_API_KEY`. The script runs from the base commit, so PR code
  never runs with the key. It never fails or blocks, and a free-tier refusal leaves a 'skipped' note.
  Authors fix real findings in the same PR. (The Copilot ruleset stays disabled: no premium quota.)
  QA and CTO post high-risk verdicts as reviews, not comments:
  `gh pr review <n> --comment --body "QA verdict at <sha>: **approved**. …"` (or
  `CTO review of <sha>: **approved**`). `release.mjs` reads PR reviews and comments alike.
- **Supabase advisors (#359):** run `node scripts/advisors.mjs` before and after
  every migration release. It reads the production security and performance
  advisors (read-only) and exits 1 on any WARN or ERROR outside its reviewed
  `ACCEPTED` list. A new finding blocks the release until it is fixed or accepted
  in that list with a reason, through a PR.
- **Tenant or money PRs without a migration target `next`** (#461): `release.mjs --pr <n>` runs the same
  QA (and, for money paths including `src/lib/managed/`, CTO) checks, merges into `next`, and prints
  a receipt; the next deploy train ships it and smokes it. Migrations still release to `main`.
- **Every migration needs a fresh backup:** `release.mjs` refuses to apply one without a
  successful [database backup](#backups-and-restore) from the last hour (CEO, #884).
- **Release a money or migration PR (#228, DevOps):**
  `node scripts/release.mjs --pr <n> --dry-run`, then the same without `--dry-run`.
  Preflight is read-only: the PR targets `main` without conflicts, the required
  checks are green on its head, the latest QA verdict naming that head (or an earlier
  head with the same `git patch-id` against the base, or the same changed lines in order when a
  merge only moved their context, so a clean merge of `main` needs no re-approval) approves it and names each new migration's sha256, and the PR only adds migrations. A PR with
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

## Deploy train

Vercel Hobby allows 100 production deploys a day, and every push to `main` is one
(#461). So PRs merge into **`next`**, which Vercel doesn't deploy, and
[deploy-train.yml](../.github/workflows/deploy-train.yml) promotes it:
- On every push to `next` (and at :11/:41 as a backup), if `next` has commits `main`
  lacks, it waits until 30 minutes after the last train, then requires build, test, core
  and secrets green on `next`'s exact commit (CI runs on pushes to `next`). Then it opens
  and merges a `next → main` PR with a merge commit. That's at most 48 deploys a day;
  each train gets the production guard's smoke.
- **Vercel's limit (measured Oct 24, #461):** Hobby's '100 deployments per day'
  refusal (402 `api-deployments-free-per-day`) hit an **API/CLI redeploy**, while
  git-triggered deploys of `main` kept succeeding past 100 in 24 h (12:13, 12:29, 12:48 and
  13:49Z). So the train batches anyway (≤48 deploys a day), logs GitHub's 24 h deploy
  count as advisory only, and **holds only on Vercel's own answer**: if the newest
  production deploy failed within the last hour, it alerts once and retries after the hour.
  Avoid `vercel redeploy`/`deploy` from the CLI on a busy day; push or promote instead.
  Direct merges to `main` only with `hotfix` or a migration. The train then merges `main`
  into `next` itself (a `Train sync: main → next` PR whose head is `main`'s CI-checked
  commit), dispatches CI on the merged commit and promotes once it's green. Only a conflict
  or red `main` stops it; then merge `main` into `next` by a person's PR.
- If `main` refuses the train PR's merge, the train checks the PR's own `pull_request` CI on that
  commit. A run with **0 jobs** is GitHub's merge ref not being ready yet (#878): it reruns that run
  once and keeps retrying for up to 10 minutes. A PR CI failure that ran jobs stops the train at once.
- A red or stuck `next` opens one `Deploy train stuck` issue for DevOps. Fix `next`
  with a PR to it; production keeps the last train.
- [pr-base.yml](../.github/workflows/pr-base.yml) retargets PRs opened against `main`
  to `next`, except the train itself, PRs labelled `hotfix` or `ready-to-ship`, and PRs
  that add `db/migrations/` (released to `main` by DevOps with `release.mjs`).
- Hotfix: DevOps or CTO opens the PR to `main` with the `hotfix` label. It's one deploy,
  so use it for production breakage only. The next train merges it into `next`.

## Backups and restore

The Supabase free plan keeps no backups (owner, Oct 27: no Pro), so we keep our own (#884):
- **Nightly encrypted dump:** [db-backup.yml](../.github/workflows/db-backup.yml) runs `pg_dump`
  of the `public`, `private` and `auth` schemas (data and schema; `private` holds the encrypted Meta tokens, payment orders and the migration ledger) as the read-only role `backup_reader`
  (`BYPASSRLS`, `default_transaction_read_only`). It connects through the session pooler using the
  Actions secret `BACKUP_DATABASE_URL` (the only place its password lives). The dump is gzipped
  and encrypted (openssl CMS, AES-256) to the public certificate
  [.github/backup/backup-cert.crt](../.github/backup/backup-cert.crt), then kept as a 14-day
  workflow artifact. Only the private key decrypts it; it lives in DevOps's keychain
  (`security find-generic-password -a devops -s adbrain-backup-key -w`, base64 PEM). The artifact is
  unreadable without it. A failed run opens one `Database backup failed` issue. GitHub's schedule
  is best effort, so the team supervisor also dispatches the workflow when its newest run is
  over 23 h old.
- **Before every migration:** `scripts/release.mjs` requires a successful backup that finished
  less than an hour ago, and dispatches one and waits if needed.
- **Second copy:** the supervisor's nightly JSON export into `~/.adbrain-backups`
  ([Operations](OPERATIONS.md#data-safety-and-recovery)).
- **Storage:** the same run mirrors the owners' uploads (`brand-assets`: logos, product photos;
  names from the database, files from their public URLs) into a separate `<name>-uploads` artifact, encrypted
  the same way. Generated ad images (`creatives`, ~830 MB) are left out because they can be
  regenerated.
- **How much can be lost:** up to 24 h between nightly dumps, about 0 around migrations.

**Weekly drill:** `node scripts/restore-drill.mjs --post` downloads the newest backup, decrypts it with
the keychain key, restores it into a throwaway local Postgres 17 (Supabase's roles and `extensions`
schema stubbed), checks every table's row count against the dump and posts PASS/FAIL on #884. It
deletes everything afterwards. DevOps runs it every Monday.

**Restore** (into a new Supabase project, never over production without the CEO):
1. `gh run download <run id> -R vanshulgoyal101/adbrain` (latest:
   `gh run list -w db-backup.yml --status success -L 1`).
2. Decrypt in a private folder (`umask 077`):
   `security find-generic-password -a devops -s adbrain-backup-key -w | base64 -d > key.pem`, then
   `openssl cms -decrypt -binary -inform DER -inkey key.pem -in <name>.sql.gz.cms -out dump.sql.gz`,
   then delete `key.pem`.
3. On a fresh project (which already has Supabase's `auth`): `gunzip -c dump.sql.gz | psql "<new
   project's session-pooler URL>" -v ON_ERROR_STOP=0`. The `auth` objects Supabase created already
   exist; their rows load. Then compare row counts per table with production's last
   `npm run stats`.
4. Set Vercel's Supabase URL and keys to the new project, and keep `META_TOKEN_ENCRYPTION_KEY`
   unchanged so stored Meta tokens still decrypt. Redeploy, then run the production smoke.
5. Delete the decrypted files.

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
- **WS1 first-timer walk (#1439), report-only:** after a green smoke it runs
  `scripts/ws1-walk.mts` as `WS1_EMAIL`/`WS1_PASSWORD` (a confirmed internal account whose
  business has never gone live) on a 360 px phone over slow 4G: step 1's five fields (filled
  from a pasted bio where empty), step 2's two picked ads, and step 3's cap, Connect/payment
  and trust lines, each with LCP ≤ 2.5 s, CLS ≤ 0.1 and the honest-copy rules
  (`src/lib/copy/honest-copy-rules.ts`). Every Meta write is blocked. The result lands in the
  run summary; a FAIL neither rolls back nor opens an issue. Skipped while the secrets are
  unset. `--plant` must make it FAIL (a planted promise and a slowed load).
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

**Without `VERCEL_TOKEN` (CEO, Oct 24, #413):** the guard waits 3 minutes after each
production deploy, runs the read-only smoke and only reports (one tracker issue); there
is no automatic rollback and the drift check is skipped. Roll back by hand from a
logged-in CLI: `npx --yes vercel@60.1.3 promote <previous-deployment-url> --scope vanshul-goyals-projects`.
Revisit if a bad deploy ever stays live longer than an hour.

Recovery after an automatic rollback: the guard rolls back by **promoting** the
last good deployment (#390), so Vercel keeps auto-promoting later deploys; each new
deploy gets its own guard. Fix forward or revert through a PR; when the fix is live
and its guard passes, close the issue. While one `Production smoke failed` issue is
open, further failures comment on it instead of opening more. A rollback done by
hand with `vercel rollback` (or the dashboard) does turn auto-promotion off: undo it
with `npx --yes vercel@60.1.3 promote <deployment-url> --scope vanshul-goyals-projects`.
