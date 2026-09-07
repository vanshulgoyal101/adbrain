# Meta Connect Verification

Date: 2026-09-07. Scope: integrated shared checkout, not a deployed release.

## Verdict

**Current product verdict, after the local follow-up and journey review: not yet
seamless, and not released.** The original goal was to connect an existing Meta
account in context and return to the user's work. Secure infrastructure is not
the same as proving that experience.

### How We Got Here

1. The original plan expanded a contextual OAuth improvement into encrypted
  credentials, asset discovery, campaign drafts, durable mutation operations,
  activation review, provisioning feasibility, and a three-worker program.
2. Workers delivered most components, but cross-component contracts and real
  database execution exposed bugs that unit fixtures did not reveal.
3. Follow-up work repaired those bugs and built a free local Supabase environment.
  This was useful safety work, but it displaced the first real user walkthrough.
4. The plan's phase-zero Meta feasibility evidence was not completed first.
  A real app metadata GET succeeded and OAuth reached Facebook login, but the
  user-driven check timed out without a callback. That proves neither successful
  connection nor a provider defect. It does not prove public customer access.
5. Reports were not kept current and continued listing repaired defects as open.
  The assessment here supersedes those historical statements.

### Product Acceptance

| User outcome | Current evidence and gap |
| --- | --- |
| Start connecting from Settings without entering IDs/tokens | Implemented; authenticated local UI tested. Settings currently opens a dialog with a second Connect Business action. |
| Prepare work before connecting | Implemented locally. The composers are available while disconnected, and Prepare saves the draft without requiring a lead form. Existing create/activation checks remain unchanged. |
| Login, discover, and automatically select one eligible pair | Implemented and locally tested; not proven with an actual completed Meta consent. Personal/shared-asset compatibility and external-user permissions remain unverified. |
| Choose between accounts on mobile/same-tab return | Completion previously offered only a return link. This review reused the existing owned-attempt dialog to expose selection/recovery on completion. Focused tests pass; actual mobile OAuth is not yet tested. |
| Recover from expired authorization | This review added a fresh Reconnect action instead of retrying an expired attempt; covered by a focused test. |
| Recover from missing assets or permissions | Partial. Generic attempt blockers and null actions still lack specific setup/admin guidance. Bounded polling now ends in a visible recovery state; Check again reads an in-progress attempt without restarting discovery. |
| Return to the exact draft with no surprise mutation | Continuous local browser tests pass at 1440px (popup) and 390px (same-tab). Real local draft persistence preserves name, creative, budget and A/B settings; refreshed forms load, and the chosen form updates the same versioned draft. Meta consent/status/forms are mocked; same-tab consent redirects to Campaigns rather than exercising the real OAuth completion page. No campaign mutation is sent. Lost-create-response recovery also passes. |
| Available to customers | No. No production migration, backfill, deployment, or non-app-role consent verification was performed. |

### Decision: One Narrow Milestone

Finish **existing-account connection and return to saved draft**, using the code
and local environment already present. No new worker plans or infrastructure.

1. Make draft-first entry real: allow editing before connection, persist the
  draft before navigation, and reload its editable fields and Page forms after
  return. Do not weaken create/activation checks to enable draft editing.
2. Make the connection states finishable: selection on same-tab return (now
  repaired locally), expired login (now repaired locally), and specific missing
  asset/admin instructions. Keep provider setup manual for this milestone.
3. Demonstrate one uninterrupted real-account journey: draft -> Meta consent ->
  correct selected account/Page -> same draft, with no campaign mutation. Then
  test one multiple-choice/fallback case and separately verify access for a
  non-app-role customer before calling the experience publicly ready.

Stop expanding this milestone when those outcomes are demonstrated. Automated
provisioning, unattended campaign recovery, provider-fresh activation review,
campaign sync, and live ad spending are separate work. Existing protections stay;
they do not all need further expansion to validate account connection.

### Latest Executed Evidence

- Dev-branch publication gate: 856 tests passed, one skipped; coverage 65.83%
  statements, 57.35% branches, 67.03% functions, 67.65% lines. Lint, types,
  and production build passed (50/50 generated pages). These results supersede
  the prior UI-only regression limitation below, not the real Meta consent gap.
- Feature history is split into foundations, API integration, user journey,
  and verification commits on `dev`. These are dependency-ordered snapshots,
  not independently production-ready releases. Production promotion requires
  the migration, credential, and real-provider gates in this report.
- Prior follow-up full suite: 853 passed, one existing skip; 113 passed files.
  Coverage: statements 66.44%, branches 57.77%, functions 67.52%, lines 68.2%.
- Real PostgreSQL: 32 checks across fresh install and ordered upgrade, including
  structured discovery, atomic disconnect, and fenced discovery retry.
- Full local Supabase Auth/PostgREST/storage: synthetic fixtures only. Home to
  Review passed at 1440/1024/768/390; eight workspace routes passed at those
  widths; mocked connection popup/fallback matrix passed; lost-response/reload
  campaign recovery passed. These are not real Meta consent tests.
- Prior full lint, types, and production build passed (50/50 generated pages).
- Latest draft-first pass changed campaign editing/restoration, fresh form loading,
  and dialog waiting/closure behavior. The continuous browser test caught and
  verified a fix for a native dialog remaining open after successful connection.
  Both desktop/mobile journeys pass, along with the existing lost-response browser
  recovery test, 16 focused unit tests, typecheck and lint. Screenshots inspected;
  horizontal overflow checks pass. Screenshots capture the subsequent preflight
  pending state; successful campaign preflight is not asserted by this fixture.
  Full regression/build/database gates above predate this latest UI pass.
- Capability bootstrap, structured discovery persistence, token app/subject and
  expiry checks, token data-access expiry storage, atomic disconnect, and actual
  rediscovery are implemented. Provider evidence policy still needs real proof.
- The temporary app server and `adbrain-qa` Colima VM were stopped; local data
  and code are preserved. No production changes, campaign mutations, or spend.

## Historical Verification Snapshot

The rest of this document preserves the earlier pass for traceability. Its
counts, environment limitations, blockers, and resume instructions are historical,
not the current task list. Use the assessment above.

**Not approved for production.** Real local PostgreSQL verification now passes,
but hosted/browser/provider gates are incomplete and capability verification has
a confirmed bootstrap defect. Earlier worker completion statements are not
release approval. No production migration, deployment, commit, paid API call,
Meta campaign creation, or ad activation was performed in this verification pass.

The user authorized a separate staging project only if it is free and requires
no changes to existing projects. That condition cannot currently be met.

## Environment Evidence

- Local application configuration points to production Supabase project
  `kmzuxrvfrwwpwmoovwcp` (`adbrain`). It is not staging.
- Management API inventory found no staging project. AdBrain's organization,
  `octarexxpxmqfxxkxhml`, reports plan `free` and has two active projects:
  `adbrain` and `portfolio` (`tmngedsmgcgbkbkmsnsw`).
- Supabase documents a limit of two free projects across organizations where
  the user is owner/administrator. Both slots are occupied. No project-create,
  pause, transfer, or billing-change request was sent.
- Reference: <https://supabase.com/docs/guides/platform/billing-on-supabase>.
- Zero-row REST reads for `meta_connections`, `campaign_drafts`, and
  `campaign_operations` each returned HTTP 404 / `PGRST205` on the configured
  project. No customer rows were retrieved by these probes.
- Local `META_APP_ID` and `META_APP_SECRET` are present. Local
  `META_LOGIN_CONFIG_ID` and `META_TOKEN_ENCRYPTION_KEY` are absent. This does not
  establish the contents of deployed environment variables or Meta dashboard
  approval/configuration.
- Existing test-account sign-in worked for browser checks; it used the configured
  Supabase auth service. No production application-data writes were performed.

## Fixes Made During Verification

- Campaign-operation tables are owner-readable but server-write-only. Browser
  roles cannot insert/update/delete the ledger or call its mutation RPCs.
  The ownership/preflight-checked create route uses the admin client for ledger
  writes, while user-scoped reads and campaign persistence retain their context.
- Atomic claim serialization prevents concurrent unique-key errors and multiple
  running claims. An expired running operation becomes `needs_reconciliation`,
  not an automatic repeat of an external mutation. This deliberately favors
  duplicate prevention over automatic crash recovery.
- A failed persisted claim never becomes a locally inferred execution grant.
  Returned reconciliation records are replayed, not executed.
- Operation checkpoint and success RPCs reject stale connection generations.
- OAuth selection commits reject expired attempts, stale expected generations,
  revoked/expired stored tokens, and changed ownership. Valid competing attempts
  have exactly one commit winner.
- Activation compares the supplied digest with a canonical payload built from
  the current stored campaign budget/status and selected connection. Arbitrary
  digests and budgets changed since review are rejected before `ACTIVE` calls.
- The activation panel no longer shows unrelated composer geography/budget as
  the target campaign's review. It displays the campaign's stored daily total.
- Cron authorization is checked against the actual bearer request inside the
  scheduling boundary; it no longer relies on a session client or a plain
  caller-supplied scheduler object.
- Pause/delete have dedicated purposes. Original binding/generation and stored
  `ads_management` permission are required, but activation eligibility is not.
- Token lookup checks that connection generation/assets still match the earlier
  status read, and rejects stored data-access expiry before decryption. The
  server-only token RPC returns scopes and data-access expiry for these checks.
- The Meta browser harness returns exit code 2 when its authenticated dialog
  matrix is skipped. Static-page success is no longer a full browser-gate pass.

## Executed Checks

| Check | Result |
| --- | --- |
| `npm run test:meta-db` | 26 checks passed on real PostgreSQL 17.11 |
| Full Vitest | 839 passed, 1 existing skip; 110 passed files, 1 skipped |
| `npm run test:coverage` | Passed; statements 67.32%, branches 58.27%, functions 67.93%, lines 69.09% |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed |
| `npm run build` | Passed; 49/49 static pages |
| Home-to-Review browser suite | 4 failures at dashboard load, before workflow assertions |
| Workspace UX browser suite | Failed at first dashboard heading |
| Meta browser suite | Static/unavailable states passed at 1440/1024/768/390; authenticated matrix skipped, exit 2 |

The dashboard server error was `Meta connection storage could not be read`,
from `src/lib/meta/credentials.ts`, called by the dashboard loader. The configured
database lacks the new storage. Do not apply migrations to production merely to
make this local browser run green, and do not disguise storage failure as a
successful connection.

Screenshots are in ignored `test-results/meta-connect-w3/`. Mobile waiting and
desktop Settings-unavailable screenshots were inspected. Home-to-Review failures
are in `test-results/workspace-Home-to-Review-at-*/error-context.md`.

Known nonfatal validation warnings remain: duplicate Sharp/libvips classes and
jsdom document navigation. Development browser output also reports React's
development-only eval/CSP warning. Security headers were not relaxed.

## Database Harness Scope

`scripts/check-meta-connect-db.mjs` creates and removes its own local cluster. It
uses Unix sockets only, never loads application env files, and cannot accept a
remote connection URL. `META_TEST_PG_BIN` may select an installed PostgreSQL bin
directory; its default is Homebrew PostgreSQL 17 on Apple Silicon.

Each run executes the authoritative fresh schema and separately the schema from
baseline `d8d789071c74a7a93b1f270a0c4f119aff79aa34` followed by the two new migrations.
Fixtures model Supabase roles, `auth.uid()`, and minimal storage prerequisites.
They are not a full Supabase Auth/PostgREST/storage deployment.

Checks cover schema execution, secret schema/RPC denial, service-only ledger
writes, owner isolation, concurrent draft versions, concurrent operation claims,
expired-operation reconciliation, stale-generation checkpoints, stale/expired
OAuth selection rejection, competing valid selection commits, and bytea token
readback/tenant mismatch. AES-GCM cryptography is covered separately by unit tests;
the SQL round-trip uses nonsecret fixture bytes.

PostgreSQL was installed locally for this gate. Homebrew's post-install failed
because its DSL lacked `symlink_tree`; the installed support directories were
linked to the expected versioned paths. No Homebrew service was enabled. Every
test cluster was stopped/deleted, and the temporary app server on port 3939 was
stopped after browser checks. The PostgreSQL package remains installed.

## Remaining Release Blockers

1. Capability bootstrap: selection initializes all capabilities to `unknown`.
   `connections/recheck` calls the purpose-gated `read_leads` boundary before it
   can verify anything, and updates only timestamp/status, not capabilities.
   A dedicated, authenticated read-only provider verification path is required.
   Do not resolve this by unconditionally setting capabilities to `available`.
2. No approved hosted staging environment is available within the free-only
   constraint. A hosted Supabase Auth/PostgREST/browser matrix has not passed.
3. Meta Login configuration, exact redirect URI, granted permissions, approved
   test assets, live OAuth, and provider capability checks remain unverified.
4. Discovery SQL still hardcodes `discovery_complete = true` when saving candidate
   arrays. The provider's actual complete/truncated state must survive persistence.
5. Reload/ambiguous-timeout recovery of campaign draft/operation/idempotency state
   and campaign-list reconciliation have not been browser-verified. Operation
   error-finalization fencing and complete fresh activation targeting/billing
   review still need targeted verification. Digest comparison is not proof of
   provider-side budget or eligibility freshness.
6. Legacy plaintext credential backfill and cleanup have not been run. Stored
   data-access expiry is now enforced when present; end-to-end capture/persistence
   of that provider field still needs verification. Disconnect/token deletion
   and linked-attempt foreign-key behavior also need a real lifecycle test.

These are release blockers or explicitly unverified requirements, not waived
because unit tests pass. Campaign sync and automatic asset provisioning remain
disabled.

## Resume Point

Keep the free-only constraint unless the user changes it. Do not pause Portfolio
or AdBrain, restore/reuse unrelated projects, upgrade billing, or copy production
data to a new environment. A full local Supabase stack is a possible no-cloud-fee
alternative, but this machine currently has no Docker runtime.

After a safe staging environment is available, finish capability/discovery
verification, initialize staging with reviewed SQL and synthetic fixtures, and
rerun all authenticated browser and OAuth gates. Production migration, backfill,
deployment, and spending remain separate approvals.