# Release Workflow

This is AdBrain's deployment reference. It applies to this repository, not every
repository in the surrounding workspace. Last verified: 2026-09-07. Recheck remote
settings before a release; the historical receipts below are not current status.

## Non-Negotiable Rules

- `main` is live production at https://adbrain.vanshul.com. Do not develop there.
- `dev` is integration. Put new work here in focused, dependency-ordered commits,
  test it, then promote only the completed subset through a PR to `main`.
- A green dev build does not make every commit independently releasable. Include
  required backend, schema, configuration, and UI dependencies in the release.
- Never merge all of `dev` to release one feature while other work is unfinished.
- Never bypass protection, force-push, or use `vercel --prod` to skip review.
- Preserve local work. Do not reset, stash, or discard unrelated changes to make
  a release branch clean. Use an isolated worktree when appropriate.
- Git publication, production deployment, migrations, credential changes, and
  live provider mutations are separate actions requiring appropriate approval.

## Enforced Controls and Limits

| Control | Verified setting |
| --- | --- |
| CI triggers | Pushes and PRs targeting `main` or `dev` |
| Build job | `npm ci`, lint, typecheck, coverage, production build |
| Secret job | Gitleaks with repository configuration |
| Main protection | PR required; strict, up-to-date `build` and `secrets` checks |
| Administrators | Protection applies to admins too |
| Approvals | Zero required approvals for the solo-owner workflow; CI is still required |
| Force pushes / branch deletion | Disabled on `main` |
| Vercel Git deployment | `main: true`, `dev: false` |

These controls are split between [.github/workflows/ci.yml](../.github/workflows/ci.yml),
[vercel.json](../vercel.json), and GitHub branch-protection settings. GitHub does
not enforce that every release originated on `dev`; the promotion procedure does.
Direct CLI deployments are not blocked by Git branch protection.

**Other branch names default to Vercel deployment enabled.** Before pushing a
feature or release branch, inspect its deployment rules and preview credentials.
Disable that branch's Git deployment first if isolation is not verified. Do not
assume a preview URL implies a preview database, harmless cron behavior, or safe
provider credentials. Re-enabling previews is a separate environment change.

Gitleaks PR scans need the built-in `GITHUB_TOKEN`. The secrets job has read-only
contents and pull-request permissions; comments are disabled. Do not remove the
token or grant write access to fix a read-only scan. The exact `operation-key-1`
allowlist entry is a synthetic idempotency test value, not a credential. Do not
exclude entire test directories or suppress uninvestigated findings.

## Normal Development

1. Confirm repository, branch, and local changes with `git status --short --branch`.
2. Fetch remote state. Work on `dev`, or a feature branch based on current `dev`.
   Do not switch away from a dirty tree without preserving and understanding it.
3. Implement and run focused tests. Stage explicit paths and inspect the staged
   diff, including new files. Never include environment files, local databases,
   provider tokens, or generated test artifacts.
4. Commit related changes separately. Push to `dev` and verify CI for the exact
   pushed SHA. Feature branches should target `dev` by PR; check preview safety
   before their first push.
5. Record unresolved gates honestly. Keep unverified features development-only.

## Production Promotion Checklist

1. Identify the precise user-visible change and its dependency-complete commits.
   Review the diff against the latest `origin/main`, not just against `dev`.
2. When `dev` contains unfinished work, create a release branch from `origin/main`
   and cherry-pick only the required commits in order. Do not resolve conflicts by
   copying whole files from `dev` without reviewing the extra changes.
3. Decide the preview deployment policy before pushing that branch. Verify schema
   compatibility, required environment variables, and rollback before promotion.
4. Test the assembled release, not only its source branch. Run lint, typecheck,
   coverage, build, and relevant browser/database checks. Real-provider behavior
   needs real-provider evidence; local mocks cannot satisfy that gate.
5. Open a PR to `main` listing included changes, deferred work, tests, schema/env
   prerequisites, deployment effects, and rollback. Inspect the complete PR diff.
6. Require passing checks on the current PR head. If commits or the base change,
   validate again. Merge without bypass, ideally guarded by the reviewed head SHA.
7. Verify main CI and Vercel deployment success for the resulting merge SHA.
   Check the canonical production URL and the actual affected user workflow.
   A homepage HTTP 200 is not verification of an authenticated feature.
8. Sync the production merge back into `dev`, leave the working branch on `dev`,
   and record the PR, SHAs, CI/deployment links, smoke results, and remaining gaps.

Useful read-only checks (run from this repository):

```sh
git status --short --branch
git fetch origin
git log --oneline origin/main..origin/dev
git diff --stat origin/main...HEAD
gh pr checks <pr-number> --repo vanshulgoyal101/adbrain
gh run view <run-id> --repo vanshulgoyal101/adbrain
gh api repos/vanshulgoyal101/adbrain/commits/<merge-sha>/status
gh api repos/vanshulgoyal101/adbrain/branches/main/protection
```

## Database and Credential Safety

- `.env.local` points at production Supabase, not the local QA database. The
  production project reference is `kmzuxrvfrwwpwmoovwcp`; verify the actual target
  before every database command. Never print secrets to establish that identity.
- **Do not casually run `npm run db:push`.** It uses the configured environment
  and can modify production. A committed migration is not an applied migration.
- Review migrations against existing data, test fresh and upgrade paths, and
  define backup/restore, compatibility, and sequencing before applying remotely.
- Credential backfills and encryption-key changes require explicit planning.
  Do not replace an encryption key without preserving access to existing tokens.
- Local QA uses the existing `adbrain-qa` Colima profile and
  [scripts/local-meta-qa.mjs](../scripts/local-meta-qa.mjs) on `dev`. Its launcher
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

## Publication Receipt: 2026-09-07

Production `main` at `660b9ac` includes only release controls from
[PR #1](https://github.com/vanshulgoyal101/adbrain/pull/1): CI configuration, this
guide's initial version, and Vercel Git deployment controls. No pending Meta
feature code, migrations, credential backfills, or live campaign mutations were
released. Vercel deployment `6RKYtTkPZkd2uACigcgqNh5qL2Ca` succeeded; homepage
and login returned HTTP 200 with AdBrain content. This was a configuration-only
release, not an authenticated Meta journey verification.

The existing local feature work was preserved on `dev` at `b1e5d3d`:

| Commit | Contents |
| --- | --- |
| `397510e` | Secure connection, schema, persistence, and domain tests |
| `8e7678f` | API integration and guarded campaign operations |
| `a1c879c` | Connection UI and editable campaign-draft recovery |
| `a01db63` | Local QA scripts, browser tests, configuration, and evidence |
| `9575bf8` | Exact synthetic test-value exception for secret scanning |
| `b1e5d3d` | Sync of the production merge into dev |

Verification: 856 tests passed, one skipped; coverage 65.83% statements, 57.35%
branches, 67.03% functions, 67.65% lines. Lint, types, production build (50 pages),
and full new-history secret scanning passed. Hosted
[dev CI](https://github.com/vanshulgoyal101/adbrain/actions/runs/34145434072) and
[main CI](https://github.com/vanshulgoyal101/adbrain/actions/runs/34145412290)
passed. These are dated receipts, not approval to release the Meta feature set.

## Current Meta Connect Work

Meta connection, campaign drafts, and operation recovery remain development-only.
Local journey tests pass with mocked Meta consent, but real consent, account/Page
selection, customer permissions, production migrations, and credential setup have
not been verified. Do not promote the UI without its backend and release gates.

See [the verification report](meta-connect-workers/VERIFICATION-2026-09-07.md)
on `dev` for current evidence and limitations.