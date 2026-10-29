---
name: supabase-rls-complete
description: "When a multi-tenant application stores user, workspace, account, or organization data in a shared database, especially when tables or object storage are added."
---

<!-- Generated from vanshulgoyal101/skills@b877c32 skills/supabase-rls-complete.md; edit upstream, then re-run scripts/sync-own-skills.mjs. -->

# Complete Row-Level Security

## Trigger

When a multi-tenant application stores user, workspace, account, or organization data in a shared database, especially when tables or object storage are added.

## Invariant

Every read, insert, update, and delete is constrained to the authenticated owner or tenant. Database policies and storage policies express the same boundary independently of application filtering.

## Failure pattern

A new table, relation, RPC, or storage bucket is reachable without the same tenant restriction as existing data. The application appears account-safe in normal flows but a direct query, alternate endpoint, or missing filter crosses the boundary.

## Recommended method

Treat tenant isolation as a database invariant. Enable RLS on every exposed table, add explicit policies for each operation, constrain inserts as well as reads, and mirror the rule in storage policies. Add schema-level tests that enumerate tables and policies instead of checking only hand-picked examples.

## Discriminating checks

- Enumerate exposed tables and assert each has RLS enabled and policies for its supported operations.
- Attempt cross-tenant select, insert, update, and delete with authenticated test identities.
- Test storage object access with an object belonging to another tenant.
- Inspect new migrations for tables or buckets added without a policy.

## Production-state checks

- Run variant checks against production `pg_proc`, not migration files: `proconfig` and
  `proacl` show the live state, and `has_schema_privilege(role,'public','CREATE')` shows
  who can plant objects (#673).
- Base funnel steps on durable tables; `product_events` gets pruned (#338).
- Exclude internal accounts by id or domain from one module, never by email in a public
  repo, and attribute background events by business owner (#339, #379).
- Two-tenant checks on isolated Postgres can pass while the real gap is a shared
  credential. Read the credential path too (#617).
- Check `has_column_privilege('authenticated', …, 'UPDATE')` per column, not only the
  policies: an ALL policy plus default grants lets the browser write every column of its
  own rows.
- Before a cleanup on shared data, take a backup and assert row counts.

## Common traps

- Relying on a server-side `owner_id` filter as the only protection.
- Protecting reads but forgetting inserts or updates.
- Assuming a relation inherits the parent table's policy.
- Treating service-role access as representative of user access.
