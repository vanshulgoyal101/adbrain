# OPS-A / OPS-B Environment and Recovery Receipt

Date: September 26, 2026. Status: verified inventory and local tooling, **not
production rollout approval or packet closure**. Governing backlog:
[remediation plan](remediation-plan-2026-09-26.md). Follow
[release rules](../RELEASING.md) and the latest
[DB-A developer handoff](db-a-dev-a-handoff-2026-09-26.md).

## O-11 SDK and Query Release

**Shipped through protected [PR #36](https://github.com/vanshulgoyal101/adbrain/pull/36).**
PR #29 head `7cc9e62d4ee7047764293bdba108024fc885145f` merged as `35acbf6`;
PR #31 head `db2179eee879630493fe5b69a066818c4707ea7b` then merged as candidate
`4c8dd56e1149ae4519e63ccb1b73772a094c25ef`. Production merge:
`6291dc2d2691bfc8a235b2aa1b103f119b26b83e`. Existing QA approvals were reused.
The only integration conflicts were adjacent manifest entries for AI SDK and
TanStack Query. Structured validation preserved all 672 lockfile entries,
including the SDK's runtime classification of `@standard-schema/spec`; package
versions, resolved artifacts and integrity were retained. Application code was
not rewritten for integration. No completed local suite was restarted.

Required CI passed on both source heads
([#29](https://github.com/vanshulgoyal101/adbrain/actions/runs/36246054735),
[#31](https://github.com/vanshulgoyal101/adbrain/actions/runs/36246051296)),
the assembled [dev](https://github.com/vanshulgoyal101/adbrain/actions/runs/36246375768)
and [release PR](https://github.com/vanshulgoyal101/adbrain/actions/runs/36246436124),
and [main](https://github.com/vanshulgoyal101/adbrain/actions/runs/36246804645).
Production `dpl_EnA1LRC9hiegYy55GDp956J3U5PX` is READY at the exact merge,
with canonical alias `adbrain.vanshul.com`, Node 24.x and region hnd1.

At `2026-09-26T14:00:13.417Z`, authenticated Campaigns returned 200 at the
actual 485x584 viewport with no horizontal overflow. Four real list GETs
verified active/paused filters, empty search results and return to all results;
each returned 200, tenant scope and a request ID. An authenticated invalid GET
to the generation module returned 400 with a request ID, without generation.
The assertion pass blocked client POSTs for auto-sync and telemetry. An earlier
sign-in navigation used the page's normal auto-sync before that guard; this is
not a claim of zero provider reads or zero local synchronization throughout the
session. No ad-state action, paid generation, payment or migration was initiated.
The first filter attempt preceded hydration and sent no list request; retrying
after the mount effect completed passed. Cross-page pagination was not exercised;
reuse the existing scoped browser/tests. Live AI-provider behavior remains unverified.

The corrected source heads and release branch produced no Vercel deployments.
Authenticated metadata covered all 87 deployments before promotion and showed
preview SSO, 29 production-only project variables, no preview variables and no
branch overrides. Reuse the bounded historical isolation checks below, not a
retrospective absence-of-exposure claim. Only main intentionally deployed.

The original 77-path backlog remains preserved by `63931ef`, `8b82a5e`,
`f57c75d`, `5f047fe`, `ea45c71`, `979245f` and reconciliation `e8962b4`.
Shared dev sync `39d4200ce5c57b8a0bc0c33eafdbd40fd184a89d` retains that work
and the production release; its 684-entry dependency union preserves Razorpay
2.9.8. The final publication/CI receipt is attached to PR #36. DB-A migrations
and dependent callers, local test checkout and #34/#35 are not in this release.
Production migration approval remains outstanding; test payments remain disabled.

## O-11 Preview Policy Hold

Historical repair checkpoint; current candidate prerequisites were satisfied
and the resulting code-only release is recorded above.

**Policy defect fixed and hosted-verified in [PR #32](https://github.com/vanshulgoyal101/adbrain/pull/32);
older feature candidates remain held.** After the read-only investigation, the
owner explicitly approved config-only pushes and a protected main PR, with a stop
if any preview appeared. Only that exception was executed. No hosting-dashboard
setting, credential, data or provider change. Earlier suppression claims based on
`*: false` were incorrect, including those in the G-1/G-2 release reasoning.

[Vercel uses minimatch](https://vercel.com/docs/project-configuration/git-configuration):
`*` does not match `/`, unmatched branches default to enabled, and any matching
true rule enables deployment. The exact #27/#28 commits contain the old rule.
The existing minimatch 3.1.5 reproduced both unintended feature deployments and
the G-2 release branch case. [Config](../../vercel.json) changes only `*` to `**`;
nine branch checks pass, with main enabled and dev, the repair branch, both issue
branches, G-2/pilot release branches, a nested feature branch and an ordinary branch
disabled. JSON/editor, whitespace and Gitleaks 8.30.1 checks pass. Region, crons
and explicit rules unchanged; no dependencies installed or application code changed.

Platform metadata identified these Ready Git previews (API target is null):

| Source | Exact deployment | Commit |
| --- | --- | --- |
| #27 | `dpl_BKcwCphv6WjKATYswzmr2oNr3cfx` | `da4f209b4edffe29a1277fbfe96b6677e35d305f` |
| #28 | `dpl_FfVWJnkYZsbcLcAEyLAmp4DJyVzz` | `bab47d0ac46527cc1a012cfd4d8cd0b53b7ab0c1` |
| G-2 release branch | `dpl_GZ39DzRKWDykGJcDEn4uBD3Rcmth` | `cc8b9dd7cdd633e4c2dc73b805b602ab914182ad` |

All 29 configured project variables target production, with zero preview entries
or branch overrides. Each of these three deployments lists none of those variables
in either build or runtime environment metadata (128 platform entries versus 157
for G-2 production). Values were not disclosed. No deployment bypass was configured.
Preview SSO protection is enabled. At `2026-09-26T12:59:42.695Z`, unauthenticated
HEAD requests to each preview's static favicon returned 302 to Vercel `/sso-api`,
without following redirects or reading application bodies. The earlier G-1 release
preview `dpl_fGRkfZEZxwiiZ3Gn4YTZT8LR9onS` also passed this access-barrier check.
[Scheduled Vercel crons target production](https://vercel.com/docs/cron-jobs#how-cron-jobs-work).
These are bounded configuration/access checks, not a retrospective traffic audit
or a claim that no credential exists anywhere. No exposure or production impact
was established; existing preview artifacts were preserved behind authentication.

G-2 was reverified at PR30 merge `9cf456d00194e7943fec2230ecb4ae337c32df6f` and
READY deployment `dpl_6G9MhyoxuUCgbPJrqRTfxGfZevj1`, with the canonical alias.
The subsequent policy repair changes only vercel.json from that source. Reuse
G-2's matching independent QA and recovery smoke below; no paid workflow replay.

Repair commit `1a04cd235d6eda7835fe181f55bf568e339cfb8b`, isolated worktree
`/tmp/adbrain-preview-policy-o11`; protected merge/main/dev
`174d3585ed3357dbd10131b2ed68434763589d32`, identical candidate/merge tree
`fe365f59488bbd8ec3f5883c928c1d7ab944d858`. Hosted CI passed:
[dev](https://github.com/vanshulgoyal101/adbrain/actions/runs/36243879955),
[PR](https://github.com/vanshulgoyal101/adbrain/actions/runs/36244059616),
[main](https://github.com/vanshulgoyal101/adbrain/actions/runs/36244268194),
[sync](https://github.com/vanshulgoyal101/adbrain/actions/runs/36244557755).
Exact-head CI receipts are retained under `.qa-artifacts/devops-o11/preview-policy`.
No protection bypass or unrelated feature integration.

At `2026-09-26T13:09:52.843Z`, after dev/PR CI, Vercel and GitHub had zero
deployments for the repair commit. At `2026-09-26T13:14:19.240Z`, Vercel still
had zero, while the main exception deployed READY as
`dpl_c1aFttGQVQiTY9Wyb4Yq4W1FFdRH`, exact merge SHA, `adbrain.vanshul.com`,
Node 24.x, hnd1. Authenticated Studio returned 200 and its review heading was
visible at `2026-09-26T13:14:58.106Z`; no generation or recovery was invoked.

Remaining candidate prerequisite: #27 at `ff4615f` and #28 at `bab47d0` still
commit `*: false`. Their writers must incorporate the repair commit or updated
dev locally and verify the resulting rules before any next push. They remain
held; no feature promotion was authorized by the config-only exception. Existing
previews remain behind verified authentication, not deleted. Shared checkout and
peer worktrees were preserved; coordinator owns the dispatch update.

## O-10 G-2 Release

**Shipped through protected [PR #30](https://github.com/vanshulgoyal101/adbrain/pull/30).**
Candidate `cc8b9dd7cdd633e4c2dc73b805b602ab914182ad`; production merge and remote
dev `9cf456d00194e7943fec2230ecb4ae337c32df6f`. Candidate/merge tree identical:
`9e733a1a0e95d8b4ad4af1836e8dcc38d45a825d`. Exactly Studio and its existing tests.
The [QA repaired-candidate approval](qa-a-o1-handoff.md#o-10-g-2-cleanup-re-review)
matches full diff `f87cee447f67de82c9a6c6517841eb0c56b3513dbfd2303c477189809a118652`.
Fresh Gitleaks 8.30.1 scan: no leaks. Reused the coordinator's 35 Studio tests,
touched lint and non-incremental types; these are author checks, not a QA rerun.

Hosted CI passed: [dev](https://github.com/vanshulgoyal101/adbrain/actions/runs/36242144516),
[PR](https://github.com/vanshulgoyal101/adbrain/actions/runs/36242387057),
[main](https://github.com/vanshulgoyal101/adbrain/actions/runs/36242552034), and
[dev sync](https://github.com/vanshulgoyal101/adbrain/actions/runs/36243208255).
Vercel `dpl_6G9MhyoxuUCgbPJrqRTfxGfZevj1` is READY at the exact merge with
`adbrain.vanshul.com`, Node 24.x, hnd1. Protection was enforced without bypass.

Authenticated deployed Studio returned 200. The final 819x614 browser smoke
passed persistence-before-POST, lost-response retention, reload, three same-ID
GET recoveries, synthetic result display and matching-identity cleanup. One POST
was intercepted; **zero generation requests reached the server**. Page-local
fetch stubs and test-prefixed real Web Storage preserved actual generation keys.
This is deployed-UI evidence, not live-provider or full responsive acceptance.
Browser infrastructure/selector retries and cleanup are recorded in the
[exact release receipt](../../.qa-artifacts/devops-o10/g2-release-gRxNMw/release-receipt.json).
The superseded patch and failing QA probe remain intact.

No migrations, credentials, paid/provider work, SDK integration or shared-checkout
reconciliation. Shared local dev remains `9da5b07`; peer worktrees are preserved.
No local server started; owned tabs were unavailable at final cleanup. UI-01,
atomic cross-tab admission, durable server intent/quota and unknown partial-result
limitations remain. G-2 release ownership is released to the coordinator for
prioritization; this receipt does not dispatch another backlog batch.

## Authority and Evidence

Production inspection was limited to authenticated platform GETs and bounded
read-only database catalog queries. Each SQL request used `BEGIN READ ONLY`, a
10-second statement timeout, a two-second lock timeout and `ROLLBACK`; the server
reported `transaction_read_only=on`. The Management API POST only transported
that read-only SQL. No application rows, Auth users, object contents, credential
values or raw function bodies were collected. Definitions were MD5-fingerprinted
for comparison, not for cryptographic authenticity. Migration files use SHA-256.

Production catalog captured at `2026-09-26T09:40:10.878Z`; final QA catalog at
`2026-09-26T09:45:03.314Z`. Platform identity/configuration was inspected in the
same session. Queries were bounded individually, not one cross-request snapshot;
recollect at the immutable release candidate before migration approval.

No production migration, deployment, preview enablement, credential change,
payment, bank action, provider mutation, restore or infrastructure purchase occurred.
Only run-specific synthetic users, businesses and media were created/deleted in
the existing independent local QA stack. Its owner-managed services were neither
restarted nor migrated. Other developers' dirty files were preserved.

## Environment Matrix

| Surface | Verified state | Limitation / required action |
| --- | --- | --- |
| Production application | Vercel `dpl_5WB3qn3Ayyu2DPike5xJKhf61iDW`, READY, SHA `2d94788ec2499b6ec7b9652d8b5fb2f0b898dea5`; canonical `https://adbrain.vanshul.com` | Identity-only PR25, not current dirty DB/payment work |
| Aliases | Also `adsvanz.app`, `adbrain-vanshul-goyals-projects.vercel.app`, `adbrain-git-main-vanshul-goyals-projects.vercel.app` | Alias identity does not certify every workflow |
| Vercel runtime / plan | Node 24.x, deployed region `hnd1`, Hobby | Project default region is `iad1`, overridden on this deployment; Hobby is personal/non-commercial only |
| Git rules | Deployed source intends wildcard false, main true, dev false, pilot false; actual production branch main | API did not expose the effective wildcard setting; recent history is not an enforcement test. Historical release previews exist. Treat other branches as unverified until checked before pushing |
| Environment scopes | 29 project entries, all production; no branch-specific entries; shared-team listing empty with `next=null` | Scope metadata does not prove credential uniqueness, external secret stores or absence of manual CLI overrides |
| Safe flag values | `PRODUCT_LOGGING_DATABASE_ENABLED=true`; `META_CONNECT_ROLLOUT=enabled` | Only these non-secret values were retrieved |
| Campaign mode | No project `CAMPAIGN_EXECUTION_MODE`; exact deployed route queues only when it equals `worker`, otherwise inline | No external worker host/supervisor or heartbeat was established; do not claim worker recovery exists |
| Payments | No project `PAYMENTS_TEST_ENABLED`; identity-only released source predates pending test checkout | Local test captures are not live payment or funding approval |
| Supabase production | `kmzuxrvfrwwpwmoovwcp`, ACTIVE_HEALTHY, `ap-northeast-1`, PostgreSQL 17.6 (`17.6.1.155`), organization plan Free | Host independently matches deployed public client bundle and default local configuration |
| Default local app | Default local environment points at production Supabase | Plain local startup is not isolated; do not use it for mutation probes |
| Independent QA | Project `adbrain-independent-qa-7hmbff`, workdir `/tmp/adbrain-independent-qa.7HmBFF`, API `127.0.0.1:55321`, DB `127.0.0.1:55322`, PG 17.6 (`17.6.1.165`) | Exact DB/Kong container identities and port mappings checked; published Docker bindings are `0.0.0.0` and `::`, not loopback-only |
| QA services | Supabase CLI 2.116.0; PostgREST v16.1, Auth v2.196.0, Storage v1.70.3, Kong 2.8.1 | Provider isolation applies to the new guarded probe, not every process in this shared environment |
| CI | Existing hosted release checks used Node 22, placeholders and disposable SQL tests | This change aligns CI to Node 24; not pushed or hosted-tested. No integrated browser job yet |
| Preview / staging | No separately verified isolated hosted environment | Do not enable previews or copy production credentials to create one |

Local dirty `dev` remains `9da5b07`, behind remote main/dev by two commits at this
inspection. No reset, stash, pull, branch change, commit or push was performed.

## Actual Database Matrix

Catalog scope: `public`, `private`, `storage`; relation counts include supported
table/view/sequence kinds, not customer row counts. Catalog inspection excludes
Auth application rows and does not audit Auth's internal schema.

| Metadata | Production | Independent QA |
| --- | --- | --- |
| Relations / columns | 28 / 310 | 36 / 369 |
| RLS policies / constraints / indexes | 23 / 110 / 75 | 23 / 167 / 93 |
| Functions / non-internal triggers | 47 / 10 | 57 / 9 |
| Public application table RLS | All 17 enabled; FORCE RLS false | Catalog collected; not acceptance of latest DB-A |
| Invalid or unready indexes | None among 75 inspected | Separate fresh/upgrade acceptance still required |
| Explicit column / sequence ACL rows | 0 / 0 | 0 / 0; absence of explicit column ACLs does not negate table grants |
| Custom migration ledger rows | 1 | 3 |
| Storage buckets | `brand-assets`, `creatives`, both public | Same visibility; synthetic image access verified |

Confirmed authority and compatibility findings:

- Authenticated effective table privileges include SELECT/INSERT/UPDATE/DELETE/
  TRUNCATE on campaigns, results, drafts, audit and businesses. Campaign/result/
  draft RLS policies are owner-oriented ALL policies; audit has INSERT and SELECT
  policies. RLS still constrains row operations. No production mutation exploit
  was attempted; TRUNCATE is not a normal REST operation and bypasses row RLS.
- Public-schema default ACLs for postgres and supabase_admin grant broad table,
  sequence and function privileges to API roles. DB-A must consider defaults and
  new objects, not only revoke grants on existing tables.
- Anon/authenticated cannot USE or CREATE in `private`; service_role can USE but
  not CREATE. API roles cannot CREATE in public/storage. Anon/authenticated have
  no BYPASSRLS; service_role does. Authenticator can assume the three API roles.
- Inspected Meta token/attempt and operation RPCs are service-only. Public
  SECURITY DEFINER functions have configured search paths; `set_updated_at`
  lacks one but is SECURITY INVOKER. Browser execution of intended owner/trigger
  functions is not automatically a vulnerability.
- `append_verified_audit_event` and `audit_log.authority` are absent in production
  and the inspected QA snapshot. QA's integrity constraints therefore do not mean
  the trusted-write rollout was applied. Never deploy new callers first by assumption.
- Nine QA constraints are absent in production: `campaign_drafts_business_id_id_key`,
  `campaigns_business_id_id_key`, `campaigns_budget_finite_nonnegative`,
  `campaign_results_costs_finite_nonnegative`, `campaign_results_fetched_finite`,
  `campaign_results_metrics_safe`, `campaign_results_period_order`,
  `leads_same_business_campaign`, `spend_limits_positive_cap`. These are pending
  schema differences, not proof that current production should already contain them.
- Production `llm_usage_nonnegative` is NOT VALID. This does not exempt new writes;
  legacy validation and scan/lock assessment remain outstanding. No VALIDATE ran.
- Several campaign-operation and Meta RPC definition fingerprints differ between
  production and QA. `check_rate_limit`, `owns_business`, `monthly_token_usage` and
  several other functions match. A different fingerprint requires review, not an
  automatic claim of semantic breakage or authority to overwrite the function.
- QA has optional managed-billing and private Razorpay test tables absent in
  production. Production retains legacy `meta_credentials`, absent in QA; no
  credential contents were read. Storage's extra QA Iceberg tables are platform
  version differences, not application migrations to replay.
- Both buckets have null per-bucket size/type limits. This means no bucket override,
  not unlimited service capacity. Public media is intentionally public by URL;
  object names are not an authorization boundary. Deletion/reference retention and
  production global Storage limits still need separate verification.
- Effective PostgREST exposed schemas remain **unverified**: no role-level setting
  was returned and the attempted config GET returned 404. Empty role settings do
  not establish that no schemas are exposed. Inspect the actual Data API settings
  before closing this gate.

### Migration Checksums

Every ledger entry inspected matches its repository file. This does not establish
that all historical migrations are represented in the custom ledger.

| Target | Filename | SHA-256 |
| --- | --- | --- |
| Production | `20260919_campaign_reporting_identity.sql` | `9c84ca4cd90ff2dfc94a413cde01f1b62ee5e6db9722d88ef65ef44a8d251248` |
| QA | `20260924_managed_billing.sql` | `e909484f12beed08883954fd8c5a032597870adbed88bdddaffff9f1cc3f8b7d` |
| QA | `20260924_meta_billing_events.sql` | `6866a0ad47b85c7e1a8c1c8d41a4cdcf7ed2a93a41d14bc32065250f35b67a18` |
| QA | `20260926_razorpay_test_orders.sql` | `5fd2994c835abb50de1135c1448d01ed1186c3a0fb277126c6d3e65ee0bcc471` |

Production reporting entry timestamp: `2026-09-18 20:20:08.433512+00`. Do not replay
the migration directory to fill ledger gaps. Legacy data integrity counts, table
sizes and active lock pressure were not measured by this metadata-only inspection.

## Reproducible Integration and CI Support

Delivered [catalog collector](../../scripts/check-ops-catalog.mjs),
[guarded integration runner](../../scripts/check-local-integration.mjs) and
[catalog](../../tests/ops-catalog.test.ts) /
[isolation](../../tests/local-integration.test.ts) regressions. No new test framework.

Repeat on the existing owner-managed QA stack:

```sh
env -i PATH="$PATH" HOME="$HOME" TMPDIR=/tmp \
  node scripts/check-local-integration.mjs \
  --workdir /tmp/adbrain-independent-qa.7HmBFF \
  --project adbrain-independent-qa-7hmbff \
  --docker-host "unix://$HOME/.colima/adbrain-qa/docker.sock" \
  --confirm-synthetic
```

The runner obtains local credentials in-process from Supabase status, verifies
named running DB/Kong images and published ports, rejects remote Docker endpoints,
and permits only the exact local origin's Auth/REST/Storage routes with redirects
disabled. It never loads the repository environment files or imports app/provider
execution modules. A forbidden Meta URL is rejected before transport, not called.

Two runs passed. Latest synthetic run `a3ed624e-2d21-4eaa-8a85-f4c2eb037a7f`:
real two-owner Auth creation/password sign-in; REST owner visibility, foreign-tenant
invisibility and anonymous denial; owned Storage upload, foreign upload 403 and
public download with byte-for-byte PNG equality. Run-specific cleanup returned
success, with a post-delete check for business rows. Auth/object delete responses
were checked but not independently re-listed. Zero provider calls; no schema apply.

Six focused tests pass under Node 22.12.0 and Node 24.21.0. Touched JavaScript/
TypeScript lint and workspace typecheck pass. The earlier catalog return-type
error reported in the developer handoff is resolved here. Expanded catalog SQL
also ran against real local PostgreSQL. CI YAML parsing verifies Node 24, unchanged
required commands/triggers and read-only Gitleaks permissions.

Hosted evidence belongs only to PR25: [candidate](https://github.com/vanshulgoyal101/adbrain/actions/runs/36231681960),
[PR](https://github.com/vanshulgoyal101/adbrain/actions/runs/36231909802),
[main](https://github.com/vanshulgoyal101/adbrain/actions/runs/36232093313),
[dev sync](https://github.com/vanshulgoyal101/adbrain/actions/runs/36232372608).
These passed before the current changes. This task did not run a new full coverage,
clean install, production build, integrated browser suite or hosted workflow.

QA-A CI handoff, still open:

1. Freeze candidate source plus ordered schema and service versions. The current
   shared QA snapshot is partially updated, not a clean provisioning recipe.
2. Provision a disposable synthetic `adbrain-ci-<run-id>` stack in an isolated
   runner, using the pinned CLI and reviewed configuration. Do not link to a remote
   Supabase project or inherit repository/provider secrets. Resolve published-port
   exposure using an isolated runner/firewall or loopback binding before acceptance.
3. Verify container identity before applying the candidate's local schema. Reuse
   the existing local-only schema/migration tools; test fresh and upgrade variants.
   Do not invoke the root setup launcher against the shared QA stack.
4. Execute the runner with `--docker-host unix:///var/run/docker.sock`, the explicit
   workdir/project and `--confirm-synthetic`. This Linux interface is unit-tested;
   clean Linux provisioning has not been executed in this task.
5. Add QA's actual DB-A direct-write rejection and positive application workflows.
   For browser CI, remove fixed-origin/cookie assumptions consistently, prohibit
   existing-server reuse, identify the candidate server, and block provider traffic
   server-side. Browser interception alone is insufficient.
6. Always clean only the job's own services/fixtures. Retain sanitized counts and
   failures, not raw environment/status output, cookies, HARs or database dumps.
   Make the job required only after a deterministic exact-SHA hosted baseline.

To repeat remote catalog inspection, securely supply the explicit PG connection
outside chat, then run `node scripts/check-ops-catalog.mjs --target
'host:port/database@user' --output <new-file>`. Existing target/TLS validation is
reused; files are mode 0600 and cannot overwrite an existing artifact. An approved
loopback connection still needs independent target identity, not just its address.

## Scheduler Feasibility and Cost Approval

The actual Vercel project has cron enabled for this deployment, with
`/api/cron/enforce-spend` and `/api/cron/keepalive` both at `0 6 * * *`. This is
configuration evidence only: no last successful complete sweep or delivered alert
was obtained. Neither endpoint nor worker `--once` was invoked as a health check.
The spend handler's 60-second budget, stored/unpaginated observations and missing
spend-as-zero behavior do not meet DEV-C's proposed five-minute freshness contract.

Current [Hobby rules](https://vercel.com/docs/plans/hobby) restrict use to personal,
non-commercial projects. [Cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing)
allow once/day on Hobby with up to 59 minutes' timing variation; subdaily schedules
need Pro. Pro permits minute-level scheduling but does not supply application
pagination, resumability, reliable completion or financial safety by itself.

| Proposal, not purchased | Approximate monthly USD before tax/usage | What it buys / does not buy |
| --- | --- | --- |
| Continue isolated local acceptance | $0 additional hosted infrastructure | No production recovery or unattended paid-operation claim |
| Vercel Pro | $20 platform fee, one deploying seat included | Commercial plan and subdaily cron; function usage/extra seats can add cost |
| Supabase Pro | $25 base including $10 compute credit for Micro | Daily DB backups with seven-day retention; not Storage object-byte backups |
| Combined baseline | $45 total versus currently free plans | Still cannot meet a 15-minute DB RPO with daily backups alone |
| Combined with seven-day PITR and Small compute | About $150 total: $45 + $100 PITR + $5 compute increment | Candidate recovery capacity, not a tested RPO/RTO or Storage backup solution |
| External heartbeat monitor | Healthchecks.io free tier: 20 jobs, 100 log entries/job | Requires approval to create/configure; short history at five-minute cadence |

Sources checked this session: [Vercel Pro](https://vercel.com/docs/plans/pro-plan),
[Supabase pricing](https://supabase.com/pricing),
[backup capabilities](https://supabase.com/docs/guides/platform/backups),
[monitor pricing](https://healthchecks.io/pricing/). Compute/storage/egress, object
backup destination, alerts and any dedicated worker must be separately estimated
from measured load. No worker purchase is recommended until execution-mode,
throughput and ownership requirements are settled. Obtain owner approval for the
chosen services, spending cap and recipients before any account/configuration change.

## Recovery and Alerting Gaps

Production backup API returned HTTP 200, `pitr_enabled=false`, `backups=[]`, and no
physical-backup metadata. This verifies no listed platform restore point, not the
absence of an undisclosed external backup. No restore rehearsal or usable external
backup/key-recovery evidence was supplied. Neither proposed objective is met yet.

| Scope | Proposed objective for owner approval | Required drill |
| --- | --- | --- |
| Unpaid/internal workspace | RPO <=24h, RTO <=4h | Encrypted synthetic DB and media backup/restore into an isolated target; measure elapsed recovery and data cutoff |
| Managed paid operations | Evaluate DB RPO <=15m, RTO <=2h | Appropriate backup capacity plus ledger/provider reconciliation and separately defined media RPO |
| External effects | Never assume a missing restored record means no provider action | Hold mutations until existing Meta/payment identities and uncertain outcomes reconcile |

DevOps owns the drill, QA owns independent restore acceptance; Vanshul is the
approval/escalation owner, not an assumed 24/7 responder. Name a primary on-call,
backup and delivery channel before unattended execution. Store recovery keys
separately from encrypted backups; verify synthetic token decryption without logging
keys. Database backups do not include Storage bytes or all custom role passwords.

Drill sequence: create synthetic tenant/media/operation fixtures; capture backup
and object manifest/checksums; restore into a separately verified isolated target
with cron/workers/providers disabled; verify Auth ownership, RLS/RPC/grants,
migration checksums, media bytes, draft/operation recovery and reconciliation holds;
measure RPO/RTO; destroy only drill fixtures after approved evidence retention.
Repeat quarterly and after material schema/backup changes. A production export or
restore, retention change or key action requires separate approval.

| Alert | Proposed trigger / escalation | Evidence still required |
| --- | --- | --- |
| Spend sweep silence / partial scan | For approved five-minute cadence, no completed sweep by seven minutes; completion heartbeat only after all pages/accounts accounted for | Synthetic missed/partial-run delivery to primary and backup; current daily schedule cannot satisfy this |
| Unknown/stale spend or pause outcome | Immediate critical alert; acknowledge within two minutes, escalate at five minutes | Named staffed recipients; conservative approved hold/pause policy and measured confirmed outcome |
| Worker/queue uncertainty | Oldest pending job or reconciliation exceeds its configured lease/SLO; never release uncertain liability just on expiry | Actual supervisor, concurrency, heartbeat, bounded retry and ownership records |
| Backup / restore age | Missing backup before approved RPO deadline, failed backup, or overdue quarterly restore | Real delivered notification and a verified usable restore point |
| Platform/payment failures | Sustained Auth/RPC failures, lock pressure, provider 429s, unknown orders or rejected reconciliation | Bounded thresholds from baseline, privacy-safe metrics and synthetic incident drill |

Logs or HTTP 200s alone are not delivery evidence. Use counts, freshness and bounded
correlation fields; no customer identifiers, raw leads, tokens or provider payloads
in metric labels. Existing misleading daily activity scripts are not a substitute.

## Ordered Deployment and Rollback Gate

1. Freeze dependency-complete candidate and ownership. Reverify SHA, canonical
   alias, flags, API exposure and effective branch deployment rules; retain preview
   restrictions. Do not include optional payment work merely because it shares dev.
2. Inventory actual schema/ledger and read-only legacy integrity preflight, table
   sizes, active transactions and lock budget. Stop on unexplained drift or invalid
   legacy rows without an approved preserve/quarantine/repair decision.
3. Obtain separate backup/recovery, migration and deployment approvals. A successful
   synthetic restore and identified recovery keys/media are required before risky
   production schema work. A green CI run is not migration authorization.
4. Dev must split expansion from revocation, or approve a coordinated maintenance
   alternative for the current mixed trusted-write/draft changes. Test old app/old
   schema, old app/expanded schema, new app/expanded schema and new app/contracted
   schema, including in-flight work and the chosen rollback version.
5. Expand only individually reviewed incremental SQL; preserve historical checksums
   and existing advisory lock/timeouts. Concurrent index creation requires a
   separately designed path because the current runner is transactional.
6. Adopt compatible server-owned callers; independently verify owner, wrong-owner,
   anonymous and service behavior through actual Auth/REST plus legitimate app
   workflows. Coordinate cron and worker consumers, not just web requests.
7. Contract unsafe grants only after adoption, or inside the approved quiesced
   maintenance window. Declare the minimum rollback-compatible artifact. Current
   identity-only production must not be assumed compatible with new grants/RPCs.
8. Validate staged constraints only after approved legacy resolution and lock
   assessment. Recollect catalogs and verify PostgREST cache/signature visibility.
9. Require exact-candidate hosted checks and approved publication, then verify
   actual deployment SHA/alias and affected authenticated workflows. Separately
   prove complete scheduler execution, worker ownership and delivered alerts.
10. On failure, stop promotions and affected mutations, preserve evidence, and use
    a tested compatible rollback or forward fix. Never reopen unsafe grants, drop
    evidence, replay uncertain provider calls or restore data as an improvised code
    rollback. A production restore requires its own approval and reconciliation.

OPS-A remains open for effective preview rules, Data API exposure, full credential
separation and legacy-data evidence. OPS-B remains open for approved recovery
capacity, restore/alert drills and real execution ownership. QA-A remains open for
clean provisioned Linux/browser CI and independent latest DB-A workflow acceptance.
These blockers prohibit treating this receipt as unattended managed-delivery readiness.

## O-2 Source Assembly and Resource Handoff

Worker: DevOps. Packet: QA-A infrastructure / I-0 source preparation. Board:
[O-2](../ORCHESTRATION.md). CONTRACT-BC remains DRAFT. This section records the
next concrete deliverable, not a new candidate acceptance or release approval.
The earlier QA-stack observations above remain historical; those temporary stacks
were removed. B's later independent local DB-A/F5/F8 acceptance is recognized as
documented in [the QA report](independent-acceptance-2026-09-26.md).

### Source and Reconstruction

Candidate B was reconstructed once from HEAD
`9da5b07b00e54fb552796cbcf01cc5fc7c2f02e7` and the retained QA source patch.
All **529 files**, their exact file set and their individual SHA-256 values match
manifest `9533d1d0e81069291536e6b97c020334eb1ddbf48858d31181a0181e0b5e4d13`.
Three independent copies were then produced from that verified reconstruction,
not from the moving checkout. A second verification checked every copy again.

Preserved archive SHA-256:
`e6e16fead01622d0bcb440526c2a999cf253ee51e16539e4acb85cb0276b263a`.
Applied patch SHA-256:
`d49b4ca9a469e92f8801354410758f719b8734e691ae618b39750d87ad9375b5`.
The original QA archive is unchanged; an identical copy is retained in the owned
assembly evidence directory. No Git branch, index or shared application file was
changed by reconstruction.

Twenty-eight initial/final QA fixture, reproducer, network-guard, browser/REST
probe and Playwright configuration files were preserved under a separate
`overlays/` tree. Their ordered file/hash manifest digest is
`1860936382865c32c7e07a3d0dd9e8943f33e0687dd91a63395ef170ddd4a2d7`.
They were **not applied** to any source copy. Old hardcoded workdirs, origins and
ports remain historical assumptions, not executable environment authority.
QA owns the corrected handoff and expected assertions before overlay adoption.

Local evidence, outside Playwright cleanup:

- [Assembly receipt and full current-source delta](../../.qa-artifacts/devops-qa-a-o1/assembly-3VshWY/assembly-receipt.json).
- [Exact B source manifest](../../.qa-artifacts/devops-qa-a-o1/assembly-3VshWY/source-manifest.json).
- [Independent recheck and tooling hashes](../../.qa-artifacts/devops-qa-a-o1/assembly-3VshWY/verification.json).

These ignored artifacts are local handoffs, not published CI evidence. Preserve
them and QA's original archive; do not move them into a browser cleanup directory.

### Captured Current-Source Delta

At `2026-09-26T10:35:56.095Z`, the eligible current-source file/hash array had
digest `2b028a439be8cf9d06bbffee894523ee5658c03ccef3c90227ca3e12793d97a8`.
The script rechecked file contents and the path list before completing capture.
This is a dated comparison, not an atomic freeze of ongoing worker edits.

Seven B paths differed: `.gitignore`, `AGENTS.md`, `docs/OPERATING-BRIEF.md`,
`docs/README.md`, `docs/qa/db-a-dev-a-handoff-2026-09-26.md`,
`docs/qa/remediation-plan-2026-09-26.md`, and `tests/local-integration.test.ts`.
Four paths were added: `docs/ORCHESTRATION.md`,
`docs/qa/dev2-devc-contract-o1.md`,
`docs/qa/independent-acceptance-2026-09-26.md`, and
`scripts/prepare-qa-source.mjs`. No B source path was missing. Application, SQL,
package/lock and existing CI contents matched B at this checkpoint. The Dev
handoff and Dev 2 proposal changes were independent owned documentation work,
not a conflicting application writer.

After that capture, this worker changed `tsconfig.json` as described below and
appended this receipt. Those changes are not in B or the captured delta. Any later
peer edits also require a fresh comparison; no acceptance is transferred to them.
The current checkout stays dirty `dev`; no pull, reset, stash or publication ran.

### Workspace and Resource Register

| Resource | Owner / actual identity | State and permitted use |
| --- | --- | --- |
| Reconstruction | DevOps: `/tmp/adbrain-devops-qa-a-o1-xvr7Uk/candidate-b` | 529-file baseline verified; file contents made read-only; retain for comparison, not product edits |
| Dev source | Dev: `/tmp/adbrain-dev-b-o1` | Independent writable 529-file B copy handed off for owned contract/regression work; product implementation still contract-gated |
| Dev 2 source | Dev 2: `/tmp/adbrain-dev2-devc-o1` | Same verified input, independent writable files; spend contract/regressions only until acceptance |
| QA source | QA: `/tmp/adbrain-devops-qa-a-o1-xvr7Uk/qa-candidate-b` | Independent writable 529-file B copy for QA-owned overlays and verification; no shared DB granted |
| Assembly artifacts | DevOps: `.qa-artifacts/devops-qa-a-o1/assembly-3VshWY/` | Ignored namespace; immutable receipt, source manifest, preserved archive and separate hashed overlays |
| Executions | DevOps synchronous assembly/checks; final verification PID 26758 | Completed at `2026-09-26T10:38:23.150Z`; no background execution or persistent terminal ID returned |
| App/API/DB | Proposed 4039 / 56321 / 56322 and a unique `adbrain-ci-o1-*` project | Not started or availability-checked here; conditional reservation only, no containers/volumes allocated |
| Heavy-run slot | DevOps source preparation | Released after this checkpoint; Dev then Dev 2 regression slots become eligible after QA overlay/dependency/execution readiness, not automatically dispatched |

All copies contain source only: no environment files, node_modules, Git working
repository, running server or database. Every Dev/Dev 2 corresponding file was
checked to have a different inode. Installing into one copy must not mutate shared
dependencies; no dependency install or symlink to shared node_modules was performed.
Use the current board in the shared workspace as governing instructions: B's
historical instruction files deliberately remain unchanged for source identity.
The disposable SQL harness will need separately authorized read access to the base
Git objects; a source-only copy is not a Git checkout.

Dev/Dev 2/QA own subsequent edits and must report their own overlay/source hashes.
Do not remove their allocated copies until the respective worker explicitly
releases them. DevOps retains its baseline/evidence until handoffs and durable
source retention are confirmed. No VM, listener, service, credential or provider
resource was touched. Future executions still need distinct worker ownership;
there is no cross-chat terminal dispatch in this receipt.

### Tooling and Validation

Added [source assembly tooling](../../scripts/prepare-qa-source.mjs) and two
manifest/file-set guard tests in the existing
[integration suite](../../tests/local-integration.test.ts). The script checks the
explicit HEAD and manifest digest, rejects environment/generated paths, traversal,
symlinks, duplicate entries and patch paths outside the manifest, and refuses to
overwrite existing workspaces. Occupied worker paths get a new unique suffix.
Partial failed allocations are retained for identified recovery, not silently deleted.

Reproduction, using a Node 24 PATH and this repository's Git objects:

```sh
env -i PATH="$PATH" HOME="$HOME" TMPDIR=/tmp \
   node scripts/prepare-qa-source.mjs \
   --archive .qa-artifacts/independent-qa-2026-09-26.tar.gz \
   --head 9da5b07b00e54fb552796cbcf01cc5fc7c2f02e7 \
   --manifest 9533d1d0e81069291536e6b97c020334eb1ddbf48858d31181a0181e0b5e4d13
```

Run only when another reconstruction is needed; the copies above already exist.
This command creates new allocations and does not refresh an active worker's copy.

Validation on Node 24.21.0: eight focused catalog/integration tests passed; touched
lint and editor diagnostics passed. Real reconstruction plus independent recheck
passed for the baseline and all three copies, original/archive-copy hashes and
all 28 overlays. These are source/tooling checks, not rerun B application acceptance.

Workspace typechecking initially failed in four retained `test-results` fixture
copies because their archival relative imports do not point to application source.
The [TypeScript configuration](../../tsconfig.json) now excludes only generated
`test-results` and `.qa-artifacts` in addition to node_modules. Node 24 typechecking
then passed. A compiler-input assertion verified that `src`, `tests` and `e2e`
remain included. No QA fixture or expected-failure assertion was changed or skipped.

### Next Consumer and Remaining Gates

QA's new O-2 fixture handoff was not present at this checkpoint. Browser integration
waits for that handoff; Dev and Dev 2 can draft their contracts now and adopt QA's
preserved assertions after agreeing overlays. No new runtime results are claimed
for the six failing B safety assertions or F1/F7/UI-01.

B supplies reconstructible, locally accepted DB-A-compatible **source**, not an
approved production rollback deployment. Retain it as the compatibility reference;
the minimum rollback artifact still requires a dependency-complete built candidate,
old/new/contracted-schema checks, exact hosting configuration and release approval.
Do not roll back to the identity-only production version after tightened grants
without proving compatibility, and do not release all of B's optional payment work.

Next infrastructure acceptance: isolated dependency installation and Linux/Node 24
provisioning, corrected QA overlays, exact server identity, provider egress blocking,
actual local Auth/REST/Storage, browser gates and owned teardown. None of clean Linux
CI, hosted checks, a new application build, production deployment, migration or
restore/alert execution is claimed by this assembly receipt.

## O-4 Dependency and Browser Fixture Handoff

Worker: DevOps; QA-A infrastructure. Board O-4; CONTRACT-BC remains DRAFT.
Status: **local dependency/execution readiness complete**, validated at
`2026-09-26T10:59:04.609Z`; browser fixture request **F-1 ready for QA review**.
Linux/browser acceptance remains open. This consumes
[QA's delivered O-2 handoff](qa-a-o1-handoff.md), not a request for the owner to
relay it. The O-2 note saying QA's handoff was absent is superseded.

### F-1 Origin and Auth Request to QA

Requested writer: QA. Consumer: DevOps Playwright/provisioning. Adapt QA-owned
`e2e/qa-fixtures.ts`, the five browser specs named in QA's handoff, and the preserved
Studio recovery probe into a new hashed overlay. Do not edit historical artifacts
or change product code. Keep A/B fixture provenance and UI-01's independent label
width assertion; preserved recovery success must not imply layout acceptance.

| Input / interface | Contract for the isolated browser candidate |
| --- | --- |
| `QA_APP_ORIGIN` | Initially `http://localhost:4039`; no default. If the port is occupied, DevOps assigns another port and supplies the same value to Playwright, server and fixtures. Require HTTP loopback, no credentials/path/query/fragment |
| `NEXT_PUBLIC_SITE_URL` / Playwright `baseURL` | Exactly `QA_APP_ORIGIN`. Server binds `127.0.0.1`; launcher verifies the localhost address used by the browser. Do not alternate localhost and 127.0.0.1 for app requests/CSRF |
| `NEXT_PUBLIC_SUPABASE_URL` | Initially `http://127.0.0.1:56321`; no default. Exact origin from identity-verified local Supabase status, never a repository environment file |
| `QA_SUPABASE_PROJECT_ID` | Unique `adbrain-ci-o1-<run-id>`; launcher verifies named DB/Kong containers, images and published API/DB ports before exposing credentials to tests |
| `QA_RUN_ID` / `QA_SOURCE_MANIFEST` | Fresh run UUID and accepted source-manifest digest. QA fixtures must verify the matching server identity before Auth or app mutations |
| Server identity | DevOps generates `/__qa__/identity.json` as a disposable, separately hashed public fixture overlay containing only `runId`, `sourceManifest`, `appOrigin` and `supabaseProjectId`. QA checks exact equality. Not a production route or replacement for launcher PID/port/cwd checks |
| Auth inputs | Existing `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `DEV_LOGIN_EMAIL`, `DEV_LOGIN_PASSWORD`, supplied in process from the synthetic project only. No fallback, persisted auth state file, real user or dev-auth bypass |
| Tenant fixtures | `QA_BUSINESS_ID` identifies the run-owned synthetic business. Replace hardcoded tenant assumptions where fixtures access real local state; retain deliberate fictional IDs for intercepted responses. DevOps provisions required synthetic creative/brand rows and records their IDs, without real provider bindings |
| Cookies | Keep real `createServerClient` password sign-in; derive app cookie scope from `QA_APP_ORIGIN` rather than a hardcoded domain. Preserve cookie names/chunks and required options. Never log values or put them in artifacts |
| Fixture exports | QA proposes `qaAppOrigin`, `qaApiOrigin`, `qaBusinessId`, `verifyQaServerIdentity()` and `createQaAuthCookies()` in its existing helper. Specs consume these instead of independently parsing origins or signing in with inconsistent cookie scope |

Network contract: the test-process Auth client allows only the verified API
origin's `/auth/v1` routes and refuses redirects. Browser routes allow only the
exact app origin and verified API origin's required Auth/REST/Storage paths; a
different localhost port is not trusted. Reject other HTTP(S)/WebSocket targets;
explicitly permit local non-network data/blob fixtures only where needed.
Retain stricter per-test API interception and unexpected-write rejection.
DevOps separately owns server-side egress controls and their negative probes;
browser interception does not prove server isolation or OS-level containment.

Server contract: dedicated child process, `reuseExistingServer=false`, candidate
identity and owned-port check before use. For local validation use `npm run dev`
with the configured memory limit, explicit loopback binding and allocated port;
build/start CI is a separately identified mode. No old QA launcher/guard path,
arbitrary existing server, root environment file, payment mode or cron/worker run.
Flags must keep payments, paid AI and provider mutations disabled. Tests needing
provider outcomes use fixtures while real local Auth/REST/Storage remain exercised.

QA's minimal fixture acceptance: missing/remote/mismatched origins or identity
fail before login; a foreign loopback origin is rejected; owned synthetic login
works with app-scoped cookies; stale deletion still rejects with 409; recovery
does not add POSTs; 1440/390/320 layouts include individual workflow label bounds.
Return overlay hashes, test case names and any incompatible exported interface in
QA's existing handoff. This is a fixture API request, not CONTRACT-BC acceptance.

DevOps requests the next short serialized provisioning slot for the existing
three copies. No server, database, VM or port is acquired by publishing F-1.
That provisioning slot was used sequentially and is now released as recorded below.

### O-4 Completed Local Readiness

Consumed QA manifest
`642bc8093c74d4c0689eff9b1516a65467e894854ed44dc70c7ada517d9fcce1`
and verified all 19 handed-off file hashes. No historical fixture was changed or
applied to a worker copy. QA's selected assertions remain ready for their owning
Dev/Dev 2 consumers; this checkpoint does not claim their six failures were fixed.

Each existing B copy received a separate **clean `npm ci` install**, not a clone or
symlink of shared dependencies. Runtime: Node 24.21.0, npm 11.0.0, macOS arm64.
All three added 550 packages from the public npm registry, using the same lockfile:
`9d82d5a71cedb3d12518fef5856f15a92ce46a29b4812e592d413d6e663a48b0`.
Registry URLs in the lockfile were checked before installation. Lifecycle scripts
were disabled (`--ignore-scripts`); audit/funding/update-notifier requests were
disabled. The environment was scrubbed, user npm config replaced with `/dev/null`,
and global config pointed at a verified-absent owned path. The first attempt
stopped before installation because npm rejects loading `/dev/null` twice as user
and global config; the distinct-path retry succeeded without changing source.

| Owner / allocation | Verified result | Forward ownership |
| --- | --- | --- |
| Dev: `/tmp/adbrain-dev-b-o1` | 529 B source hashes unchanged; own dependency tree; esbuild/sharp pass; three B tooling tests pass with and without the frozen unit guard | Dev may adopt its QA activation assertions and record source/overlay hashes |
| Dev 2: `/tmp/adbrain-dev2-devc-o1` | Same 529-file identity and lock; independent dependency files; native probes and three guarded/unguarded tooling tests pass | Dev 2 may adopt spend/F8 assertions in its copy |
| QA: `/tmp/adbrain-devops-qa-a-o1-xvr7Uk/qa-candidate-b` | Same source/dependency checks; three guarded/unguarded tooling tests pass; clean-copy Node 24 typecheck passes | QA may adapt its fixtures against F-1; no server/DB allocation implied |

After tests, the complete source path set excluding only node_modules still
matched B in all three copies. Package/lock and all 529 file contents are unchanged.
The installed dependency-lock digest is identical across copies:
`f0f21529292ec90545bdd9552c70cdd79fe11b5f19c66041e3f34d882f9570ca`.
Corresponding Vitest package files have different inodes. No shared package
install, symlinked node_modules, root lockfile edit or environment-file copy occurred.

Evidence:

- [Verified dependency and QA handoff inputs](../../.qa-artifacts/devops-qa-a-o1/dependencies-txxoSM/inputs.json).
- [Final source/dependency/native-binary identities](../../.qa-artifacts/devops-qa-a-o1/dependencies-txxoSM/readiness.json).
- [Guarded smoke results](../../.qa-artifacts/devops-qa-a-o1/dependencies-txxoSM/smoke-summary.json).
- [Final tooling source hashes and checks](../../.qa-artifacts/devops-qa-a-o1/dependencies-txxoSM/tooling-verification.json).

Final owned tooling validation: nine focused catalog/integration tests, touched
lint and workspace Node 24 typechecking pass. The guard's subprocess regression
now explicitly supplies `NODE_ENV=test`, as required by Next's environment type;
the initial missing-field diagnostic was fixed and the checks rerun. These hashes
identify the newer tooling overlay, not a modification to any worker's B source.

Three tests per copy prove tooling execution only, not nine different application
acceptance cases. No current full coverage, build, audit, browser, Linux, hosted
CI or real-provider certification follows from these local installs. Disabled
lifecycle scripts are intentional; actual esbuild transformation and sharp PNG
generation/decoding passed in each fresh tree. Browser binaries were not installed.

### Unit Execution Contract and Slots

Added [unit network preload](../../scripts/qa-unit-network-guard.mjs) with a
subprocess regression in the existing integration tests. It rejects global fetch,
HTTP(S), TCP/TLS and UDP construction, including loopback targets, before those
transports run. The frozen handoff copy is
[qa-unit-network-guard.mjs](../../.qa-artifacts/devops-qa-a-o1/dependencies-txxoSM/qa-unit-network-guard.mjs),
SHA-256 `31abc8b977d4cd23b7569028fcb5e95e5916d907ee1fea7e4808875a13038709`.
Its contents are read-only; use that hashed copy rather than a moving shared script.

This is a test-process guard, not an OS sandbox: native code, raw DNS, non-Node
children or deliberate replacement of patched APIs are not comprehensively
contained. It must not be reused for browser/server/real local DB runs, which need
their own exact-target policy. Expected in-process provider mocks remain permitted;
unexpected network attempts are failures, not reasons to remove the guard.

For each worker's **own terminal**, first verify its source/QA overlay identities,
then use the following environment contract. Substitute that worker's allocated
directory and selected QA test filename; adopt the file yourself from QA's hashed
handoff rather than changing shared tests. Do not use another worker's terminal.

```sh
ROOT=/Users/vanshulgoyal/Development/copilot/adbrain
NODE24_BIN=/Users/vanshulgoyal/.npm/_npx/387698761821791d/node_modules/node/bin
GUARD="$ROOT/.qa-artifacts/devops-qa-a-o1/dependencies-txxoSM/qa-unit-network-guard.mjs"
cd /tmp/adbrain-dev-b-o1
env -i PATH="$NODE24_BIN:$PATH" HOME="$HOME" TMPDIR=/tmp CI=1 \
   NODE_OPTIONS="--import=$GUARD" \
   NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co \
   NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-anon-key \
   RUN_PAID_CREATIVE_EVAL=0 PAYMENTS_TEST_ENABLED=false \
   PRODUCT_LOGGING_ENABLED=false PRODUCT_LOGGING_DATABASE_ENABLED=false \
   NEXT_PUBLIC_PRODUCT_LOGGING_ENABLED=false \
   node node_modules/vitest/vitest.mjs run tests/qa-activation-recheck.test.ts \
   -t 'QA ' --maxWorkers=1
```

The example is the **next Dev regression command**, not a command executed by
DevOps here. Dev 2 uses its allocated directory and QA's cron/instruction files.
Preserve the historical two activation and two spend failures; report failing
exit codes honestly. No skip/inversion/expected-failure wrapper in required CI.
Use a fresh run directory in each worker's reserved artifact namespace for results.

Scheduling: DevOps releases the preparation slot at this completed checkpoint;
Dev's regression slot is next, then Dev 2 after Dev records completion/release.
QA's combined acceptance waits for an identified candidate. Each worker records
its actual execution identity and release in its own receipt; these slots do not
start a terminal or wake another chat. A blocked worker yields its slot explicitly.

Retained resources: the three owner-managed source/dependency trees, DevOps'
read-only B source reference, evidence directories, and download cache at
`/tmp/adbrain-devops-qa-a-o1-xvr7Uk/npm-cache`. No active process is retained from
this checkpoint (final verification PID 82194 exited). No services, VM, container,
volume, app/API/DB port or provider resource was started. Only registry downloads
used the network. Do not remove worker trees until their owners release them;
DevOps may remove its download cache after downstream installation needs end.

Next consumers: Dev and Dev 2 can now run their owned regressions. QA reads F-1 and
returns an adapted, hashed browser overlay or a concrete interface conflict in
its existing handoff. DevOps then continues isolated Linux/server provisioning
and browser CI with fresh service/port checks. No owner transcript relay is needed.
Git checkpoints remain proposed and permission-gated; no commit, push, deployment,
production migration, credential change or provider/payment action occurred.

## O-8 Reconciliation and Allocations

Worker: DevOps, sole shared Git/lockfile integration and release executor.
O-8 source: local dev `9da5b07b00e54fb552796cbcf01cc5fc7c2f02e7`; fetched
origin/dev and origin/main `a7445f565586a2c4b484036b3bc12b01af28c7ea`.
G-1 remains shipped; none of its full checks were repeated for this checkpoint.

### Preservation and Concrete Conflict

[Private preservation manifest](../../.qa-artifacts/devops-o8/reconcile-2gWa2A/snapshot.json)
and source.tar.gz in the same private directory capture 536 tracked/nonignored
untracked source files, with a binary tracked patch and file hashes/modes.
Archive SHA-256: `d00b7b510bba4f02a5d0a5defe6c8dafd018b91bcee54c166cc90b528727503a`.
The directory is mode 0700 and artifact files 0600. Runtime secrets and ignored
private evidence remain in place, excluded from publication. No reset, stash,
checkout overwrite, deletion or branch/index advance has occurred.

Dev and Dev 2 updated their own O-8 allocation handoffs during the first source
check. The guard stopped before any Git metadata operation. Their completed
document-only changes are preserved by
[snapshot-delta.json](../../.qa-artifacts/devops-o8/reconcile-2gWa2A/snapshot-delta.json)
and its two stored overlays; the original archive remains unchanged.

Before reconciliation: 43 modified tracked paths and 31 individual untracked
files. Three modified files are byte-identical to shipped origin/dev: queries.ts,
creative-generation-route.test.ts and spend-queries.test.ts. Against current
origin/dev there are **40 genuinely pending tracked paths plus 31 untracked**.
These are file counts, not a claim that every hunk is independently releasable.
Shared HEAD is intentionally still old because the following concrete conflicts
trigger O-8's stop-on-conflicting-path rule:

- [docs/PAYMENTS-PLAN.md](../PAYMENTS-PLAN.md): local INR 10,000 annual-total/20:80
   clarification overlaps the shipped operator paragraph. Local text still says
   AdBrain will legally operate under Solaride; shipped wording says that future
   arrangement is not formalized. Preserve the new pricing work while retaining
   the shipped current-operator correction in the eventual resolution.
- [docs/ROADMAP.md](../ROADMAP.md): local operator/merchant-name clarification and
   the shipped identity-only release explanation overlap. Both must be reconciled
   without losing the unpublished roadmap work or falsifying release history.
- [tests/payment-funding-panel.test.tsx](../../tests/payment-funding-panel.test.tsx):
   local added test work omits shipped assertions for Current operator and Future
   account ownership at an overlapping hunk. Review preservation of those checks,
   not an unconditional replacement of the local test file.

[Exact conflict report](../../.qa-artifacts/devops-o8/reconcile-2gWa2A/conflict-report.json)
contains all seven shipped-path comparisons. Four merge cleanly to identical local
bytes; the three above conflict. Coordinator resolution is needed for these paths;
no generic dirty-tree blocker and no owner transcript relay is required. No source
file was modified by the comparison. Source reconciliation remains paused; clean
remote-base worktree allocation can proceed independently without touching them.

### Delivered Issue Worktrees

The coordinator's subsequent **O-9 Allocation Unblock** supersedes the default
paths in the original O-8 allocation receipt below. Default active allocations:

| Packet / writer | Current default path | Branch |
| --- | --- | --- |
| #27 / Dev 2 | `/tmp/adbrain-issue-27-o9` | `feature/issue-27-ai-sdk` |
| #28 / Dev | `/tmp/adbrain-issue-28-o9` | `feature/issue-28-tanstack-query` |

The board records both at shipped base a7445f5, clean and without dependencies at
allocation. Reuse those defaults unless an owner already started in an O-8 copy;
then retain that work and report the chosen path. Do not start two implementations,
move peer work or delete either allocation without the owner's release. The O-8
allocation below is retained provenance, not a competing current instruction.

[Allocation receipt](../../.qa-artifacts/devops-o8/reconcile-2gWa2A/allocations.json).
Both issue worktrees are clean Git worktrees at current shipped dev
`a7445f565586a2c4b484036b3bc12b01af28c7ea`, not copies of B or the dirty checkout.

| Packet / writer | Absolute path | Local feature branch |
| --- | --- | --- |
| #27 / Dev 2 | `/tmp/adbrain-o8-ePtVWk/issue-27` | `feat/issue-27-ai-sdk-o8` |
| #28 / Dev | `/tmp/adbrain-o8-ePtVWk/issue-28` | `feat/issue-28-campaign-query-o8` |

ISSUE-27/28 allocation requests are satisfied under the current defaults above.
Developers checkpointed their
prior packets; those B copies/evidence remain retained and unchanged. Begin issue
implementation in the chosen allocation. Dependencies were not installed by this
DevOps allocation checkpoint; O-8 permits
each owner to choose, audit, pin and install only its issue dependencies in its
own worktree. Do not use shared node_modules or another worker's dependency tree.
Node 24.21.0 is available at
`/Users/vanshulgoyal/.npm/_npx/387698761821791d/node_modules/node/bin/node`.
Use a scrubbed environment and synthetic inputs; no .env.local was copied.

DevOps retains final shared lockfile integration and publication. Return the tested
exact commit and dependency/license evidence in the existing receipt for the
issue-linked PR to dev; no branch has been pushed by allocation. Short isolated
unit checks may proceed independently. Reserve heavy builds/browser/DB execution
with DevOps; no such slot is held by either issue allocation.

### G2-QA-REVIEW-O8-1

G-2 candidate: `/tmp/adbrain-o8-ePtVWk/g2`, local branch
`release/o8-g2-eptvwk`, base `a7445f565586a2c4b484036b3bc12b01af28c7ea`.
Only src/components/studio.tsx and tests/studio.test.tsx differ from base.
[Frozen patch](../../.qa-artifacts/devops-o8/reconcile-2gWa2A/g2.patch) SHA-256:
`edd3bbbd593bcb51e6a58f87120fb402656a7d3c283ffd177b5bda841ad05410`.
The allocation receipt records both file hashes. No new package/config/schema
dependency is included. Patch application and whitespace checks passed. QA may
review these exact bytes now, separately
from the conflicted docs/payment work. Keep UI-01 and durable server-intent/quota
limitations explicit. Existing B acceptance is not automatic new-candidate review.

G-2 author checkpoint is complete: Node 24.21.0/macOS, isolated 538-package
install, [30 Studio tests pass](../../.qa-artifacts/devops-o8/reconcile-2gWa2A/g2-studio-tests.json),
[touched lint and types pass](../../.qa-artifacts/devops-o8/reconcile-2gWa2A/g2-checks.json),
and [Gitleaks exact-patch scan is clean](../../.qa-artifacts/devops-o8/reconcile-2gWa2A/g2-gitleaks.json).
The first wrapper had an extra brace and never started tests; corrected runner
passed without source/test changes. The focused suite includes refusing paid work
when recovery identity cannot be persisted. No new browser run is claimed.

The patch remains byte-identical to the review input. G-2's package-lock is
identical to the audited G-1 lock, and its Studio source is byte-identical to the
retained B source. Reuse G-1's unchanged baseline/dependency evidence; QA must
judge applicability of prior recovery evidence rather than treating matching one
file as automatic full browser acceptance. No G-1 full-suite replay occurred.

QA's latest completed O-8 receipt accepts G-1's completed evidence, but predates
the new G-2 input. The updated board explicitly dispatches G-2 review against this
handoff; missing input is no longer a blocker. Required
next response: exact-diff G-2 review and acceptance of applicable recovery evidence
or a concrete missing check. No publication permission is missing. No new commits,
pushes or PRs were made in this O-8 checkpoint; backlog publication has not begun.

The G-2 validation slot is released; no local app/DB server is running. Preserve
the issue allocations and G-2 source/dependencies. Publication waits for exact-scope
QA review and required hosted checks. Remaining DB-A,
disabled test-payment, ops/tooling and public-doc batches follow in O-8 order with
their own dependency-complete diffs/reviews. No SQL application, provider operation,
new feature scope or blanket dirty-tree staging is authorized by this handoff.

## O-6 G-1 Production Release

Latest G-1 status: **SHIPPED AND VERIFIED; protected promotion, production workflow
and all four hosted CI runs PASS; remote dev/main synchronized**. This supersedes the
earlier preparation/publication-pending checkpoints below. G-2 was not included.

| Release evidence | Exact identity / result |
| --- | --- |
| Candidate commit | `a36eeec0d9c2b4f32799b1107f7ee8665eb9e176`, only three approved files |
| Protected PR | [PR #26](https://github.com/vanshulgoyal101/adbrain/pull/26), merged after current required checks, with approved-head guard and no bypass |
| Production merge | `a7445f565586a2c4b484036b3bc12b01af28c7ea`, merged September 26 at 11:46:51 UTC |
| Identical tested/merged Git tree | `053458331b9716bbb5bcf7782006051133ed223b` |
| Exact-head dev CI | [36239442256](https://github.com/vanshulgoyal101/adbrain/actions/runs/36239442256): build/secrets PASS |
| PR CI | [36239700899](https://github.com/vanshulgoyal101/adbrain/actions/runs/36239700899): build/secrets PASS |
| Main merge CI | [36239886796](https://github.com/vanshulgoyal101/adbrain/actions/runs/36239886796): build/secrets PASS |
| Dev synchronization CI | [36240317228](https://github.com/vanshulgoyal101/adbrain/actions/runs/36240317228): build/secrets PASS at the production merge |
| Production deployment | `dpl_HWNBcCLv2udbE6j3S4ojhkm9L4kD`, READY at exact merge SHA, main/production, hnd1, Node 24.x |
| Canonical alias | `adbrain.vanshul.com` assigned to that deployment, aliasAssigned true, aliasError null; GitHub Vercel commit status success |
| Remote synchronization | Normal fast-forward dev from candidate commit to production merge; shared dirty local dev not moved, reset, stashed or merged |

Independent QA's code-review approval and local checks are recorded below; hosted
Linux/Node 22 application-runtime results above are separate evidence. GitHub
Actions warns about Node 20 action-runtime deprecation/forced Node 24 execution
and the upcoming ubuntu-latest image change. These were warnings, not failed
checks; no unrelated CI version change was bundled to suppress them.

Production verification used the existing authenticated owner session and
canonical origin after READY/alias verification:

- Brand Brain response HTTP 200, completed server HTML, instruction-guidance
   section present, no instruction-load/application-error text in the readback.
- Brand Brain heading and nonempty instruction-guidance section visibly rendered.
   This page directly invokes getAdInstructions for the authenticated business.
- Authenticated generation-status GET with missing parameters returned 400;
   anonymous generation POST with an empty body returned 401. Both had request IDs.
   These stop before paid generation; no valid generation request was sent.

The initial browser visibility assertion timed out. Diagnosis showed a hidden
embedded page with loaded Next runtime and completed content still in React's
hidden S:0 stream container; bringToFront did not change document visibility.
Temporary Chromium focus emulation made the page visible and the **unchanged**
heading/guidance assertions pass. Focus emulation was disabled and detached in
finally. No DOM patch, application change, assertion relaxation or production
configuration change was used to produce this result.

This is deployed read-path and API-guard verification, not a production DB-failure
injection, paid-generation test, Meta consent test or independent QA production
acceptance. The instruction-error/paid-call suppression behavior is proven by
local regression checks and reviewed source, not by inducing an outage remotely.
No schema/data migration, credential change, preview enablement, payment, campaign
activation/spend or unrelated customer operation occurred.

Compatible rollback remains a tested, reviewed code-only revert PR. Previous
deployment `dpl_5WB3qn3Ayyu2DPike5xJKhf61iDW` was independently verified READY at
`2d94788ec2499b6ec7b9652d8b5fb2f0b898dea5` before merge. No data rollback is needed;
reverting G-1 restores the old instruction-error fallback. No rollback performed.

PR creation initially failed through the extension's enterprise-managed account.
The existing CLI account was verified as repository owner vanshulgoyal101 and
used instead; no credentials or protection rules were changed. CLI CI watchers
use PAGER/GH_PAGER=cat and non-TTY output to avoid alternate-screen capture issues.

Local heavy slot is released. All owned PostgreSQL harness/probe processes are
stopped and their temporary clusters cleaned; no local app server was started.
Retain the clean G-1 worktree, dependencies and frozen evidence for QA's runtime
receipt review. Other workers' source copies, services and artifacts are untouched.
No release gate remains open. The coordinator owns board updates; QA owns its
independent acceptance follow-up. Validation browser tabs were no longer present
at cleanup; no browser session or local process remains held by this release.

[Final public release receipt](https://github.com/vanshulgoyal101/adbrain/pull/26#issuecomment-5846077710)
and [immutable local receipt](../../.qa-artifacts/devops-qa-a-o1/g1-o6-CMzc2X/release-receipt.json)
bind the reviewed source, exact commits/tree, all four hosted runs, deployed
workflow results and hashes of 24 retained evidence files. Local receipt SHA-256:
`69dfdd25f51f2156d886e7abf205f50123e30fc58fc9f967e938e17b2b297267`.

## O-6 G-1 Frozen Review Candidate

### Release Dispatch Execution

Latest checkpoint: **local release gates PASS; G-1 committed and pushed to dev**.
Commit `a36eeec0d9c2b4f32799b1107f7ee8665eb9e176`, based directly on
`2d94788ec2499b6ec7b9652d8b5fb2f0b898dea5`, contains only the approved three files.
All 504 source hashes and the exact staged diff matched the frozen identity after
testing. Normal fast-forward push succeeded; no force, shared-tree branch switch,
unrelated staging or production deployment. Exact-head hosted CI is the next gate.

[QA's independent review](qa-a-o1-handoff.md#o-6-g-1-independent-code-review)
is complete: ACCEPT FOR SCOPE, no blocking findings, bound to the same manifest,
base and diff. The retained QA diff and candidate.json hashes were independently
compared before commit. This satisfies the code-review gate, not hosted or
production verification.

Candidate-local checks, Node 24.21.0/macOS, isolated clean install (538 packages):

| Gate | Result / evidence |
| --- | --- |
| Query, generation, assistant and planner suites | [108 passed, seven files](../../.qa-artifacts/devops-qa-a-o1/g1-o6-CMzc2X/focused-tests.json), single worker, unit network guard |
| Full lint and typecheck | [Both exit 0](../../.qa-artifacts/devops-qa-a-o1/g1-o6-CMzc2X/candidate-gates.json) |
| Full coverage, inherited thresholds | [1,723 passed, one existing skip, zero failed](../../.qa-artifacts/devops-qa-a-o1/g1-o6-CMzc2X/coverage-ci-tests.json); statements 80.89%, branches 74.19%, functions 80.40%, lines 83.22% |
| Dependency audit / production build | [Both exit 0](../../.qa-artifacts/devops-qa-a-o1/g1-o6-CMzc2X/ci-parity-gates.json); zero dependency vulnerabilities; all 55 static pages generated |
| Secret scan | Homebrew-installed, checksum-verified Gitleaks 8.30.1; [exact frozen diff has no leaks](../../.qa-artifacts/devops-qa-a-o1/g1-o6-CMzc2X/gitleaks.json) |
| PostgreSQL fresh/ordered upgrade | [Exit 0](../../.qa-artifacts/devops-qa-a-o1/g1-o6-CMzc2X/postgres-locale-gate.json), [all harness checks pass](../../.qa-artifacts/devops-qa-a-o1/g1-o6-CMzc2X/postgres-locale.log); disposable Unix-socket cluster only, no remote DB |

Two runner setup failures are retained, not hidden or attributed to product bugs.
The first coverage attempt used logging kill switches and the unit-only blanket
network monkeypatch, breaking logging and injected-DNS assertions (15 failures).
Removing those runner overrides in a scrubbed CI-equivalent environment made the
48-test discrimination probe and full coverage pass; no assertion/source change.
Accepted full coverage is not an OS-network-isolation claim. Only synthetic CI
Supabase values were supplied; no production/provider credentials or env files.
The first PostgreSQL start failed with macOS's `postmaster became multithreaded`
locale diagnostic. The unchanged harness passed with `LC_ALL=C`, `LANG=C`.
The failed probe log is retained; its stopped, owned temporary cluster was removed.

Pre-publication controls verified: Vercel project
`prj_LNNhyKmbQYXyBUNadG2hZJSLDjOw` links GitHub vanshulgoyal101/adbrain,
repository root (`rootDirectory:null`), main production branch and Node 24.x;
build/install/output overrides are null and no ignored-build command is set.
Candidate vercel.json exactly matches the published base: wildcard/dev false,
main true. Per the coordinator's official-reference verification, this is the
controlling Git-trigger configuration. Main protection is current: admins enforced,
strict required build/secrets, zero required reviewer approvals, force/deletion off.

DevOps has acquired the next unoccupied heavy slot under G-1 Release Dispatch.
Dev's baseline execution is released; Dev 2's saved run is queued, not active.
The process/CWD check found no other active AdBrain test execution. Reserved:
`/tmp/adbrain-devops-g1-o6-ywKKhr/candidate`, its new isolated dependencies,
DevOps npm cache and G-1 evidence namespace. No worker source or service is reused.
This reservation supersedes the earlier queued-test status below until released.
Run candidate checks now; retain independent QA review and protected Git gates.

The coordinator's documented Vercel configuration interpretation supersedes the
earlier absent-dashboard-map blocker below. Verify linked repository/root and
unchanged published configuration before push, not a nonexistent API branch map.

Worker: DevOps, current sole release executor. Board O-6 authorizes G-1/G-2 dev
publication and protected production promotion after technical gates. It does not
authorize production data/schema, credential, paid infrastructure or provider
mutations. Earlier publication-pending statements in this receipt are historical.

Checkpoint: **G-1 assembled and structurally verified; independent QA review and
runtime acceptance pending**. No commit, push, PR or deployment occurred here.
G-2 publication must wait for G-1's required exact-head hosted checks.

Fetched origin on September 26. Both origin/dev and origin/main resolve to
`2d94788ec2499b6ec7b9652d8b5fb2f0b898dea5`; shared dirty dev remains
`9da5b07b00e54fb552796cbcf01cc5fc7c2f02e7`. No reset, stash, pull, branch switch
or worker-copy mutation was performed in the shared checkout.

| Identity | Frozen value |
| --- | --- |
| Candidate base | `2d94788ec2499b6ec7b9652d8b5fb2f0b898dea5` |
| Local branch, not published | `release/o6-g1-ywkkhr` |
| Isolated worktree | `/tmp/adbrain-devops-g1-o6-ywKKhr/candidate` |
| Source manifest | `910fc4b0e57d6c7de44d686fb2b72095b298c996d119ecc9bce93efde57ff334` (504 tracked source files; tracked .env.example excluded from manifest and not loaded) |
| Exact review-diff SHA-256 | `de031df87ca155b3fc72fe804eb52fdf703c0f1d0f4f79a3129dc7bd1ac4782d` |
| Captured | `2026-09-26T11:08:54.529Z` |

The only changed files are:

- [Instruction queries](../../src/lib/supabase/queries.ts): reject a database error
   with a sanitized message instead of treating missing instructions as empty.
- [Query regressions](../../tests/spend-queries.test.ts): both instruction helpers
   reject unavailable reads, while successful empty instructions remain valid.
- [Generation regressions](../../tests/creative-generation-route.test.ts): failed
   instruction reads stop generation/regeneration before paid work and do not leak
   the private error string.

Diff: 37 insertions, one deletion across exactly three files; five added cases.
No schema, package/lock, runtime, environment, Studio, payment or deployment-config
change is included. The three candidate file hashes match the source bytes taken
from the shared checkout. Base patch application, exact path-set and whitespace
checks passed. No new G-1 runtime-test, clean-install, build or secret-scan pass is
claimed. Local `gitleaks` was not found. Required checks remain gates, not waivers.

### G1-QA-REVIEW-1

Next consumer: QA, using its existing acceptance receipt. Review this **exact**
base and diff, not the current moving workspace or B's earlier acceptance:

- [Candidate manifest, file hashes and allocation](../../.qa-artifacts/devops-qa-a-o1/g1-o6-CMzc2X/candidate.json).
- [Exact isolated-candidate diff](../../.qa-artifacts/devops-qa-a-o1/g1-o6-CMzc2X/review.diff).

Return accept-for-scope or concrete findings bound to the review-diff digest and
base above. Check safe error propagation, legitimate empty instructions, tenant
filter preservation, and no paid calls after instruction-read failure. No general
release approval or production behavior is inferred from a code review. Any
candidate-byte change reopens review and affected checks.

DevOps next runs touched lint/types and affected query/generation/assistant/planner
suites on this worktree with isolated dependencies/configuration after the Dev
then Dev 2 regression slots release, as required by O-6. Their latest saved
receipts contain no completed regression-slot release at this checkpoint; no
active process was interrupted or their slots silently reassigned. QA can review
the frozen diff now without holding a heavy-run slot.

Before push, reverify remote dev and its effective deployment policy; this
candidate inherits checked-in `dev:false`, wildcard false, main true, but source
configuration alone is not new remote enforcement evidence. Preserve normal
fast-forward publication and required hosted checks. Before production, build the
dependency-complete candidate, complete independent acceptance and compatible
rollback checks, then use the protected PR path and verify exact deployment plus
the affected workflow. No schema rollback is needed by G-1 itself; its code-only
rollback must still be reviewed against the then-current deployed environment.

Fresh read-only Vercel API checkpoint at approximately 11:12 UTC: project
`prj_LNNhyKmbQYXyBUNadG2hZJSLDjOw` returned HTTP 200, production branch main,
runtime 24.x; environment metadata returned HTTP 200 with 29 entries, zero preview
targets and zero gitBranch overrides. No values were output. No ignored-build
command was configured. The project response does not expose a deployment-disable
map; the Git settings view likewise provides no verified effective wildcard/dev
rule. Remote enforcement remains an unresolved pre-publication check, not a
reason to change settings or run a speculative deployment.

Local structural validation passed: five new receipt links resolve; all 504
manifest files, manifest digest and frozen diff digest match; exact three-file
scope and whitespace checks pass. Editor diagnostics report no receipt errors.
These are source/document checks, not G-1 runtime acceptance.

Resources held: the G-1 worktree/local branch and immutable review artifacts under
`.qa-artifacts/devops-qa-a-o1/g1-o6-CMzc2X/`. No dependencies, server, listener,
database, background process or heavy-run slot was acquired for G-1. Do not prune
older workers' stale worktree registrations as part of this release. Retain this
candidate for QA; release/cleanup only after acceptance/publication or explicit
replacement. The central board and QA's files were not edited.

## O-6 QA-F1-SETUP-1 Response S-1

Next consumer: QA. This is the concrete **setup contract for fixture conversion**,
not a claim that a synthetic server/database or seed run exists. Actual runtime
IDs and rows are supplied by the forthcoming DevOps launcher only after target
verification. No service-role credential is added to the F-1 fixture interface.

Run the seven draft cases as separate, serialized Playwright invocations: three
draft-connect widths, three saved-draft widths, and one guided-draft case. Each
invocation gets a fresh run-owned user and business, so a failed prior case cannot
leave drafts or creative selections in the next case's state. Existing F-1
`QA_RUN_ID`, `QA_BUSINESS_ID`, login inputs and server identity all refer to that
case's tenant. Each run still verifies the frozen application/overlay identity.

DevOps supplies `QA_SEED_MANIFEST_JSON`, a JSON string parsed once by the QA helper,
with this exact field contract. Credentials are separate in-process Auth inputs,
never fields in this manifest:

| Field | Required value / validation |
| --- | --- |
| `schemaVersion` | Literal `1` |
| `runId`, `sourceManifest`, `businessId`, `ownerId` | Run UUID, accepted source digest, QA_BUSINESS_ID and actual synthetic Auth user UUID; compare against verified server identity and authenticated user |
| `caseId` | One of `draft-connect-1440`, `draft-connect-390`, `draft-connect-320`, `saved-draft-1440`, `saved-draft-390`, `saved-draft-320`, `guided-draft-390` |
| `connectionCreativeId` | Actual run-scoped approved creative UUID for draft-connect, otherwise null |
| `savedCreativeId` | Actual run-scoped approved creative UUID for saved/guided cases, otherwise null |
| `guidedDraft` | Null except guided case; then the actual owner-readable draft DTO: `draftId`, `version`, `input`, `expiresAt` |

Missing/inconsistent manifest data fails setup; no fixed UUID fallback or fabricated
draft identity. QA can implement the parsing/fixture conversion with synthetic
helper tests now. DevOps must subsequently prove the real seed and cleanup contract
before any runtime browser acceptance.

DevOps-owned preconditions before each invocation:

1. Verify the exact isolated project and source/server identities, create the
    synthetic user/business, and retain only this case's object IDs for cleanup.
   Business has solar vertical, Bengaluru location, brand name `F1 Solar QA`,
   description `Synthetic rooftop solar consultation business`, and website
   `https://example.test` (fixture data only; never fetched). No Meta credential,
    selected account/Page, campaign, operation or lead-form row is seeded.
2. Draft-connect creative: `brief="Local connection test"`, `angle="Value"`,
    `headline="Connection journey fixture"`, `primary_text="Local synthetic fixture"`,
    `cta="Book Now"`, `image_url="/solar-example.jpg"`, `status="approved"`.
    Saved/guided creative: `brief="Draft lifecycle fixture"`,
    `headline="Saved draft fixture"`, same usable local image and approved status.
    Each belongs to QA_BUSINESS_ID. Image availability/bytes are a launcher check.
3. Connection and saved-draft cases start with zero drafts for their new business;
    the UI creates them through the real authenticated draft route. The guided case
    has exactly one owner-readable, unexpired draft created by the setup hook using
    synthetic owner authority. Read back database-assigned id/version/expiry rather
    than inventing metadata. Input: name `Guided consultations`, goal
    `Leads around Jaipur`, mode guided, savedCreativeId, dailyBudgetRupees 550,
    leadFormId null, abTest false; AI location Jaipur excluding Ajmer and manual
    ages 25..55. No provider-backed planning is run.

QA replaces direct admin draft SELECTs in draft-connect with the existing
owner-authenticated `GET /api/campaign-drafts/{id}`. Its response is
`{ok:true,data:<draft DTO>,requestId}`; keep the same input/version assertions.
Use the F-1 exact app-origin request guard and session cookies. The guided planner
interception returns `{ready:true,draft:seed.guidedDraft}` and performs no admin
insert. Keep the real UI create/edit/delete and stale-delete **409** checks.

Reset/cleanup belongs to DevOps, not QA's browser process. After browser contexts
and the dedicated server have stopped, the launcher removes only that case's
synthetic dependent drafts/media/creatives/business/user in dependency order and
verifies no retained run-owned rows/objects. It must use the recorded target and
IDs, never blanket-delete tables, another case, or another worker's fixtures. A
failed cleanup retains a sanitized run-ID/error receipt and blocks reuse; do not
hide it by recreating fixed UUIDs. A separate case invocation is the reset boundary,
so QA needs no new setup HTTP API or service-role secret.

Required QA return: converted two-spec overlay and manifest hashes, seven case
selectors, seed-schema/helper checks and any mismatch with these preconditions.
This does not transfer runtime seeding ownership to QA or change G-1's release
scope. DevOps implementation and real Auth/REST/Storage/browser validation follow
the scheduled infrastructure slot; S-1 is not a completed seed/provisioning result.