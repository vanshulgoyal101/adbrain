// Applies db/schema.sql to a Postgres database.
// Reads standard PG* env vars (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE).
// Usage:
//   PGHOST=... PGUSER=postgres PGPASSWORD=... PGDATABASE=postgres \
//     node scripts/apply-schema.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { databaseConfig } from "./database-migrations.mjs";

const schemaPath = fileURLToPath(new URL("../db/schema.sql", import.meta.url));
const sql = readFileSync(schemaPath, "utf8");

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
