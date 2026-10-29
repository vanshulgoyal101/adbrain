# Release Workflow

Part of [Operations](README.md). Backups, rollback and the production guard: [Release recovery](releasing-recovery.md).

AdBrain's deployment reference: `main` is production and the only long-lived branch;
Vercel deploys it automatically. Dated release receipts live in git history and the
PRs, not here. Last verified: 2026-10-23.

## Startup Fast Path

The release process ([AGENTS.md](../../AGENTS.md)).

1. Branch from current `origin/next` in an isolated worktree under
   `adbrain-wt/`, build a small complete slice and open a PR to `next` with
   auto-merge enabled. The branch need not be up to date. See [Deploy train](#deploy-train).
2. Required checks are `build`, `test`, `core` and `secrets`
   ([ci.yml](../../.github/workflows/ci.yml)), plus `core-approval`
   ([core-approval.yml](../../.github/workflows/core-approval.yml), #926): a PR that
   touches `src/lib/meta/`, `src/lib/campaign/`, the Meta, campaign, managed,
   payments or spend-limit APIs, money paths (including the ₹999 plan, `src/lib/plan/`),
   tenant/auth boundaries (`/api/cron`, `/api/whatsapp`, privacy requests,
   `src/lib/security/`, `src/lib/alerts/`, `internal-accounts`) or `db/migrations/` stays pending until
   a QA verdict, `Reviewer: review of <sha>: **approved**` or `CTO: review of <sha>:
   **approved**` names its head (or an earlier head with the same patch). Legacy
   space-only role prefixes still work; a later negative verdict at that head
   overrides either format. Money/migrations still need QA plus CTO/Reviewer.
   The deploy train (this repo's `next` → `main` only, never a fork's `next`) and a
   revert labelled `rollback` pass. Hold with `gh pr merge <n>
   --disable-auto`. `audit` and `docs` also run but do not block. A change to generation, validation, prompts, models, timeouts, the
   planner, Meta calls or CSP adds or updates a `test:core` test with recorded real
   responses. Update the matching doc in the same PR.
3. Low-risk PRs (no migration, money, tenant/auth or config change) merge
   automatically on green CI. QA reviews high-risk changes only; there is no
   coordinator or second-QA approval gate.
4. Vercel deploys `main` only ([vercel.json](../../vercel.json)). The
   [production guard](releasing-recovery.md#production-guard) runs `npm run smoke:core` after each
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

These controls are split between [.github/workflows/ci.yml](../../.github/workflows/ci.yml),
[vercel.json](../../vercel.json), and GitHub branch-protection settings. Direct CLI
deployments are not blocked by Git branch protection; never use `vercel --prod` to
skip review.

**Action updates (#1772):** [dependabot.yml](../../.github/dependabot.yml) opens one grouped `github-actions`
PR into `next` every Monday; [dependabot-automerge.yml](../../.github/workflows/dependabot-automerge.yml) enables
auto-merge only when Dependabot is the author and every changed file is under `.github/workflows/`. Required
checks still gate the merge. Anything else Dependabot opens waits for a person.

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
  [ai-review.yml](../../.github/workflows/ai-review.yml), on open and each push: free Groq
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
  The owner alert preference and verification RPCs from #974 are accepted only for
  authenticated execution: both check `auth.uid()` and business ownership inside,
  fix `search_path`, and keep anonymous execution and direct owner writes denied.
- **Tenant or money PRs without a migration target `next`** (#461): `release.mjs --pr <n>` runs the same
  QA (and, for money paths including `src/lib/managed/`, CTO) checks, merges into `next`, and prints
  a receipt; the next deploy train ships it and smokes it. Migrations still release to `main`.
- **Every migration needs a fresh backup:** `release.mjs` refuses to apply one without a
  successful [database backup](releasing-recovery.md#backups-and-restore) from the last hour (CEO, #884).
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
   See [worker rollout](runbooks/campaigns.md#campaign-worker-rollout). Neither new migration
   nor a worker deployment is authorized merely by publishing code.
- Credential backfills and encryption-key changes require explicit planning.
  Do not replace an encryption key without preserving access to existing tokens.
- Local QA uses the existing `adbrain-qa` Colima profile and
  [scripts/local-meta-qa.mjs](../../scripts/local-meta-qa.mjs). Its launcher
  asserts loopback Supabase targets and isolates provider configuration. Plain
  `npm run dev` does not itself provide that isolation. Do not create paid staging
  resources or reuse production credentials to bypass the lack of free staging.
- Real Meta consent requires the user in the browser. Never collect passwords or
  tokens in chat. Connection verification must not create or activate campaigns.

## Deploy train

Vercel Hobby allows 100 production deploys a day, and every push to `main` is one
(#461). So PRs merge into **`next`**, which Vercel doesn't deploy, and
[deploy-train.yml](../../.github/workflows/deploy-train.yml) promotes it:
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
  with a PR to it; production keeps the last train. The promote step's own 93-minute
  limit leaves its alert time to run. A newer push cancels a waiting train, and a
  cancelled run alerts nothing, so the scheduled watchdog job opens the same issue
  (once) when a change has waited on `next` for 120 minutes (#2029).
- [pr-base.yml](../../.github/workflows/pr-base.yml) retargets PRs opened against `main`
  to `next`, except the train itself, PRs labelled `hotfix` or `ready-to-ship`, and PRs
  that add `db/migrations/` (released to `main` by DevOps with `release.mjs`).
- Hotfix: DevOps or CTO opens the PR to `main` with the `hotfix` label. It's one deploy,
  so use it for production breakage only. The next train merges it into `next`.
