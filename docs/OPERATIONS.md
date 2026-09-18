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

## Incident Playbooks

| Symptom | Inspect | Recovery / avoid |
| --- | --- | --- |
| Sign-in or redirect failure | Supabase availability, configured site/callback URLs, browser cookie state, safe redirect policy | Retry intended method; use local path destinations, never bypass authentication |
| Brand autofill fails | URL validation, public DNS/fetch reachability, provider availability | Enter fields manually; do not disable SSRF protection or overwrite concurrent edits |
| Generation fails before starting | Ownership, monthly aggregate RPC, receipt column, references, keys/model, rate limit | Repair verified configuration/schema; do not disable quota because usage is unknown |
| Browser loses generation result | GET recovery by business/generation UUID and expected count | Recover saved rows first; generation UUID is not a durable deduplication lock |
| Partial generation | Saved count and per-variant failures | Keep successes, review before a deliberate additional paid request |
| Image/composition failure | Provider/reference compatibility, bounded raster validation, upload/render stage | No silent raw-photo substitution; uploaded sources may need later cleanup |
| Draft conflict/expiry | Latest version, expiry, operation linkage | Reload/review; expired draft requires new intent, not an expiry extension hack |
| Create times out | Original idempotency key, operation phase/lease/external IDs | Poll/lookup first; never choose a new key to evade uncertainty |
| `needs_reconciliation` | Checkpoint IDs, local campaign, correct bound Meta account/Page | Authorized operator reconciles actual objects; preserve evidence, no blind recreate/delete |
| Activation blocked | Current capability, generation/digest, binding, form/budget/spend evidence | Recheck and re-review; never relabel a different campaign to fit the connection |
| Sync incomplete | Cursor, skipped count, account/Page binding, status, save error | Continue pages or retry failed page; do not prune local rows based on one page |
| Refresh returns `result: null` | `campaign_results` persistence and request logs | Current route does not fail on every insert error; verify snapshot before trusting report |
| Leads partly sync | `failedForms`, newly inserted count, reload result | Retry failed forms after permission fix; repeated IDs are ignored, not counted as new leads |
| Disconnect fails | Explicit business UUID, owner check, RPC/schema availability | Keep existing UI state until confirmed; disconnect is not an emergency pause |
| Telemetry missing | Enable flags, applied migration, hosting logs, retention, request cap | Events are best effort; a missing event does not prove no action occurred |

### Campaign Reconciliation

The operation ledger is durable, but there is no general background worker that
guarantees completion of every abandoned request. A 60-second lease limits stale
ownership; expiry with uncertain external effects is a reconciliation signal.

An operator should compare recorded campaign/adset/creative/ad IDs to Meta in the
original account, establish which steps actually completed, and verify local row
and binding integrity. Do not delete or recreate objects without an approved plan.
Use transactionally scoped local corrections only after resolving remote facts;
there is no documented one-command automatic repair API.

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

### Scheduled Jobs

[vercel.json](../vercel.json) schedules both endpoints at `0 6 * * *` (UTC).
Hosting-plan timing and execution guarantees must be checked with the host.
Both require `Authorization: Bearer <CRON_SECRET>`, return 404 if unset and 401
for a mismatch. Do not log the header or paste it into support evidence.

| Job | Behavior |
| --- | --- |
| `/api/cron/keepalive` | Database activity and bounded product-event retention cleanup when configured; retention failure is visible |
| `/api/cron/enforce-spend` | Reads opted-in businesses, existing campaigns and latest stored spend; attempts to pause active bound campaigns at cap |

Enforcement does **not** fetch fresh insights first. It can return 503 with partial
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
and follow-up owner. Keep records in [QA](qa/) or [release receipts](releases/).
Avoid asserting live-provider success from mocks or assuming a merged migration
has run remotely. Monitoring events currently have no built-in alerting service;
operational alert ownership must be established separately.