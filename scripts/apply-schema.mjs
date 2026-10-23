// Applies the full schema (frozen db/schema.sql plus newer db/migrations) to a Postgres database.
// Reads standard PG* env vars (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE).
// Usage:
//   PGHOST=... PGUSER=postgres PGPASSWORD=... PGDATABASE=postgres \
//     node scripts/apply-schema.mjs
import { Client } from "pg";
import { buildSchema } from "./build-schema.mjs";
import { databaseConfig } from "./database-migrations.mjs";

const sql = buildSchema();

const client = new Client(databaseConfig(process.env, { localOnly: true }));

try {
  await client.connect();
  await client.query("begin");
  await client.query(sql);
  await client.query("commit");
  console.log("✓ Schema applied successfully");
} catch (err) {
  await client.query("rollback").catch(() => {});
  console.error("✗ Failed to apply local schema:", err.code ?? "unknown");
  process.exitCode = 1;
} finally {
  await client.end();
}
