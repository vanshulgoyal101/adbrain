// One read-only statement against production through the Supabase Management API
// (docs/ORCHESTRATION.md "Access"). Never prints the token.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";

export async function readOnlyQuery(sql) {
  const env = parseEnv(await readFile(join(homedir(), "Development/copilot/arcade/.env"), "utf8"));
  if (!env.SUPABASE_TOKEN) throw new Error("Supabase Management token is unavailable.");
  const response = await fetch("https://api.supabase.com/v1/projects/kmzuxrvfrwwpwmoovwcp/database/query", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: `BEGIN READ ONLY;\n${sql};\nCOMMIT;`, read_only: true }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Read-only query failed (HTTP ${response.status}).`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error("Unexpected database response.");
  return rows;
}
