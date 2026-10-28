# Operations and Troubleshooting

Use this guide for diagnosis, not as blanket authorization for remote changes.
[Release policy](RELEASING.md) governs publication/migrations/credentials;
[Observability](OBSERVABILITY.md) defines safe logs and operator queries.

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
	deployed handler and schema with the [API](API_REFERENCE.md) and
	[data](DATA_MODEL.md) guides. A migration file is not proof its objects exist remotely.
4. If the core loop is broken after a deploy, roll back first and debug second
	(see [Production guard](RELEASING.md#production-guard)). Migrations, production
	settings, secrets, money and rollback are DevOps-owned; dashboard access is not
	permission to change them.
5. Verify the fix through the original workflow. Opening Campaigns or Leads can
	auto-sync (below), and a homepage 200 is not an authenticated recovery.

### Process and Probe Safety

| Action | What it can do |
| --- | --- |
| Read logs, Git status or reviewed metadata queries | Diagnosis only; still protect identifiers |
| Open Campaigns or Leads, or press Sync/Refresh | Each page auto-syncs from Meta when this browser's last sync is over 15 minutes old and saves campaigns/leads; Refresh also runs spend enforcement and can pause campaigns |
| Call a cron URL or `gh workflow run scheduled-jobs.yml` | Keepalive prunes old product events; enforce-spend can pause campaigns; sync-leads imports leads. All are GET (see [Scheduled Jobs](#scheduled-jobs)) |
| `npm run smoke:core` | Signs in to production, views pages and prepares one campaign review without sending it, then deletes that draft |
| `npm run ui-gate` | UI gate (#417): screenshots, axe violations, LCP and CLS for the homepage, sign-in and six owner screens at 390 and 1440 px, read-only with the smoke account. `--origin http://localhost:3000` for an after run, `--compare <before dir>` fails if anything got worse, `--public-only` skips sign-in (home, sign-in, ideas). Output goes to the ignored `.superpowers/ui-gate/`. CI's `ui-gate` job runs `--public-only` on PRs touching `src/app` or `src/components`, base vs PR on one runner (not required; screenshots uploaded on failure) `--low-end` (#1226) walks the same pages at 360 px on slow 4G (150 ms, 1.6 Mbps) with a 4× slower CPU. At phone widths the report also lists tap targets under 44 px (hit-tested; report-only). |
| `npm run worker:campaigns -- --once` | Claims and executes one queued job; can create paused Meta objects |
| Local QA `setup`, seed, backfill or migration scripts | Write their target database and possibly Auth/Storage; inspect guards and target first |

Do temporary local work in your own worktree under `adbrain-wt/` with the local
Supabase project ([launcher modes](CONFIGURATION.md#local-launcher-modes)). Start
servers with `npm run dev` for its memory limit and stop them after validation.
Never stop another worker's process, reuse its test database, delete its
artifacts or switch the shared branch.

## Privacy Request Operations

Before publishing the Settings request controls, DevOps applies the reviewed
`20260930_privacy_requests.sql` migration to the verified target and records the
ledger checksum. Identify the real owner-controlled operator account through
authenticated readback, then register its user UUID in
`private.privacy_request_operators` using the authorized database administration
channel. Never infer the operator from an email, grant a public table policy, or
paste identifiers into a public issue. A new installation has **no** active
privacy operator by default; without one, the operator queue is 403 and the
request channel is not operational. Revocation sets `revoked_at` on that private
row. This registry is separate from payment/refund operators.

For this Production release, the migration ledger matches SHA-256
`02a409069475caff00872c9de31296771d0669bf852f5e5034f7f876a47d972c`. The
owner-confirmed account was resolved through the sole restored Settings row and
its auth/business owner binding. Readback found one active operator, request and
operator RLS enabled, service-only operator RPC execute, and zero requests.

After deployment, use a bounded synthetic request from an owner-controlled
account to confirm that Settings reports Received, the operator queue shows the
same request, and the operator can mark it In review; confirm the owner sees that
status after reload. Do not mark Completed until manual verification, export or
deletion work is actually finished. Review the oldest Received/In review requests
regularly at `/settings/privacy-requests`; this page and its status actions require
the private operator grant, and ordinary customers receive 404. Contact the owner through a verified secure channel for scope and
delivery. The API does not send email, automatically export data or delete records.
Financial/security retention and provider-held Meta data remain separate.

## Incident Playbooks

| Symptom | Inspect | Recovery / avoid |
| --- | --- | --- |
| Sign-in or redirect failure | Supabase availability, configured site/callback URLs, browser cookie state, safe redirect policy | Retry intended method; use local path destinations, never bypass authentication |
| Workspace stays loading or shows an error | In a visible session, compare the request and streamed response with Supabase auth and business-read failures; a fallback HTTP 200 alone is not a completed workspace | Use Try again to refetch the failed segment, or Sign in if the session expired. Check auth and business-read availability before treating an empty workspace as a first run; do not reset saved state or bypass the route guard |
| Brand autofill fails | URL validation, public DNS/fetch reachability, provider availability | Enter fields manually; do not disable SSRF protection or overwrite concurrent edits |
| Generation fails before starting | Ownership, monthly aggregate RPC, receipt column, references, keys/model, rate limit | Repair verified configuration/schema; do not disable quota because usage is unknown |
| Browser loses generation result | GET recovery by business/generation UUID and expected count | Recover saved rows first; a generation UUID now fences replay and unknown paid outcomes |
| Partial generation | Saved count and per-variant failures | Keep successes, review before a deliberate additional paid request |
| Image/composition failure | Provider/reference compatibility, bounded raster validation, upload/render stage | No silent raw-photo substitution; uploaded sources may need later cleanup |
| Draft conflict/expiry | Latest version, expiry, operation linkage | Reload/review; expired draft requires new intent, not an expiry extension hack |
| Create times out | Original idempotency key, operation phase/lease/external IDs | Poll/lookup first; never choose a new key to evade uncertainty |
| `needs_reconciliation` | Checkpoint IDs, local campaign, correct bound Meta account/Page | Authorized operator reconciles actual objects; preserve evidence, no blind recreate/delete |
| Activation blocked | Current capability, generation/digest, binding, form/budget/spend evidence | Recheck and re-review; never relabel a different campaign to fit the connection |
| Sync incomplete | Cursor, skipped count, account/Page binding, status, save error | Continue pages or retry failed page; do not prune local rows based on one page |
| Refresh result cannot be saved | `campaign_results` persistence and request logs | 503 before summary/enforcement; inspect the saved row before retrying, and verify delivery in Meta |
| Spend protection unconfirmed | Refresh `protectionConfirmed:false` or cron `ok:false`, stored binding, provider insight period/currency, remote/local pause state | Confirm the campaign status in the original Meta account; repair reporting/connection/storage before retry. Do not read an empty `autoPaused`/`swept` as a safe spend total |
| Leads partly sync | `failedForms`, newly inserted count, `sync.hasMore`, reload result | Keep saved rows and retry failed forms after a permission fix; `sync.hasMore` means the import is incomplete. Repeated IDs are ignored, not counted as new leads |
| Disconnect fails | Explicit business UUID, owner check, RPC/schema availability | Keep existing UI state until confirmed; disconnect is not an emergency pause |
| Telemetry missing | Enable flags, applied migration, hosting logs, retention, request cap | Events are best effort; a missing event does not prove no action occurred |

### Creative Generation Reconciliation

The `creative_generation_reconcile` RPC is installed in Production under migration
checksum `99d1be625171c48dee4cbe7bec71d749169742a2a49b2c113dd1cd36c2f6f681`. Only an
authorized service operator may call it, after identifying the exact owner,
business and generation UUID and confirming all provider text/image attempts
against per-generation provider evidence. A 502, absent ID, missing usage row,
zero-token error receipt or expired request is not proof of zero spend or finality.
The caller must verify the provider total and final outcome, check saved creative
count, and supply a sanitized evidence reference, operator reference and the
currently observed accounted/reserved counters. No raw provider export, API key,
prompt, customer data or signed URL belongs in the evidence reference.

The RPC checks tenant, state, receipt version, current counters, recorded usage
and saved count; it appends missing verified usage before releasing the uncertain
reservation, audits the transition and blocks duplicate or late mutation. It
also rejects later generation-linked usage or newly saved creatives; existing
creative content may still be edited. It does not infer finality from local data
or offer a customer-facing repair action.
Pre-instrumentation intents, including the held September 29 #54 request, remain
blocked. Verify the migration ledger and grants in any other environment; an
operator must obtain external evidence for each eligible intent before calling
the RPC. Evidence for the held September 29 request cannot make it eligible.

### Creative Regeneration Claims

Before deploying the regeneration claim caller, apply the reviewed
`20261001_creative_regeneration_claims.sql` migration to the verified target and
independently confirm its ledger checksum, private table RLS, and service-role-only
execute grants on both claim and finish RPCs. Do not replay the canonical schema.
An overlapping request receives 409; a `processing` or `unresolved` claim does
not expire or authorize another paid attempt. The finish RPC releases only a
`processing` claim with a known outcome; it cannot clear an `unresolved` claim.
A fact-check rejection is a known outcome when every text attempt completed and its
usage receipt saved: the route releases it and returns 422 (#281).

For an uncertain regeneration, retain the creative, business, owner and original
attempt ID (the request ID). Compare the saved creative and usage receipts with
administrator-level provider evidence for every text and image attempt before
proposing recovery. A 502, missing receipt or zero-token error is not proof of
zero spend. Keep the claim and block retries until the outcome is established;
there is no customer-facing or automatic claim-clearing action. Any repair of an
`unresolved` row needs separately reviewed operator authority, a scoped verified
before-state and an exact-identity transaction. Never delete claims merely to
unblock a retry or use this procedure to clear the older #54 generation hold.

### Campaign Reconciliation

The operation ledger is durable. Inline execution retains a 60-second lease;
the optional worker uses the longer leases below. Neither execution mode retries
ambiguous provider mutations. Expiry with uncertain external effects is a
reconciliation signal, not proof that no campaign exists.

An operator should compare recorded campaign/adset/creative/ad IDs to Meta in the
original account, establish which steps actually completed, and verify local row
and binding integrity. Do not delete or recreate objects without an approved plan.
Use transactionally scoped local corrections only after resolving remote facts;
there is no documented one-command automatic repair API.

### Campaign Worker Rollout

The worker is implemented but not deployed by the local hardening work. Obtain
separate approval for migrations, hosting, credentials, and environment changes.

1. Back up and verify the target. Apply the reviewed
	`20260919_campaign_reporting_identity.sql` before deploying the new web code;
	apply `20260919_campaign_worker.sql` before enabling the queue. Use the named
	migration runner described in [Release Workflow](RELEASING.md), not the schema file.
2. Deploy the same dependency-complete application revision to a supervised Node
	process with production dependencies installed. Run `npm run worker:campaigns`.
	Supply `CAMPAIGN_EXECUTION_MODE=worker`, `CAMPAIGN_WORKER_TARGET` equal to the
	exact origin of `NEXT_PUBLIC_SUPABASE_URL`, the Supabase service key, token
	encryption key, and the existing Meta rollout configuration. Never expose
	service credentials to the browser. The script does not auto-load `.env.local`.
3. Verify process health and queue RPC access before setting
	`CAMPAIGN_EXECUTION_MODE=worker` on the web service. `--once` performs one cycle
	and exits, but **can create paused Meta objects if the queue is nonempty**;
	it is not a read-only health check. Unknown web execution modes fail closed.
4. Verify a separately authorized PAUSED provider workflow and operation polling.
	WhatsApp still requires verified Page linkage and a fresh reviewed number. Local mocks do not
	prove provider acceptance, worker-host uptime, or sustained throughput.
5. Establish alerts for process exit, oldest pending age, expired running leases,
	`needs_reconciliation`, and queue/execution errors before general rollout.
	Completion logs contain operation IDs and state, not payloads or credentials.

Pending jobs expire after 24 hours. A claim grants a 10-minute lease; execution
has an 8-minute deadline. Each process handles one job at a time; multiple workers
can claim distinct jobs. SIGTERM/SIGINT abort active provider I/O. A killed process
may leave a running operation until lease expiry; it is never automatically replayed.
Preflight failures are terminal failures; ambiguous mutations require reconciliation.
The claim RPC marks expired pending jobs failed and expired running jobs for
reconciliation. Status polling can conservatively mark an expired pending job for
reconciliation first. Inspect actual remote evidence rather than bypassing the fence.

For rollback, stop new submissions, inspect/drain pending work and reconcile running
operations before stopping workers or switching modes. Turning off the web flag
does not cancel queued jobs. Keep additive columns/RPCs; do not delete operation
rows, rewrite payloads, or create fresh idempotency keys to force a retry. Inline
mode remains a compatibility path, not the recommended long-running executor.

Useful read-only monitoring query (authorized database operator):

```sql
select state, count(*) as jobs, min(created_at) as oldest_created_at,
		 min(lease_until) as earliest_lease
from public.campaign_operations
where payload->>'execution' = 'worker'
  and state in ('pending', 'running', 'needs_reconciliation')
group by state;
```

Run ad hoc read-only production queries with
`node scripts/prod-sql.mjs "SELECT ..."`: one `SELECT`/`WITH` statement inside
`BEGIN READ ONLY`, sent through the Supabase Management API with the operator's
`SUPABASE_TOKEN` (read from the local `arcade/.env`, never printed).

### Activation Funnel

`node scripts/funnel.mjs [--days 14] [--include-internal]` (#338) shows where each sign-up of the last N
days (1–365) stopped. It prints one row per user and a total per step:
signed up → Brand saved → first ad generated → ad approved → Campaigns opened →
asked to connect Meta → Meta connected → top-up paid → campaign created → first
lead/chat. Each row has the user-id prefix, sign-up time, last step reached, last
seen (UTC) and a ✓/· mark per step. The query is read-only, through the same API as `prod-sql.mjs`. It
never prints emails or names, and leaves out internal accounts unless you pass
`--include-internal`. Steps come from durable tables (businesses,
creatives, Meta connections, live captured payments, campaigns with a Meta id,
leads and WhatsApp conversations). Campaigns opened, asked to connect Meta
(`/api/meta/oauth/start`, a `meta.connect*` `ui.action`, or `meta.access_request` from
**Ask for Facebook access** before Meta App Review) and last seen come from
`product_events`, which are pruned over time. A later step can be reached
without an earlier one, for example an operator-funded business never tops up.
The CEO and CTO rerun it weekly.

**Customer-only numbers (#379).** Every reported number excludes internal accounts by
default. They are defined once in
[internal-accounts.json](../src/lib/internal-accounts.json), which the app also uses to lift
the monthly AI limit for them (#398) and to give them free Pollinations images instead of the
paid image model (#449, #466; text stays on Haiku; `exemptFromFreeProviders` lists the user ids
that keep the paid images, each with its reason): team domains
(`@adbrain.vanshul.com`, `@adbrain.local`), owner user ids, and the smoke/demo emails
from the owner's local `.env.smoke`. **To mark a new internal account,** add its domain
or its auth user id to that file in a PR; never an email, because the repo is public.
`node scripts/product-events.mjs [--days 7]` counts customer events per name, and
`node scripts/product-events.mjs "select ... from events"` runs any one read-only query
over `events`. That is `product_events` of real customers only: by user, or by
business owner for background events; system rows are left out. Add
`--include-internal` to either command to see everyone.
**Smoke/demo Meta writes (#1324).** A business owned by a `smokeUserIds` login may only read,
validate (`validate_only`) and pause on Meta; MetaClient refuses anything else (403) before it is
sent, unless the connected ad account is listed in `testAdAccountIds`. Add the test ad account
there when DevOps creates it.

## Spend Guardrails

[The evaluator](../src/lib/campaign/spend.ts) uses these quantities:

```text
projectedWeekly = sum(active campaign daily budgets) * 7
trackedSpend = sum(latest stored spend snapshot per campaign)
used = max(projectedWeekly, trackedSpend)
```

Tracked spend is **not intrinsically a current-calendar-week aggregate**. It has
the time range of the fetched insight snapshot. Historical/stale snapshots and
missing campaign imports limit accuracy. Do not sum all snapshots together;
they are repeated observations, not ledger deltas.

Example: active campaigns with daily budgets INR 300 and INR 200 project INR 3500.
If latest tracked spend totals INR 4200 against a INR 5000 cap, displayed usage
is 84%. Adding an INR 250/day campaign projects INR 5250 and blocks activation.
Auto-pause requires tracked spend >= cap and `autoPause=true`; a high projection
alone does not trigger it. A/B total budgets include all ad sets.

`weeklyCap=null` disables the cap; zero is invalid in the settings API. Alert
percentage is 1-100. Activation checks are not atomic financial reservations:
concurrent activations and changes made directly in Meta can exceed expectations.
Use Meta/provider spending controls as the stronger external boundary.

Activation fails closed when a saved cap is invalid, the requested budget is
invalid, or an active campaign's budget is missing/invalid while a cap is enabled.
Sync campaigns and repair spend settings before retrying. A deliberately null cap
remains unlimited; paused campaigns' unknown budgets do not affect the projection.
Pause operations do not depend on spend reads succeeding. Dashboard estimates
still use known values; they are not proof that activation evidence is complete.

Operator-funded businesses (#245): DevOps marks or clears one with the owner's
live payment-operator grant, giving a reason, in the production SQL editor:
`select public.operator_funding_set('<business id>','<operator user id>',true,'<reason>');`
(`false` clears it). The audit table records who, when and why. Such a business
runs only capped runs inside its Meta ad account spending limit; the sweep keeps
the weekly cap but skips the customer allowance hold. A capped run created outside
AdBrain (the #157 run) is adopted after the mark with
[`scripts/adopt-capped-run.ts`](../scripts/adopt-capped-run.ts): it reads the Meta
tree back exactly, prints the campaign row (dry run), and `--apply` saves it through
`saveCampaign` so Pause, sync and results manage the run.

### Pilot setup call (#1279; dry run on the demo business, Oct 28)

Run these in order on the call; each has a read-back. Nothing here spends or
activates anything.

1. **Operator grant is live** (the mark needs it):
   `select expires_at > now() from private.production_payment_operators where user_id='<owner id>' and revoked_at is null;`
   It must be `true`. If not, stop: renewing the grant is the owner's step (CEO asks).
2. **Mark the business operator-funded** with the command above (`true`, reason
   `Pilot <n>: owner funds directly on Meta (#…)`). Read back:
   `select public.operator_funded('<business id>');` gives `true`, and
   `private.operator_funding_audit` has the new row.
3. **Weekly cap, by the owner in Settings → Spend guardrails:** Weekly cap (₹),
   Warn at 80%, tick **Auto-pause at the cap**, **Save guardrails** → "Saved.".
   Read back: `select weekly_cap_rupees, alert_pct, auto_pause from spend_limits where business_id='<business id>';`.
4. **Meta spending limit (read-only):**
   `GET /act_<id>?fields=currency,spend_cap,amount_spent,is_prepay_account,account_status`.
   Room = `spend_cap − amount_spent` (paise). The first run's total must fit in the
   room; a `spend_cap` of 0 means no account limit, so the owner sets one in Meta
   Billing before launch. On Oct 28 the operator account read INR, ₹1,822.04 limit,
   ₹1,350.63 spent, **₹471.41 room**, prepaid, status 1.
5. **Undo** (pilot ends or a mistake): `operator_funding_set(…, false, '<reason>')`;
   clear the cap in Settings (empty cap, auto-pause off, Save).

Insight ingestion validates the aggregate response before saving it: missing
`data`, multiple rows, pagination, invalid numbers/dates, or duplicate selected
outcome actions fail refresh instead of replacing stored evidence with zeroes.
Explicit `data: []` is a valid no-delivery response. Lead extraction prefers exact
`lead`, then `onsite_conversion.lead_grouped` only when the aggregate is absent;
it never adds overlapping actions or matches arbitrary names containing `lead`.
This does not certify attribution equivalence with every Ads Manager report.

### Prospect accounts: prepare, then hand over (#1315, #1317)

AdBrain is one business per account, so each prospect gets its own account; at signing the
owner takes it over by its email. Keep prospect names in the private sales files, not here or
in issues.

**Prepare (sales, before the visit):**
1. Sign in with a team plus-address, `<you>+prospect-<short>@<team domain>`. A confirmed team
   address is internal (`isInternalUser`), so Create uses the free image providers and no paid
   model (#466; CEO #1129: no paid spend until the owner tops up).
2. Step 1, "Tell us about your business": **Fill it from my website**, or **No website? Paste a
   bio or listing** with the shop's Instagram bio, Google listing or catalogue text, pasted by hand
   (no scraping or unofficial APIs). Both fill only empty fields, name included; check each line
   (it saves as you go), then **Make my ads**.
3. Step 2, "Your ads": all 3 are picked; **Download sample pack (3)** approves them and downloads the
   marked pack (no Review, no Go live). Don't connect Meta, start a campaign or add funds.
   Downloads go through the export, which marks every picture 'Sample: not live'; Share and the
   Assets tile's Download, Copy link and Open are hidden on a `+prospect` account, so no clean
   picture leaves before hand-over. After hand-over they come back on their own.

**Hand over (DevOps executes, QA reviews; a tenant step):**
1. Read-only checks, all must hold:
   `select authorization_status from public.meta_connections where business_id='<business id>';`
   returns no row or `disconnected`;
   `select count(*) from public.campaigns where business_id='<business id>';` is `0`.
   If either fails, stop and ask on the issue.
2. With the owner present, change the account's email to theirs (Supabase dashboard →
   Authentication → the user → change email, or `auth.admin.updateUserById(<user id>, { email })`).
3. The owner signs in with a one-time code sent to that email. Receiving the code is their
   confirmation. Read back:
   `select email, email_confirmed_at from auth.users where id='<user id>';` shows their address.
   The account is no longer internal, so the normal owner rules (paid images, allowance) apply
   from here.
4. Post 'handed over' with the date on the issue (no names); the owner connects Meta on the
   20-minute onboarding call (#1279).

### Scheduled Jobs

**Supabase `pg_cron` runs the jobs on time** (#274,
[migration](../db/migrations/20261024_scheduler_pg_cron.sql)): `adbrain-enforce-spend`
every 15 minutes, `adbrain-sync-leads` at :05/:20/:35/:50 and `adbrain-refresh-results`
at :10/:25/:40/:55 (UTC; the route refreshes each active campaign on every run, at most every 14 minutes, so results are ≤ 15 minutes old; #992). Each job runs `private.call_cron_route(path)`, which sends the
GET through `pg_net` with the secret from Supabase Vault (`adbrain_cron_secret`, equal
to the production `CRON_SECRET`); without that Vault secret every job is a no-op.
`adbrain-cron-history-cleanup` keeps 7 days of `cron.job_run_details`. Inspect with
`select jobname, schedule, active from cron.job` and
`select j.jobname, d.status, d.start_time from cron.job_run_details d join cron.job j using (jobid) order by d.start_time desc limit 20`;
HTTP results stay in `net._http_response` for 6 hours.
**Never add `net` to the API's exposed schemas or extra search path:** pg_net grants
its tables and `http_get` to `PUBLIC`, and `net.http_request_queue` holds the
bearer header until the worker sends it (`select count(*) from net.http_request_queue`
is 0 between runs). Pause one job with
`select cron.alter_job((select jobid from cron.job where jobname = 'adbrain-sync-leads'), active := false)`
(`active := true` resumes). Load or rotate the Vault secret only as DevOps, from
memory and never printed: `vault.create_secret(<value>, 'adbrain_cron_secret')` once, then
`vault.update_secret(<id>, <value>)`; rotating `CRON_SECRET` means updating Vercel, the
repository secret and Vault together.

[`scheduled-jobs.yml`](../.github/workflows/scheduled-jobs.yml) is the backup and the
only thing that opens issues. GitHub's 15-minute schedule actually runs every few hours, so the
team supervisor's 10-minute tick dispatches it when its latest run started over 9 minutes ago (so every tick) and
none is queued or running (#692; off with `~/.adbrain-supervisor/OFF`).
It first calls `scheduler-health` and opens one `Scheduled job overdue: <job>` `core`
bug for DevOps per job with no successful run in twice its interval. It then calls
enforce-spend, `sync-leads`, `payment-health` and `refresh-results` itself. It needs
repository secret `CRON_SECRET` equal to the production value, logs only counts, fails
red on any non-200 and opens one `Scheduled jobs failed twice in a row` `core` bug on
two consecutive failures. Pause it with `gh workflow disable scheduled-jobs.yml`; resume
with `gh workflow enable scheduled-jobs.yml`; run once with `gh workflow run scheduled-jobs.yml`.
[vercel.json](../vercel.json) also runs keepalive and enforce-spend daily at
`0 6 * * *` (UTC), the most a Vercel Hobby cron can run.
All cron routes require `Authorization: Bearer <CRON_SECRET>`, return 404 if unset and 401
for a mismatch. Do not log the header or paste it into support evidence.

| Job | Behavior |
| --- | --- |
| `/api/cron/keepalive` | Database activity and bounded product-event retention cleanup when configured; retention failure is visible |
| `/api/cron/enforce-spend` | Paginates active campaigns to find businesses (including those without saved weekly limits), checks customer balances, and reads current-week Meta insights for opted-in weekly caps; attempts to pause bound active campaigns for held funds, reached caps, or unverifiable weekly spend. `unverified` lists businesses whose spend could not be read (503), never ₹0 |
| `/api/cron/sync-leads` | For each business with a connected Meta Page, resumes or starts the same lead sync as **Sync** (at most 24 Graph reads per business, 20 s each, 45 s per run; leads deduplicated by Meta lead id). Returns `imported` and per-business `sync.hasMore`; any Meta or save failure returns 503 with saved progress, and the next run resumes it. With `OWNER_ALERTS_ENABLED`, it then sends each opted-in owner one `adbrain_lead_alert` per form lead under 24 h old (at most 20 per business per run; per-business `alerts: {sent, skipped}`; an alert failure never fails the run, #701) |
| `/api/cron/payment-health` | Read-only Razorpay webhook counts (#178): events in 7 days, events unprocessed after 1 hour, captured orders with no capture event after 30 minutes. `payments:"disabled"` when live payments are off. When `ok` is false the workflow opens one `Razorpay webhook missing for a captured payment` `core` bug (counts only) and stays green. Triage: in the Razorpay Live dashboard confirm the webhook URL `https://adbrain.vanshul.com/api/payments/live/webhook`, its secret matches `RAZORPAY_LIVE_WEBHOOK_SECRET` and capture/refund/dispute events are enabled, then resend the delivery; never re-charge |
| `/api/cron/refresh-results` | Read-only on Meta (#258, #992): every run (at most every 14 min) per active bound campaign, reads insights and ad review, saves one `campaign_results` row and `raw.health` flags: `rejected` (an ad `DISAPPROVED` or `WITH_ISSUES`, with Meta's reason), `not_delivering` (0 impressions after 6 h active) and `ended` (capped end time passed). Never pauses. Campaigns and Home show **Needs attention** with the reason. For each problem first seen in the last 24 h the workflow opens one (once per key, so a late GitHub run still alerts) `Campaign needs attention: <kind> (<key>)` `core` bug for Dev 3, with no identifiers; find the campaign with `select id, business_id from campaigns where raw->'health'->'flags' @> '[{"key":"<key>"}]'`. Paused bound campaigns (#1003): results only, at AdBrain's pause + 1 d and + 7 d, then final; one lifetime read for one with no row (imported); a pause made in Ads Manager has no anchor and keeps its last read; counted as `pausedReads`. 503 when any campaign could not be refreshed |
| `/api/cron/scheduler-health` | Read-only watchdog (#274): for each pg_cron job, minutes since its last run and last successful run (any scheduler), from logged `http.request` events; `overdue` after twice its interval without a success. Triage an overdue job: `cron.job` active, recent `cron.job_run_details`, `net._http_response` status (401 means the Vault secret differs from `CRON_SECRET`), then the route itself |
| `/api/cron/meta-parent-health` | Read-only check of the 2-Tier parent's system-user token (#520), run by the production guard after each deploy; a refused token adds a `FAIL 2-Tier parent token` line to the guard issue (no rollback). **Rotate:** the owner generates a new token for the 'AdBrain provisioning' system user in Solaride Business Settings (same app and permissions) and pastes it only into Vercel production as `META_PARENT_SYSTEM_TOKEN` (Sensitive); the next deploy picks it up and the guard confirms it, then revoke the old token. Never put it in chat, issues or CLI arguments (#413) |
| `/api/cron/managed-health` | Read-only 2-Tier provisioning watchdog (#527): managed accounts by state, and each one in a non-final state (`failed` included) for over 30 min. The scheduled workflow opens one `Managed account stuck: <state> (<key>)` `core` `2tier` bug for Dev 2 per key, with no identifiers. Find it by listing the stuck rows: `select business_id, state, last_error, updated_at from managed_meta_accounts where state not in ('ready','offboarded') and updated_at < now() - interval '30 minutes'` (the issue gives the state and minutes), then read its `managed_meta_account_events`. `npm run stats` shows the counts by state. The near-cap spend alert follows #534 |
| `/api/cron/campaign-reconciliation` | Read-only Launch watchdog (#734): each campaign operation in `needs_reconciliation` (a launch whose Meta outcome is unknown, so Meta may hold a campaign AdBrain doesn't track) for over 30 min. The scheduled workflow opens one `Launch needs reconciliation (<key>)` `core` bug for Dev 3 per key while none is open. Reconcile: `node scripts/reconcile-operation.mjs --key <key>` reads the row and each external id in Meta (GET only, the owner's system-user token, so only accounts it can see) plus campaigns created in the operation's window, and prints a verdict: `active` (pause it in Ads Manager first), `paused` (import or delete the tree, then rerun), `unreadable` (reconcile with the business's own connection) or `nothing_live`, where `--apply` closes the row as `failed` with the outcome |
| `/api/cron/access-requests` | Read-only (#692, #725): outside owners who tapped **Ask for Facebook access** in the last 7 days. The app promises a WhatsApp within a working day, so the scheduled workflow opens one `Facebook access request (<key>)` `core` `waiting-owner` issue per person, at most 5 a run (the rest are noted on the newest issue and opened by later runs); the CEO asks the owner to add them as a Meta app Tester (#679). Find them: `select a.actor_label as email, b.name, b.phone, a.created_at from audit_log a join businesses b on b.id = a.business_id where a.action = 'meta.access_request' and left(encode(sha256(convert_to(a.actor_id::text, 'UTF8')), 'hex'), 12) = '<key>' order by a.created_at desc limit 1`; requests from before #725 are only in `product_events` (`attributes->>'action' = 'meta.access_request'`, same key on `user_id`) |
| `/api/cron/core-scoreboard` | Daily core scoreboard (#681): Brand, Prepare, Create, Regenerate, assistant, Review, Launch and Manage numbers against their Nov 2 targets, smoke excluded. Brand (#1136) times each new business from `business.create` to its first save flagged `brandUsable` (name, category, area, phone and offer: `src/lib/brand/usable.ts`), p90 < 2 min met. Create is split by image path (`freeImagesOnly`: internal accounts on free Pollinations vs customers on paid images); only the customer path is held to the target. Launch scores settled `campaign_operations` creates; `meta.create_paused` failures are shown as context because Prepare, lead-form, preflight and WhatsApp-status reads share that purpose (#615). Manage scores the oldest newest-`campaign_results.fetched_at` across active, Meta-bound campaigns (≤ 15 min met; none active = —), with syncs and reads as context (#992). The scheduled workflow posts it on #681 once a day after 03:00Z (marked `<!-- core-scoreboard -->`, so `wait-for-work` doesn't wake anyone) while #681 is open. Locally: `npm run core-scoreboard [-- --hours 168] [-- --post]` (same numbers, read through the Management API) |
| `npm run ux-scoreboard` (local, no cron) | UX scoreboard (#1226 workstream 8): the north-star UX metrics against their Nov 30 targets: sign-up → first `campaigns.launched_at` (median over `--days`, default 28), median first reply over 7 d (`medianReplyMinutes`, Meta test leads excluded), and weekly return (distinct IST days with a `page.view` of /dashboard, /campaigns or /leads per owner with an active Meta-bound campaign). Taps to live, help needed and a11y/Web Vitals come from walks, ui-gate and Vercel, shown as —. Smoke is always excluded; internal accounts are too unless `--include-internal`. `-- --post` comments it on #1226 (QA 2) |
| `/api/cron/llm-credit` | Read-only OpenRouter credit check (#449): `GET /api/v1/key` for each pooled key, dollars only. Called only by the GitHub scheduled workflow (not pg_cron); under $0.50 left it opens one `OpenRouter credit low` issue labelled `decision` for the CEO. OpenRouter errors are logged and never fail the run. |

**Meta reconnect needed (#758).** The scheduled workflow reads `reauth: [{key, since, activeCampaigns}]` (key = first 12 hex of sha256 of the business id) from the `enforce-spend`, `sync-leads` and `refresh-results` responses: owners whose Meta token is dead (expired or revoked). A business is listed when Meta answers Graph 190 or its stored connection is expired, revoked or awaiting reauthorization (not managed accounts, which run on AdBrain's token); it doesn't count toward the run's 503, and refresh-results skips its other campaigns that run. The workflow opens one `Meta reconnect needed (<key>)` `core` `waiting-owner` issue per key with the ACTIVE campaign count; the CEO asks the owner to reconnect. Find them: `select b.name, b.phone, u.email from businesses b join auth.users u on u.id = b.owner_id where left(encode(sha256(convert_to(b.id::text, 'UTF8')), 'hex'), 12) = '<key>'`.

Weekly protection requires a complete Monday-to-today INR spend observation;
missing metrics are not zero spend. A row without `spend` stays unverified. Meta
answers `{"data":[]}` when nothing delivered in the period (recorded in
`tests/core/fixtures/meta/safety/insights.json`); that counts as ₹0, so a newly
activated campaign is not paused before it delivers. Unlaunched drafts do not contribute, but
launched or paused campaigns can. The scheduled sweep can return 503 with partial
progress; inspect `swept` and remaining failures rather than declaring every
campaign paused. Missing bindings, credentials, read errors, or local save failures
prevent complete enforcement. Both refresh-time and daily enforcement can lag;
neither is a hard real-time spend stop. Manually invoking enforce-spend can mutate
Meta and requires authorization, even though the method is GET.

Keepalive is not a promise that a provider will never pause a project. For an
outage, inspect provider status and restore through the authorized dashboard.
Do not infer every DNS/TLS failure is an inactivity pause.

## Data Safety and Recovery

Database snapshots, public Storage media, external Meta objects, encryption keys,
and provider accounts have different backup/retention boundaries. Test restore
procedures before relying on them. Code rollback does not undo ads, restore rows,
or recreate a deleted encryption key.

**Backups and restore (#883, drilled Oct 26).** The Supabase org is on the free plan:
`GET /v1/projects/kmzuxrvfrwwpwmoovwcp/database/backups` returns no backups and no PITR,
so Supabase can't restore anything (paid backups are a CEO call, #884). Our own path:
- `node scripts/db-export.mjs export <dir>` reads every `public`/`private` table, plus
  `auth.users` (id, email) and Storage object paths, as JSON through the read-only
  Management API (`BEGIN READ ONLY`). It took **100 s** for 56 tables and 33,287 rows (24 MB
  database, mostly `product_events`). `<dir>` holds customer data and encrypted Meta
  tokens: keep it private and delete it when done.
- `node scripts/db-export.mjs restore <dir>` builds git's schema in a throwaway local
  Postgres 17, loads every row with triggers and FK checks off, prints exported vs restored
  counts and deletes the cluster. It took **4 s**, with 0 rows lost.
- To bring production back from an export: create a new Supabase project, apply git's
  schema the same way, load the export (the restore's insert step), set `META_TOKEN_ENCRYPTION_KEY`
  to the same value so stored tokens decrypt, and point Vercel at it. Owners sign in again
  by email.
- **Nightly (#884):** the team supervisor's tick runs the export after 20:00Z (01:30 IST) into
  `~/.adbrain-backups/<UTC time>` (0700, the owner's Mac), restore-drills it and keeps the newest 7.
  A failure opens one `Nightly production export failed` `core` bug for DevOps; its log line is in
  `~/.adbrain-supervisor/supervisor.log`. If the Mac sleeps through 20:00Z, the export runs at the first tick after it wakes.
- **Lost even with an export:** Auth passwords and sessions, Storage file bytes (ad images
  and brand uploads; regenerate or re-upload), and everything since the export ran.
- Known drift, harmless: production still has the empty legacy tables `meta_credentials`,
  `meta_billing_events` and `meta_billing_event_conflicts`, which git's schema no longer creates.

Before cleanup, inventory rows plus creative references in campaigns/drafts/
operations, dependent results/leads, external IDs and storage paths. Obtain a
scoped approval, back up required evidence securely, compare the intended snapshot
again at execution, and verify counts and retained records afterward. Never
deduplicate across businesses solely because Meta IDs match.

Storage is public delivery; access policies on metadata do not make downloaded
URLs private. Row deletion is not complete media deletion. Privacy requests may
require separate database, Storage, provider, and log-retention handling. See
[Data Model](DATA_MODEL.md) for cascade behavior and current limits.

## Release and Incident Records

For each incident or deployment record: symptom, confirmed cause, affected scope,
authorized actions, exact SHA/migration state, checks performed, residual risk,
and follow-up owner. Keep records in the issue or PR.
Avoid asserting live-provider success from mocks or assuming a merged migration
has run remotely. Monitoring events currently have no built-in alerting service;
operational alert ownership must be established separately.