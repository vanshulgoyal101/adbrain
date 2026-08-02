// Applies db/schema.sql to a Postgres database.
// Reads standard PG* env vars (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE).
// Usage:
//   PGHOST=... PGUSER=postgres PGPASSWORD=... PGDATABASE=postgres \
//     node scripts/apply-schema.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const schemaPath = fileURLToPath(new URL("../db/schema.sql", import.meta.url));
const sql = readFileSync(schemaPath, "utf8");

const client = new Client({ ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  await client.query(sql);
  console.log("✓ Schema applied successfully");
} catch (err) {
  console.error("✗ Failed to apply schema:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
