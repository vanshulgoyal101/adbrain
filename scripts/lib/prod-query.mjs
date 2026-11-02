// One read-only statement against production through the Supabase Management API
// (docs/team/orchestration.md "Access"). Never prints the token.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";

/** A timeout, a network error, 429 or 5xx is worth another try; a bad query or a missing token isn't. */
const transient = (error) => ["TimeoutError", "AbortError"].includes(error?.name) || error instanceof TypeError
  || error?.status === 429 || error?.status >= 500;

/** Statements here are read-only, so a retry can't change anything (#2537: one slow page failed a whole export). */
export async function withRetry(run, { attempts = 3, wait = (ms) => new Promise((done) => setTimeout(done, ms)) } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= attempts || !transient(error)) throw error;
      await wait(2_000 * 2 ** (attempt - 1));
    }
  }
}

export async function readOnlyQuery(sql) {
  const env = parseEnv(await readFile(join(homedir(), "Development/copilot/arcade/.env"), "utf8"));
  if (!env.SUPABASE_TOKEN) throw new Error("Supabase Management token is unavailable.");
  return withRetry(() => queryOnce(env.SUPABASE_TOKEN, sql));
}

async function queryOnce(token, sql) {
  const response = await fetch("https://api.supabase.com/v1/projects/kmzuxrvfrwwpwmoovwcp/database/query", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: `BEGIN READ ONLY;\n${sql};\nCOMMIT;`, read_only: true }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw Object.assign(new Error(`Read-only query failed (HTTP ${response.status}).`), { status: response.status });
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error("Unexpected database response.");
  return rows;
}
