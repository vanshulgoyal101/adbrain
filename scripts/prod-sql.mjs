import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";

const projectId = "kmzuxrvfrwwpwmoovwcp";
const sql = process.argv[2]?.trim().replace(/;\s*$/, "");

if (process.argv.length !== 3 || !sql || !/^(SELECT|WITH)\b/i.test(sql) || sql.includes(";")) {
  console.error('Usage: node scripts/prod-sql.mjs "SELECT ..." (one read-only statement)');
  process.exit(1);
}

try {
  const env = parseEnv(await readFile(join(homedir(), "Development/copilot/arcade/.env"), "utf8"));
  if (!env.SUPABASE_TOKEN) throw new Error("Supabase Management token is unavailable");
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectId}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: `BEGIN READ ONLY;\n${sql};\nCOMMIT;`, read_only: true }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Read-only query failed (HTTP ${response.status})`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error("Unexpected database response");
  console.log(JSON.stringify(rows));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Read-only query failed");
  process.exitCode = 1;
}