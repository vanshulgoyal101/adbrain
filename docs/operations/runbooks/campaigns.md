# Campaign Creation Runbook

Part of the [incident playbooks](README.md#incident-playbooks).

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
	migration runner described in [Release Workflow](../../RELEASING.md), not the schema file.
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
