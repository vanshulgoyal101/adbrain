---
name: database-invariants
description: "Use this skill when correctness depends on SQL triggers, RPCs, caps, RLS policies, constraints, or SECURITY DEFINER functions."
---

<!-- Generated from vanshulgoyal101/skills@fb8f6e0 skills/database-invariants.md; edit upstream, then re-run scripts/sync-own-skills.mjs. -->

# Database Invariants

## Trigger

Use this skill when correctness depends on SQL triggers, RPCs, caps, RLS policies, constraints, or SECURITY DEFINER functions.

## Invariant

The database is the final authority for safety and integrity. Every client write path, including direct fallback writes and old clients, must pass the same invariant boundary.

## Failure pattern

A browser can forge usage events, an API row limit truncates monthly totals, or concurrent requests each count the same available rate-limit slot before inserting. RLS alone does not make accounting trustworthy or serialize read-then-write decisions.

## Recommended method

- Put caps and normalization in one canonical SQL function.
- Enforce the invariant with a trigger or constraint on every write path.
- Keep monotonic fields monotonic in the trigger, not only in an RPC.
- Validate JSON shape and size at the boundary.
- Use explicit `search_path` on privileged functions and schema-qualify calls.
- Test behavior, not only function definitions.
- Use throwaway rows, existing valid foreign keys, and `finally` cleanup for live integration tests.
- Use a read-only audit to compare authoritative columns with derived values in stored blobs.
- Restrict authoritative usage writes and limiter execution to trusted server roles while preserving owner-scoped reads. Test actual browser-role denials, not only policy text.
- Aggregate quota inputs in the database with tenant scope intact; exercise more rows than the API's default page size and prevent historical negative values from reducing totals.
- Serialize count-and-insert decisions by rate-limit key. Read wall-clock time after acquiring the lock so waiting does not consume the new event's window.
- Fail closed when shared production protection is unavailable. A per-instance development fallback is not equivalent protection across production instances.
- Coordinate permission-changing migrations with compatible application code. Describe both deployment orders and keep trusted-client behavior in the rollback; never restore browser write access as a shortcut.
- Apply one reviewed incremental migration to an explicitly verified target, with
	separate authorization from code publication. Keep full-schema commands local;
	require verified TLS for remote database connections.
- Serialize migration application with a transaction-scoped advisory lock and
	record filename/checksum atomically. Identical repeats skip, checksum drift
	fails, and failed SQL leaves neither partial changes nor a success entry.
- A new migration ledger does not describe all historical schema state. Inspect
	existing columns and constraints before adoption; never replay a directory
	because older applied migrations have no ledger entry.
- Back up affected data and compare original columns inside the locked migration
	transaction. Keep additive schema deployment separate from optional worker
	activation; publishing worker code is not authorization to run its queue.

### Resumable imports and compatible rollout

- Persist each imported page and its continuation checkpoint in the same transaction.
	Fence stale writers with scoped run/version identity. Persist opaque cursors rather
	than blindly following or storing token-bearing provider next-page URLs.
- Re-import provider-owned fields without overwriting owner-managed status, notes or
	existing source/campaign references. Do not guess attribution from a related form.
- A later request failure does not undo earlier page commits. Expose partial progress
	honestly and make saved rows discoverable through safe refresh/retry without duplicates.
- Verify fresh canonical schema contains the new RPCs as well as ordered upgrades.
	A harness that secretly appends missing SQL can hide a broken fresh installation.
- If migrations are copied into a canonical schema, check exact inclusion/order and
	update both with the reviewed migration. Tests/types/docs alone do not supply an RPC.
- Grant revocation makes old application artifacts potentially incompatible. Validate
	the chosen fallback against the post-migration schema; do not restore unsafe grants
	to make an old build work. Prefer additive rollout where it preserves all real safeguards.
- Label SQL contract probes accurately. They do not execute web handlers through
	Auth/PostgREST, prove feature parity, create a production backup or rehearse deployment.
- Verify backup/PITR availability for the actual service plan. A metadata-only
	before-state is not a data backup; an additive transaction and known forward-fix
	path do not provide general disaster recovery. Record the limitation explicitly
	and obtain the required recovery boundary before a risky migration.
- A dashboard SQL editor can display an early statement's result from a multi-step
	script. Independently read back the migration ledger/checksum, objects and role
	permissions after commit rather than inferring completion from that result panel.
- Preserve applied migration bytes, ordering and ledger identity during cleanup.
	Verify a fresh canonical schema and ordered upgrades without replaying historic
	migrations or silently appending missing SQL in the test harness.

## Discriminating checks

- Insert a negative value and assert the normalized value.
- Write above each product's legitimate maximum and assert clamp behavior.
- Insert high then upsert low and assert the high value remains while allowed metadata updates.
- Write oversized and wrong-shaped JSON and assert null/rejection policy.
- Assert zero-score backup rows do not rank.
- Assert tied-score rank semantics.
- Recompute every stored headline from its blob and flag under-reported rows.
- Run fresh installation, ordered upgrade and repeated migration paths against temporary PostgreSQL, including authenticated tenant isolation and denied browser writes/RPC calls.
- Race more concurrent requests than the available slots and assert the exact admitted count. Test unavailable shared protection separately from development fallback.
- Seed beyond the API page limit and compare the owner-scoped aggregate with the complete expected total.
- Apply the same migration twice, change its checksum, then force a SQL failure;
	assert skip, rejection, rollback, and absence of a failed ledger entry.
- Verify a pre-ledger upgraded database without replaying historical migrations;
	assert original row values survive the approved additive migration.
- Commit one import page, fail the next request, then resume: verify rows/checkpoint,
	exact inserted count and follow-up fields survive without false completion.
- Execute actual owner/wrong-owner/browser/service operations on the changed SQL.
	A permission denial may raise an error rather than return an empty successful result.

## Common traps

- PostgreSQL trigger operation names are uppercase (`UPDATE`, not `update`).
- A passing `pg_get_functiondef` check does not prove a trigger branch executes.
- A cap that is below the game's reachable maximum silently corrupts legitimate scores.
- `SECURITY DEFINER` without a fixed search path is fragile.
- Management API tests do not automatically reproduce `auth.uid()` context; distinguish admin tests from authenticated-client tests.
- A `NOT VALID` constraint protects new writes but does not certify historical rows; audit and validate those separately without silently rewriting history.
- Best-effort telemetry after paid work plus a quota preflight is not an atomic reservation or a hard provider spending cap.
- Publishing code does not prove the matching migration has been applied to the intended database.
- A data-modifying CTE runs on one snapshot; when a later step must see rows committed meanwhile, split it into two statements (#181).
- Synthetic provider IDs must pass the same validator as real ones: an underscore after `order_`/`pay_` failed the alphanumeric ID check (#212).
- Rows one check adds to a shared fixture account shift every later count over that account; extra rows moved the webhook-health counts (#178, #212).
- The Supabase Management API can return 503 (upstream reset) on a large migration body. Check `pg_stat_activity` and the migration ledger for a leftover transaction before retrying (#212).

## Evidence

AdBrain commit `1dbb4e9` (2026-09-16), its trusted-usage/rate-limit migration and `scripts/check-meta-connect-db.mjs`, records fresh and ordered-upgrade checks, browser privilege denial, tenant isolation, 1,100-event aggregation and twelve concurrent requests competing for three slots. The dated security audit records local PostgreSQL evidence, not remote migration completion.
