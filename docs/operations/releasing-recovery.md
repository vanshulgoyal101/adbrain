# Release Recovery

Part of [Operations](README.md). Release rules and the deploy train: [Release workflow](releasing.md).

## Backups and restore

The Supabase free plan keeps no backups (owner, Oct 27: no Pro), so we keep our own (#884):
- **Nightly encrypted dump:** [db-backup.yml](../../.github/workflows/db-backup.yml) runs `pg_dump`
  of the `public`, `private` and `auth` schemas (data and schema; `private` holds the encrypted Meta tokens, payment orders and the migration ledger) as the read-only role `backup_reader`
  (`BYPASSRLS`, `default_transaction_read_only`). It connects through the session pooler using the
  `BACKUP_DATABASE_URL` secret of the `production-secrets` environment (`main` only, #1893; the only place its password lives; rotate with a SCRAM verifier, `alter role backup_reader password 'SCRAM-SHA-256$…'`, and allow ~2 min for the pooler's cache). The dump is gzipped
  and encrypted (openssl CMS, AES-256) to the public certificate
  [.github/backup/backup-cert.crt](../../.github/backup/backup-cert.crt), then kept as a 14-day
  workflow artifact. Only the private key decrypts it; it lives in DevOps's keychain
  (`security find-generic-password -a devops -s adbrain-backup-key -w`, base64 PEM). The artifact is
  unreadable without it. A failed run opens one `Database backup failed` issue. GitHub's schedule
  is best effort, so the team supervisor also dispatches the workflow when its newest run is
  over 23 h old.
- **Before every migration:** `scripts/release.mjs` requires a successful backup that finished
  less than an hour ago, and dispatches one and waits if needed.
- **Second copy:** the supervisor's nightly JSON export into `~/.adbrain-backups`, encrypted to the same certificate (`.tar.gz.cms`)
  ([Operations](backups.md#data-safety-and-recovery)).
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

[`production-guard.yml`](../../.github/workflows/production-guard.yml) runs without
anyone watching (owner-approved automatic rollback, #111):

- **After each successful Production deployment** it waits until
  `adbrain.vanshul.com` serves that commit, then runs
  `npm run smoke:core`, which views five pages read-only and then prepares one campaign review without sending it (one retry after 60 s). If the smoke still fails, it rolls
  production back to the newest earlier READY production deployment and opens a
  `core` `bug` issue with the failing step.
- **Daily at 03:30 UTC** it runs the same smoke and opens an issue on failure
  (no rollback).
- **WS1 first-timer walk (#1439), gating:** after a green smoke it runs
  `scripts/ws1-walk.mts` as `WS1_EMAIL`/`WS1_PASSWORD` (a confirmed internal account whose
  business has never gone live) on a 360 px phone over slow 4G: step 1's five fields (filled
  from a pasted bio where empty), step 2's two picked ads, and step 3's cap, Connect/payment
  and trust lines, each with LCP ≤ 2.5 s, CLS ≤ 0.1 and the honest-copy rules
  (`src/lib/copy/honest-copy-rules.ts`). Every Meta write is blocked. The result lands in the
  run summary; a FAIL turns the guard red and opens a core bug, but never rolls back. Skipped while the secrets are
  unset. `--plant` must make it FAIL (a planted promise and a slowed load).
- **Create, every 2 hours (#2145):** [`create-smoke.yml`](../../.github/workflows/create-smoke.yml)
  runs `smoke-core.mjs --create` as the smoke account at :17 past every second hour (and on dispatch), one at a
  time, with no retry. It makes 3 ads on free pictures only (it refuses before any paid request if the account
  isn't internal or is exempt) and spends one Create's text on the normal models (about $0.006 on Haiku). A PASS
  deletes its ads and their Storage files, so the 1 GB free Storage doesn't fill. A failure opens one `core`
  `bug` issue `Create smoke failed in production` for DevOps (repeats comment on it; the first pass after it
  says so once). It never rolls back. Pause it with `gh workflow disable create-smoke.yml`.
- **After each push to `main`, and every 15 minutes if GitHub fires the schedule**
  [`production-drift.yml`](../../.github/workflows/production-drift.yml) waits until
  15 minutes after main HEAD landed, then fails and opens one
  `Production is not main HEAD` issue if that commit is not live. A run whose
  commit is no longer main HEAD passes and leaves the check to the newer run.

Every step has its own `timeout-minutes`, and together they fit inside the 95-minute
job limit, because a timed-out job opens no issue (#210, #2029; a step timeout still
does). `tests/workflow-time-budgets.test.ts` enforces that sum for the guard, the Create smoke and the
deploy train. `playwright install --with-deps` gets 8 minutes; the
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
production back and opens a `[DRILL]` core bug. It captures the served commit and
deployment ID **before** the forced smoke, rather than assuming the workflow ref
is live; rollback must still match that captured deployment. Run a real drill only
with separate authorization and after token restoration (#1746); this fix does not
enable rollback or restore secrets. Restore with the recovery steps below.

**Without `VERCEL_TOKEN` (CEO, Oct 24, #413):** after each production deploy the guard
waits until the domain's `X-AdBrain-Release` header (the build's commit, #1457) is that
commit, then runs the read-only smoke and only reports (one tracker issue). A newer commit
counts as superseded (its own run smokes it). If the domain never serves the commit within
6 minutes (a pinned domain after a hand rollback, #1347), the guard **fails** with `FAIL
Domain serves …` instead of smoking an old build. There is no automatic rollback and the
drift check is skipped. Roll back by hand from a
logged-in CLI: `npx --yes vercel@60.1.3 promote <previous-deployment-url> --scope vanshul-goyals-projects`.
Revisit if a bad deploy ever stays live longer than an hour.

Recovery after an automatic rollback: the guard rolls back by **promoting** the
last good deployment (#390), so Vercel keeps auto-promoting later deploys; each new
deploy gets its own guard. Fix forward or revert through a PR; when the fix is live
and its guard passes, close the issue.

**Superseded rollback (#2030):** a failed smoke does not authorize replacing an
unrelated release. The guard checks the served commit and deployment ID, requires
that exact failed deployment in READY history, then rechecks serving identity
immediately before invoking promotion. If production changed, it logs
`Superseded: rollback skipped` and makes no promotion; the original smoke failure
still opens/comments on the incident. Check the newer deployment's own guard
before deciding whether recovery is needed. Unknown serving identity or a missing
failed deployment refuses rollback rather than guessing an earlier target; investigate
the run and deployment history instead of retrying against the unrelated current
release. The final API read and CLI promotion are not an atomic compare-and-swap;
stop competing promotions during an explicitly authorized recovery/drill.
Offline regression check (Node, Bash and jq; no credentials or network):
`node --experimental-vm-modules --test scripts/production-guard.test.mjs`;
the required CI `core` job runs it explicitly (Vitest only includes `tests/**/*.test.{ts,tsx}`).

While one `Production smoke failed` issue is
open, further failures comment on it instead of opening more. A rollback done by
hand with `vercel rollback` (or the dashboard) does turn auto-promotion off. **Never end
an incident there (#1457):** once the fix is merged, promote the deployment of **main
HEAD** (not the one you rolled back from; find it with
`gh api "repos/vanshulgoyal101/adbrain/deployments?environment=Production&per_page=1"`)
with `npx --yes vercel@60.1.3 promote <deployment-url> --scope vanshul-goyals-projects`,
then confirm `curl -sI https://adbrain.vanshul.com/ | grep -i x-adbrain-release` shows
main HEAD. The next deploy's guard fails if the domain is still pinned.
