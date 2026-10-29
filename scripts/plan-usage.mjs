// #1856: alert before a Supabase free-plan quota is hit (we're on Free, #884). Reads usage through the Management API
// (the operator's token stays on the Mac; the team supervisor runs this once a day) and opens or updates one issue at
// 80% of any quota. Names and numbers only. Egress bytes aren't exposed by the API: read them in the dashboard.
//   node scripts/plan-usage.mjs [--dry-run]
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, parseEnv } from "node:util";

const MB = 1024 * 1024;
/** Supabase Free plan quotas (supabase.com/pricing); change here if the plan changes. */
export const FREE_QUOTAS = { database: 500 * MB, storage: 1024 * MB, mau: 50_000 };
const LABELS = { database: "Database size", storage: "Storage (all buckets)", mau: "Monthly active users" };
const show = (key, value) => (key === "mau" ? String(value) : `${Math.round(value / MB)} MB`);

/** One line per quota; `over` when usage reaches `threshold` of it. */
export function usageLines(usage, quotas = FREE_QUOTAS, threshold = 0.8) {
  return Object.keys(quotas).map((key) => {
    const ratio = usage[key] / quotas[key];
    return { key, over: ratio >= threshold, text: `${LABELS[key]}: ${show(key, usage[key])} of ${show(key, quotas[key])} (${Math.round(ratio * 100)}%)` };
  });
}

const TITLE = "Supabase free-plan quota above 80%";
const REPO = "vanshulgoyal101/adbrain";

async function main() {
  const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });
  const env = parseEnv(await readFile(join(homedir(), "Development/copilot/arcade/.env"), "utf8"));
  if (!env.SUPABASE_TOKEN) throw new Error("Supabase Management token is unavailable");
  const response = await fetch("https://api.supabase.com/v1/projects/kmzuxrvfrwwpwmoovwcp/database/query", {
    method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: `select pg_database_size(current_database())::bigint database,
      (select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects)::bigint storage,
      (select count(*) from auth.users where last_sign_in_at > now() - interval '30 days')::bigint mau` }) });
  if (!response.ok) throw new Error(`usage query ${response.status}`);
  const [row] = await response.json();
  const lines = usageLines({ database: Number(row.database), storage: Number(row.storage), mau: Number(row.mau) });
  for (const line of lines) console.log(`${line.over ? "OVER " : ""}${line.text}`);
  const over = lines.filter((line) => line.over);
  if (!over.length || values["dry-run"]) return;
  const body = `DevOps (automatic, #1856), ${new Date().toISOString().slice(0, 16)}Z:\n${lines.map((l) => `- ${l.over ? "**" : ""}${l.text}${l.over ? "**" : ""}`).join("\n")}\n- Egress: not in the API; check the dashboard › Usage.\n\n→ DevOps: free space (e.g. #1891's prune) or → CEO: plan decision (#884).`;
  const open = JSON.parse(execFileSync("gh", ["issue", "list", "-R", REPO, "--state", "open", "--search", `in:title "${TITLE}"`, "--json", "number"], { encoding: "utf8" }));
  if (open.length) execFileSync("gh", ["issue", "comment", String(open[0].number), "-R", REPO, "--body", body], { stdio: "ignore" });
  else execFileSync("gh", ["issue", "create", "-R", REPO, "-l", "core", "-l", "owner:devops", "-t", TITLE, "-b", body], { stdio: "ignore" });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(`plan-usage: ${String(error?.message ?? error).slice(0, 200)}`); process.exitCode = 1; });
