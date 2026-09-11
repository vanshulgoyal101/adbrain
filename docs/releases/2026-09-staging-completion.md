# Staging Workflow Completion

Scope: promote the pending campaign/Meta workflows from `dev` to `main`, as
requested on 2026-09-11. Uncommitted creative-generation and branding work in
the original checkout is excluded and preserved.

## Completed Workflows

- Save an editable campaign draft before connecting Meta; reopen it from another
  tab, update with version checks, or remove an unused draft.
- Plan a guided instant-form campaign while disconnected. Preserve the goal,
  approved creatives, budget, included areas and exclusions. Choose the actual
  Page form after connection. Unsupported call/WhatsApp plans are rejected rather
  than silently converted into a different destination.
- Connect from the saved work, recover missing access, explicitly select assets
  when needed, and return to the editable draft. No automatic campaign creation.
- Review and create paused campaigns using account/Page bindings, current draft
  versions and durable operation identities. One draft cannot submit two
  operations under different keys. Attached drafts are retained for recovery.
- Recover expired operations durably, preserve known provider IDs when storage
  fails, and prevent late failures from overwriting success. Unknown external
  outcomes require manual reconciliation; they are never automatically rerun.
- Verify current Meta capability, campaign account, Page, status and daily budget
  immediately before an explicit activation. Pause does not require activation
  readiness. Failed Meta deletion retains the local campaign record.
- Sync campaigns in bounded pages, importing only verified account/Page matches
  and actual daily budgets. Report pagination and skipped records. Sync does not
  create, activate or delete anything in Meta.
- Remove the shared server-token fallback. Missing, revoked and expired
  per-business connections fail closed. The Meta rollout switch does not prevent
  owners from saving drafts or reducing delivery on a verified existing binding.

## Verification

- Full Vitest run: 909 passed, one existing live-provider test skipped.
- Coverage: 65.70% statements, 58.02% branches, 66.53% functions, 67.81% lines.
- Lint, TypeScript and production build passed (50 generated pages).
- Disposable PostgreSQL: 39 checks across fresh and ordered upgrade schemas,
  including tenant isolation, draft version races, single submission per draft,
  terminal outcome protection, token privacy and existing legacy privileges.
- Eight local browser journeys passed: popup/same-tab draft return, desktop/mobile
  explicit asset selection, interrupted-request identity recovery, desktop/mobile
  saved-draft lifecycle and guided targeting restoration. Screenshots inspected.
- Browser tests use real local Supabase persistence with synthetic accounts and
  mocked Meta consent. No paid generation or real ad mutation was performed.

## Authorized Production Cutover

The owner explicitly approved the additive campaign migration and enabling the
completed workflows for all business owners. The pre-cutover read-only check of
project `kmzuxrvfrwwpwmoovwcp` (`adbrain`) found 116 campaign records, zero locally
active campaigns, zero stored legacy credentials and zero new connections. Draft
and operation tables were absent.

Apply only `db/migrations/20260907_campaign_connect.sql` transactionally after
rechecking the target. Do not apply the fresh schema, migrate shared credentials,
delete campaigns or infer account bindings from environment variables. Existing
campaign rows remain unchanged. Unverified bindings stay blocked until explicit
sync under a verified per-business connection can establish the actual Page.

Set Vercel production `META_CONNECT_ROLLOUT=enabled` for the new deployment. Keep
the existing encryption key, service-role key, Meta app credentials and legacy
system token unchanged. The latter is no longer a runtime tenant fallback.

Use the existing protected `dev` to `main` PR with passing `build` and `secrets`
checks. Verify the exact main SHA and canonical domain after deployment. The
original dirty checkout need not be reset, stashed or switched for this release.

## External Limits and Recovery

Meta last returned "Feature Unavailable" before the OAuth callback. Marketing API
tier approval was visible, but successful real consent, requested permission
eligibility and non-app-role customer login remain unverified. Publishing this
code does not resolve Meta app settings or imply App Review approval.

Activation cannot spend until a verified connection and explicit confirmation
pass all checks. Browser/provider workflows that require actual consent still
need the owner to complete that consent in Meta.

For a regression, set `META_CONNECT_ROLLOUT=disabled` and deploy that setting to
block new connections/publishing; drafts and supported pause/read paths remain.
An env edit alone does not change an existing Vercel deployment. Preserve
encrypted tokens and their key. A reviewed code rollback is compatible with the
additive schema, but does not undo drafts, operation outcomes or external actions.
Never delete recovery records or replay an uncertain create to recover an error.

Record hosted CI, migration hash and exact deployment receipts on the release PR
after execution. Local checks above are not hosted deployment receipts.