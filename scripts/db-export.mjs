// Production data export and restore drill (#883). The free-plan backup: Supabase keeps none on our plan.
//   node scripts/db-export.mjs export <dir>    read-only: every public/private table (plus auth.users id+email
//                                              and storage object paths) as JSON, through the Management API
//   node scripts/db-export.mjs restore <dir>   into a throwaway local Postgres 17 built from git's schema;
//                                              prints row counts against the export, then deletes the cluster
// The export holds customer data and encrypted Meta tokens: keep <dir> private (0700) and delete it after use.
// Not covered: Auth passwords and sessions (owners sign in by email again), Storage file bytes.
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSchema } from "./build-schema.mjs";
import { readOnlyQuery } from "./lib/prod-query.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = 2000;
const EXTRA = [["auth", "users", "id, email"], ["storage", "buckets", "*"], ["storage", "objects", "id, bucket_id, name"]];
const ident = (name) => `"${name.replaceAll('"', '""')}"`;

/** Tables to restore, in the export's order; `extra` adds the Supabase-owned rows the schema refers to. */
export function exportPlan(tables) {
  return [
    ...EXTRA.map(([schema, table, columns]) => ({ schema, table, columns })),
    ...tables.map(({ schema, table }) => ({ schema, table, columns: "*" })),
  ];
}

/**
 * A row or column production holds that the restore lost. Not losses: the migration ledger (the runner
 * writes it), storage's Supabase-managed bucket settings, and production tables git no longer has but
 * that are empty.
 */
export function lostData(r) {
  if (r.table === "private.schema_migrations") return false;
  if (r.restored !== r.exported) return true;
  return Boolean(r.note) && !r.table.startsWith("storage.") && !(r.note === "table not in git schema" && r.exported === 0);
}

async function exportAll(dir) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const started = Date.now();
  const tables = await readOnlyQuery(`select n.nspname as schema, c.relname as "table" from pg_class c
join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r', 'p') and n.nspname in ('public', 'private')
and not c.relispartition order by 1, 2`);
  const manifest = [];
  for (const { schema, table, columns } of exportPlan(tables)) {
    const name = `${ident(schema)}.${ident(table)}`;
    const [{ count }] = await readOnlyQuery(`select count(*)::int as count from ${name}`);
    const rows = [];
    for (let offset = 0; offset < count; offset += PAGE) {
      const [{ page }] = await readOnlyQuery(`select coalesce(json_agg(t), '[]') as page
from (select ${columns} from ${name} order by ctid offset ${offset} limit ${PAGE}) t`);
      rows.push(...page);
    }
    await writeFile(join(dir, `${schema}.${table}.json`), JSON.stringify(rows), { mode: 0o600 });
    manifest.push({ schema, table, rows: rows.length });
    console.log(`exported ${schema}.${table}: ${rows.length}`);
  }
  await writeFile(join(dir, "manifest.json"), JSON.stringify({ at: new Date().toISOString(), tables: manifest }, null, 1), { mode: 0o600 });
  console.log(`Export: ${manifest.length} tables, ${manifest.reduce((n, t) => n + t.rows, 0)} rows in ${Math.round((Date.now() - started) / 1000)} s.`);
}

async function restoreAll(dir) {
  const { tables } = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
  // Loaded here so the export runs in a worktree without node_modules (the supervisor's, #973).
  const { default: pg } = await import("pg");
  const bin = process.env.META_TEST_PG_BIN ?? "/opt/homebrew/opt/postgresql@17/bin";
  const work = await mkdtemp(join(tmpdir(), "adbrain-restore-"));
  const cluster = join(work, "data");
  const started = Date.now();
  let running = false;
  let db = null;
  try {
    execFileSync(join(bin, "initdb"), ["-D", cluster, "--auth=trust", "--encoding=UTF8", "--locale=C"], { stdio: "pipe" });
    execFileSync(join(bin, "pg_ctl"), ["-D", cluster, "-l", join(work, "postgres.log"), "-o", `-k ${work} -c listen_addresses=''`, "-w", "start"], { stdio: "pipe" });
    running = true;
    db = new pg.Client({ host: work, port: 5432, database: "postgres", user: userInfo().username });
    db.on("error", () => {});
    await db.connect();
    // The same Supabase stand-ins as `npm run test:meta-db`, plus room for the exported storage rows.
    await db.query(`create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth, public to anon, authenticated, service_role;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[], owner uuid, owner_id text, created_at timestamptz, updated_at timestamptz, avif_autodetection boolean, type text);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1)-1] $$;`);
    await db.query(buildSchema(root));
    const schemaSeconds = Math.round((Date.now() - started) / 1000);
    // Rows go in as exported: no triggers, no FK checks in between (replica), generated columns skipped.
    await db.query("set session_replication_role = replica");
    const report = [];
    for (const { schema, table, rows } of tables) {
      const data = JSON.parse(await readFile(join(dir, `${schema}.${table}.json`), "utf8"));
      const { rows: columns } = await db.query(`select a.attname from pg_attribute a join pg_class c on c.oid = a.attrelid
join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relname = $2 and a.attnum > 0 and not a.attisdropped
`, [schema, table]);
      const exported = new Set(Object.keys(data[0] ?? {}));
      const missing = data.length ? [...exported].filter((name) => !columns.some((c) => c.attname === name)) : [];
      // Generated columns are recomputed from the restored row, so they're never inserted.
      const insertable = (await db.query(`select a.attname from pg_attribute a join pg_class c on c.oid = a.attrelid
join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relname = $2 and a.attnum > 0 and not a.attisdropped
and a.attgenerated = ''`, [schema, table])).rows;
      const list = insertable.map((c) => c.attname).filter((name) => !data.length || exported.has(name)).map(ident).join(", ");
      const name = `${ident(schema)}.${ident(table)}`;
      if (!columns.length) { report.push({ table: `${schema}.${table}`, exported: rows, restored: 0, note: "table not in git schema" }); continue; }
      // The schema seeds some rows (storage buckets): the restore mirrors production exactly instead.
      await db.query(`delete from ${name}`);
      if (data.length) await db.query(`insert into ${name} (${list}) select ${list} from json_populate_recordset(null::${name}, $1::json)`, [JSON.stringify(data)]);
      const { rows: [{ count }] } = await db.query(`select count(*)::int as count from ${name}`);
      report.push({ table: `${schema}.${table}`, exported: rows, restored: count, note: missing.length ? `columns only in production: ${missing.join(", ")}` : "" });
    }
    await db.query("set session_replication_role = origin");
    const bad = report.filter(lostData);
    for (const r of report.filter((r) => !lostData(r) && (r.note || r.restored !== r.exported))) console.log(`note ${r.table}: exported ${r.exported}, restored ${r.restored} ${r.note}`);
    for (const r of bad) console.log(`MISMATCH ${r.table}: exported ${r.exported}, restored ${r.restored} ${r.note}`);
    console.log(`Restore: ${report.length} tables, ${report.reduce((n, r) => n + r.restored, 0)} rows; schema ${schemaSeconds} s, total ${Math.round((Date.now() - started) / 1000)} s; ${bad.length} mismatches.`);
    if (bad.length) process.exitCode = 1;
  } catch (error) {
    process.exitCode = 1;
    throw error;
  } finally {
    await db?.end().catch(() => {});
    if (process.exitCode && running) console.error((await readFile(join(work, "postgres.log"), "utf8")).split("\n").slice(-15).join("\n"));
    if (running) execFileSync(join(bin, "pg_ctl"), ["-D", cluster, "-m", "immediate", "-w", "stop"], { stdio: "pipe" });
    await rm(work, { recursive: true, force: true });
  }
}

const [command, dir] = process.argv.slice(2);
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!dir || !["export", "restore"].includes(command)) {
    console.error("Usage: node scripts/db-export.mjs export|restore <dir>");
    process.exit(2);
  }
  await (command === "export" ? exportAll(resolve(dir)) : restoreAll(resolve(dir))).catch((error) => { console.error(error.message); process.exitCode = 1; });
  if (command === "restore") console.log(`Export files kept in ${resolve(dir)}: delete them when done (${(await readdir(resolve(dir))).length} files).`);
}
