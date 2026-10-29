
# Operations and Troubleshooting

Use this guide for diagnosis, not as blanket authorization for remote changes.
[Release policy](releasing.md) governs publication/migrations/credentials;
[Observability](observability.md) defines safe logs and operator queries.

## Pages

| Page | Use it for |
| --- | --- |
| [Runbooks](runbooks/README.md) | Symptom table and one runbook per incident type or hand-over |
| [Privacy requests](privacy-requests.md) | Access/deletion requests, Meta data-deletion callbacks |
| [Spend guardrails](spend-guardrails.md) | Caps, auto-pause, operator-funded runs |
| [Scheduled jobs](scheduled-jobs.md) | What runs when, and how to check it |
| [Backups and data safety](backups.md) | Retention, backups, restore |
| [Deployment setup](deploy.md) | Prepare a target, configure it, smoke-test and promote |
| [Release workflow](releasing.md) | Startup fast path, enforced controls, database and credential safety, deploy train |
| [Release recovery](releasing-recovery.md) | Backups and restore, rollback, production guard |
| [Observability](observability.md) | What is logged, privacy, enablement, retention |
| [Observability queries](observability-queries.md) | Read-only operator SQL and verification |
| [Configuration](configuration.md) | Every environment variable, default and restart/cost note |
| [Payments configuration](configuration-payments.md) | Live checkout switch and payment amounts |

## Before Taking Action

Record the affected environment, exact deployment SHA, route, approximate time,
safe request ID, business UUID, and relevant local operation/draft identifiers.
Do not collect passwords, tokens, full request bodies, lead data, or raw provider
errors. Establish whether a request was read-only, paid, or externally mutating.

A failed response does not prove no side effect occurred. A successful response
can be partial, and a local row is not authoritative proof of remote delivery.
Inspect durable evidence before retrying anything that can create objects or spend.

### First Response

1. Identify the failing target: deployment SHA, Supabase origin, owner/business
	scope and last known good request. Do not load the owner checkout's
	`.env.local` to discover values; it targets production.
2. Preserve the original request/operation identity and existing successes.
	Separate a timeout from a confirmed remote rejection. Never retry a creation,
	payment or activation with a fresh key to get past an error.
3. Start with scoped logs, saved status and read-only metadata. Compare the
	deployed handler and schema with the [API](../api/README.md) and
	[data](../architecture/data-model.md) guides. A migration file is not proof its objects exist remotely.
4. If the core loop is broken after a deploy, roll back first and debug second
	(see [Production guard](releasing-recovery.md#production-guard)). Migrations, production
	settings, secrets, money and rollback are DevOps-owned; dashboard access is not
	permission to change them.
5. Verify the fix through the original workflow. Opening Campaigns or Leads can
	auto-sync (below), and a homepage 200 is not an authenticated recovery.

### Process and Probe Safety

| Action | What it can do |
| --- | --- |
| Read logs, Git status or reviewed metadata queries | Diagnosis only; still protect identifiers |
| Open Campaigns or Leads, or press Sync/Refresh | Each page auto-syncs from Meta when this browser's last sync is over 15 minutes old and saves campaigns/leads; Refresh also runs spend enforcement and can pause campaigns |
| Call a cron URL or `gh workflow run scheduled-jobs.yml` | Keepalive prunes old product events; enforce-spend can pause campaigns; sync-leads imports leads. All are GET (see [Scheduled Jobs](scheduled-jobs.md#scheduled-jobs)) |
| `npm run smoke:core` | Signs in to production, views pages and prepares one campaign review without sending it, then deletes that draft |
| `npm run ui-gate` | UI gate (#417): screenshots, axe violations, LCP and CLS for the homepage, sign-in and six owner screens at 390 and 1440 px, read-only with the smoke account. `--origin http://localhost:3000` for an after run, `--compare <before dir>` fails if anything got worse, `--public-only` skips sign-in (home, sign-in, ideas). Output goes to the ignored `.superpowers/ui-gate/`. CI's `ui-gate` job runs `--public-only` on PRs touching `src/app` or `src/components`, base vs PR on one runner (not required; screenshots uploaded on failure) `--low-end` (#1226) walks the same pages at 360 px on slow 4G (150 ms, 1.6 Mbps) with a 4× slower CPU. At phone widths the report also lists tap targets under 44 px (hit-tested; report-only). |
| `npm run worker:campaigns -- --once` | Claims and executes one queued job; can create paused Meta objects |
| Local QA `setup`, seed, backfill or migration scripts | Write their target database and possibly Auth/Storage; inspect guards and target first |

Do temporary local work in your own worktree under `adbrain-wt/` with the local
Supabase project ([launcher modes](configuration.md#local-launcher-modes)). Start
servers with `npm run dev` for its memory limit and stop them after validation.
Never stop another worker's process, reuse its test database, delete its
artifacts or switch the shared branch.

## Release and Incident Records

For each incident or deployment record: symptom, confirmed cause, affected scope,
authorized actions, exact SHA/migration state, checks performed, residual risk,
and follow-up owner. Keep records in the issue or PR.
Avoid asserting live-provider success from mocks or assuming a merged migration
has run remotely. Monitoring events currently have no built-in alerting service;
operational alert ownership must be established separately.
