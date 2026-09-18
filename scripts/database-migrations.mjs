import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function databaseConfig(env, { localOnly = false, target = "" } = {}) {
  const host = env.PGHOST;
  const database = env.PGDATABASE;
  const user = env.PGUSER;
  const port = Number(env.PGPORT ?? 5432);
  if (!host || !database || !user || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Explicit PGHOST, PGDATABASE, PGUSER and a valid port are required.");
  }
  const local = ["localhost", "127.0.0.1", "::1"].includes(host);
  if (localOnly && !local) throw new Error("Full-schema application is restricted to loopback databases.");
  const identity = `${host}:${port}/${database}@${user}`;
  if (!local && target !== identity) throw new Error("Remote migrations require an exact --target host:port/database@user confirmation.");
  if (!local && ["disable", "allow", "prefer", "require", "no-verify"].includes(env.PGSSLMODE)) {
    throw new Error("Remote migrations require certificate verification, not an insecure PGSSLMODE.");
  }
  return {
    host, port, database, user, password: env.PGPASSWORD,
    connectionTimeoutMillis: 10_000,
    ssl: local ? false : { rejectUnauthorized: true, ...(env.PGSSLROOTCERT ? { ca: readFileSync(env.PGSSLROOTCERT, "utf8") } : {}) },
    application_name: "adbrain-migrations",
  };
}

export function migrationChecksum(sql) {
  return createHash("sha256").update(sql).digest("hex");
}

export async function applyMigration(client, name, sql) {
  if (!/^\d[\w-]*\.sql$/.test(name)) throw new Error("Choose a migration filename from db/migrations.");
  const checksum = migrationChecksum(sql);
  await client.query("begin");
  try {
    await client.query("set local lock_timeout = '5s'");
    await client.query("set local statement_timeout = '60s'");
    await client.query("select pg_advisory_xact_lock(hashtextextended('adbrain:migrations', 0))");
    await client.query("create schema if not exists private");
    await client.query("create table if not exists private.schema_migrations (name text primary key, checksum text not null, applied_at timestamptz not null default now())");
    await client.query("revoke all on private.schema_migrations from public, anon, authenticated, service_role");
    const { rows } = await client.query("select checksum from private.schema_migrations where name = $1", [name]);
    if (rows.length && rows[0].checksum !== checksum) throw new Error("Applied migration checksum changed. Add a new migration instead.");
    if (!rows.length) {
      await client.query(sql);
      await client.query("insert into private.schema_migrations (name, checksum) values ($1, $2)", [name, checksum]);
    }
    await client.query("commit");
    return rows.length ? "already_applied" : "applied";
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}