# Backups and Data Safety

Part of [Operations](README.md).

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
  `~/.adbrain-backups/<UTC time>` (0700, the owner's Mac) and restore-drills it. Then it seals it
  as `<UTC time>.tar.gz.cms` (0600, CMS-encrypted to `.github/backup/backup-cert.crt`, like `db-backup.yml`),
  deletes the plaintext and keeps the newest 7 (#1762). To read one: decrypt with the keychain key
  (RELEASING.md › restore drill: `openssl cms -decrypt …`), then `tar -xzf` and
  `node scripts/db-export.mjs restore <folder>`.
  After a good export it also runs `scripts/prune-smoke-storage.mjs --apply` (#1891): the core smoke's own
  creatives and `creatives`-bucket files older than 7 days that nothing references (campaigns, ads, drafts,
  operations, regeneration claims) are deleted; the newest 20 stay. Without `--apply` it only prints counts.
  A failure opens one `Nightly production export failed` `core` bug for DevOps; its log line is in
  `~/.adbrain-supervisor/supervisor.log`. If the Mac sleeps through 20:00Z, the export runs at the first tick after it wakes.
- **Meta API version (#1857):** once a UTC day the supervisor runs `scripts/graph-sunset.mjs`, which reads Meta's Graph and
  Marketing API version tables and opens one `Meta API version retires soon` issue (→ CTO) 90 days before our
  `GRAPH_VERSION` (src/lib/meta/graph-version.ts) is retired, or if the table can't be read.
- **Free-plan quotas (#1856):** once a UTC day the supervisor runs `scripts/plan-usage.mjs` (database size of 500 MB,
  Storage of 1 GB, MAU of 50,000, via the Management API) and opens or updates one `Supabase free-plan quota above 80%`
  issue. Egress isn't in the API: check the dashboard's Usage page. `--dry-run` prints the numbers.
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
[Data Model](../architecture/data-model.md) for cascade behavior and current limits.
