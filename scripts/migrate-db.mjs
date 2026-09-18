import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { Client } from "pg";
import { applyMigration, databaseConfig, migrationChecksum } from "./database-migrations.mjs";

let client;
try {
  const { values } = parseArgs({ options: {
    migration: { type: "string" }, target: { type: "string" }, apply: { type: "boolean", default: false },
  } });
  if (!values.migration || !/^\d[\w-]*\.sql$/.test(values.migration)) throw new Error("Pass --migration with a filename from db/migrations.");
  const sql = await readFile(new URL(`../db/migrations/${values.migration}`, import.meta.url), "utf8");
  console.log(`Migration: ${values.migration}; SHA256: ${migrationChecksum(sql)}`);
  if (!values.apply) {
    console.log("Preview only. No database connection or writes. Applying requires --apply and separate production approval.");
  } else {
    const config = databaseConfig(process.env, { target: values.target });
    client = new Client(config);
    await client.connect();
    console.log(await applyMigration(client, values.migration, sql));
  }
} catch {
  console.error("Migration refused or failed. Verify arguments, target, TLS, and migration history. No credentials are logged.");
  process.exitCode = 1;
} finally {
  await client?.end();
}