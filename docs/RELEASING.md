# Release Workflow

- `main` is production. Do not push unfinished application changes to it.
- `dev` is the integration branch. New work lands here in focused commits first.
- CI runs lint, types, coverage, build, and secret scanning for both branches.
- Vercel Git deployments for `dev` are disabled until an isolated non-production
  database and provider configuration are available. Local QA is not production.
- Promote only verified commits through a pull request targeting `main`. Use a
  release branch from `main` with selected commits when `dev` contains unfinished
  work; do not merge all of `dev` merely to release one feature.
- Verify CI and the resulting Vercel production deployment after promotion.
- Database migrations and credential backfills are explicit release steps, never
  automatic consequences of a Git push. Review compatibility and rollback first.

## Current Meta Connect Work

Meta connection, campaign drafts, and operation recovery remain development-only.
Local journey tests pass with mocked Meta consent, but real consent, account/Page
selection, customer permissions, production migrations, and credential setup have
not been verified. Do not promote the UI without its backend and release gates.

See [the verification report](meta-connect-workers/VERIFICATION-2026-09-07.md)
on `dev` for current evidence and limitations.