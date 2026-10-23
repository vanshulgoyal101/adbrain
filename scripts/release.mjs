// One-command money or migration release (#228): node scripts/release.mjs --pr <n> [--dry-run]
// Read-only preflight, then dry run, apply with ledger row, schema reload, merge at the full head SHA,
// production guard and a receipt. --dry-run stops before apply and merge. Never prints a secret.
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, parseEnv } from "node:util";
import { managementMigrationSql, migrationChecksum } from "./database-migrations.mjs";

const repo = "vanshulgoyal101/adbrain";
const projectId = "kmzuxrvfrwwpwmoovwcp";
const negative = /\b(not approved|changes requested|request(ed)? changes|blocked|reject(ed)?)\b/i;

// The latest QA verdict comment that names the head decides; approvals for the head carry the reviewed hashes.
export function qaApproval(comments, headSha) {
  const head = headSha.slice(0, 7).toLowerCase();
  const verdicts = comments
    .filter((c) => /^[*_\s]*QA\b/.test(c.body) && c.body.toLowerCase().includes(head))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const firstLine = (c) => c.body.split("\n")[0];
  const approves = (c) => /\b(approved|accepted)\b/i.test(firstLine(c)) && !negative.test(firstLine(c));
  const latest = verdicts.at(-1);
  if (!latest || !approves(latest)) return { approved: false, latest };
  return { approved: true, latest, text: verdicts.filter(approves).map((c) => c.body.toLowerCase()).join("\n") };
}

export function releaseMigrations(files) {
  const migrations = files.filter((f) => /^db\/migrations\/[^/]+\.sql$/.test(f.filename));
  const changed = migrations.filter((f) => f.status !== "added");
  if (changed.length) throw new Error(`Applied migrations are immutable; this PR ${changed.map((f) => `${f.status} ${f.filename}`).join(", ")}.`);
  return migrations.map((f) => f.filename).sort();
}

export function supersededBy(log) {
  return log.match(/Superseded: production serves newer ([0-9a-f]{7,40})/)?.[1] ?? null;
}

export function smokeCounts(log) {
  return { pass: (log.match(/\dZ PASS /g) ?? []).length, fail: (log.match(/\dZ FAIL /g) ?? []).length };
}

export function failingChecks(required, checkRuns) {
  return required.filter((name) => {
    const latest = checkRuns.filter((run) => run.name === name).sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))[0];
    return !(latest?.status === "completed" && latest.conclusion === "success");
  });
}

const gh = (...args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 }).trim();
const ghJson = (...args) => JSON.parse(gh(...args));
const lines = (text) => (text ? text.split("\n") : []);
const step = (message) => console.log(`==> ${message}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Stop extends Error {}
const stop = (message) => { throw new Stop(message); };

let token;
async function sql(query, { readOnly }) {
  token ??= parseEnv(await readFile(join(homedir(), "Development/copilot/arcade/.env"), "utf8")).SUPABASE_TOKEN;
  if (!token) stop("Supabase Management token is unavailable.");
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectId}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(readOnly ? { query: `BEGIN READ ONLY;\n${query};\nCOMMIT;`, read_only: true } : { query }),
    signal: AbortSignal.timeout(90_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Management API HTTP ${response.status}: ${JSON.stringify(body)?.slice(0, 300)}`);
  return body;
}

const ledger = async (names) => names.length
  ? sql(`select name, checksum, applied_at from private.schema_migrations where name in (${names.map((n) => `'${n}'`).join(",")})`, { readOnly: true })
  : [];
const activeSessions = async () => (await sql("select count(*)::int n from pg_stat_activity where state = 'active' and backend_type = 'client backend' and pid <> pg_backend_pid()", { readOnly: true }))[0].n;

async function waitForGuard(sha) {
  for (let hop = 0; hop < 3; hop++) {
    let run;
    for (let i = 0; i < 90; i++) {
      run = ghJson("run", "list", "-R", repo, "--workflow", "production-guard.yml", "--commit", sha, "--limit", "1", "--json", "databaseId,status,conclusion,url")[0];
      if (run?.status === "completed") break;
      await sleep(20_000);
    }
    if (run?.status !== "completed") stop(`No completed production guard for ${sha.slice(0, 7)} after 30 min. Watch it: gh run list -R ${repo} --workflow production-guard.yml --commit ${sha}`);
    const log = gh("run", "view", String(run.databaseId), "-R", repo, "--log");
    const { pass, fail } = smokeCounts(log);
    const newer = supersededBy(log);
    if (run.conclusion !== "success" || fail) stop(`Production guard failed (${run.url}). It rolls production back on a failed smoke; read the run, then follow docs/RELEASING.md#rollback-and-incident-handling. Do not undo the migration by hand.`);
    if (!newer && !pass) stop(`Production guard ${run.url} passed without running the smoke. Run \`npm run smoke:core\` and check the log.`);
    if (!newer) return { run, pass, sha };
    const full = gh("api", `repos/${repo}/commits/${newer}`, "--jq", ".sha");
    const status = gh("api", `repos/${repo}/compare/${sha}...${full}`, "--jq", ".status");
    if (!["ahead", "identical"].includes(status)) stop(`Production serves ${newer}, which does not contain ${sha.slice(0, 7)}. Check production before going on.`);
    step(`Guard skipped ${sha.slice(0, 7)}: production serves newer ${newer}, which contains it. Waiting for that guard.`);
    sha = full;
  }
  stop("Production kept moving; read the latest production guard run by hand.");
}

async function main() {
  const { values } = parseArgs({ options: { pr: { type: "string" }, "dry-run": { type: "boolean", default: false } } });
  if (!/^\d+$/.test(values.pr ?? "")) stop("Usage: node scripts/release.mjs --pr <number> [--dry-run]");
  const dry = values["dry-run"];
  const pr = ghJson("pr", "view", values.pr, "-R", repo, "--json", "number,state,baseRefName,headRefOid,mergeCommit,mergeStateStatus,url,closingIssuesReferences");
  if (pr.baseRefName !== "main") stop(`PR #${pr.number} targets ${pr.baseRefName}, not main.`);
  const head = pr.headRefOid;
  const files = lines(gh("api", "--paginate", `repos/${repo}/pulls/${pr.number}/files`, "--jq", ".[]|[.filename,.status]|@tsv")).map((l) => {
    const [filename, status] = l.split("\t");
    return { filename, status };
  });
  const names = releaseMigrations(files).map((path) => path.split("/").pop());

  if (pr.state === "MERGED") {
    step(`PR #${pr.number} is already merged as ${pr.mergeCommit.oid.slice(0, 7)}; checking the production guard only.`);
    return finish(pr, head, pr.mergeCommit.oid, names, await ledger(names), null);
  }
  if (pr.state !== "OPEN") stop(`PR #${pr.number} is ${pr.state}.`);

  step(`Preflight PR #${pr.number} at ${head.slice(0, 7)} (read-only)`);
  if (pr.mergeStateStatus === "DIRTY") stop(`PR #${pr.number} conflicts with main, so CI has not run on ${head.slice(0, 7)}. The author merges main; then QA approves the new head.`);
  const required = lines(gh("api", `repos/${repo}/branches/main/protection/required_status_checks`, "--jq", ".contexts[]"));
  const checks = lines(gh("api", "--paginate", `repos/${repo}/commits/${head}/check-runs`, "--jq", ".check_runs[]|[.name,.status,.conclusion,.completed_at]|@tsv")).map((l) => {
    const [name, status, conclusion, completedAt] = l.split("\t");
    return { name, status, conclusion, completedAt };
  });
  const notGreen = failingChecks(required, checks);
  if (notGreen.length) stop(`Required checks not green on ${head.slice(0, 7)}: ${notGreen.join(", ")}. Wait for CI or fix it.`);
  console.log(`    CI: ${required.join(", ")} green`);

  const threads = [pr.number, ...pr.closingIssuesReferences.map((issue) => issue.number)];
  const comments = threads.flatMap((n) => ghJson("api", "--paginate", `repos/${repo}/issues/${n}/comments`, "--jq", "[.[]|{body,createdAt:.created_at,url:.html_url}]"));
  const qa = qaApproval(comments, head);
  if (qa.approved) console.log(`    QA approved ${head.slice(0, 7)}: ${qa.latest.url}`);
  else if (dry) console.log(`    QA has not approved ${head.slice(0, 7)} yet (latest QA verdict: ${qa.latest?.url ?? "none"}); continuing because --dry-run.`);
  else stop(`No QA approval naming ${head.slice(0, 7)} (latest QA verdict: ${qa.latest?.url ?? "none"}). QA must approve this exact head.`);

  const migrations = [];
  for (const name of names) {
    const body = Buffer.from(gh("api", `repos/${repo}/contents/db/migrations/${name}?ref=${head}`, "--jq", ".content"), "base64").toString("utf8");
    const checksum = migrationChecksum(body);
    managementMigrationSql(name, body, { commit: false });
    if (qa.approved && !qa.text.includes(checksum.slice(0, 8))) stop(`${name} sha256 ${checksum.slice(0, 16)}… is not the hash QA reviewed. QA must name it in the approval.`);
    migrations.push({ name, sql: body, checksum });
    console.log(`    ${name} sha256 ${checksum.slice(0, 16)}…${qa.approved ? " (matches QA)" : ""}`);
  }
  const before = await ledger(names);
  for (const row of before) {
    const m = migrations.find((x) => x.name === row.name);
    if (row.checksum !== m.checksum) stop(`${row.name} is already applied with a different checksum. Add a new migration instead.`);
    console.log(`    ${row.name} already applied at ${row.applied_at}; it will be skipped.`);
  }
  const pending = migrations.filter((m) => !before.some((row) => row.name === m.name));

  for (const m of pending) {
    step(`Dry run ${m.name} (rolled back)`);
    const result = await sql(managementMigrationSql(m.name, m.sql, { commit: false }), { readOnly: false });
    if (!result?.some?.((row) => row.name === m.name && row.checksum === m.checksum)) stop(`Dry run of ${m.name} returned no ledger readback: ${JSON.stringify(result).slice(0, 300)}`);
    if ((await ledger([m.name])).length) stop(`Ledger has ${m.name} after a dry run. Investigate before anything else.`);
  }
  if (dry) {
    const apply = pending.length ? `applies ${pending.map((m) => m.name).join(", ")}, reloads the schema,` : "applies no migration,";
    step(`Dry run complete. A real run ${apply} merges with --match-head-commit ${head} and waits for the guard.`);
    return;
  }

  for (const m of pending) {
    step(`Apply ${m.name} with its ledger row`);
    try {
      await sql(managementMigrationSql(m.name, m.sql, { commit: true }), { readOnly: false });
    } catch (error) {
      const row = (await ledger([m.name]).catch(() => null))?.[0];
      const active = await activeSessions().catch(() => "unknown");
      stop(`Apply of ${m.name} failed: ${error.message}\n    Ledger row: ${row ? `present (${row.applied_at}), so it committed` : "absent"}; active sessions: ${active}.\n    Do not resend the SQL. ${row ? "Rerun this command; it skips applied migrations." : "If no session is still running it, the transaction rolled back: read the error, then rerun this command."}`);
    }
  }
  const after = await ledger(names);
  for (const m of migrations) if (!after.some((row) => row.name === m.name && row.checksum === m.checksum)) stop(`Ledger readback is missing ${m.name}. Check private.schema_migrations before going on.`);
  if (pending.length) {
    step("Reload the PostgREST schema cache");
    await sql("notify pgrst, 'reload schema';", { readOnly: false });
  }

  step(`Merge PR #${pr.number} at ${head}`);
  try {
    gh("pr", "merge", String(pr.number), "-R", repo, "--squash", "--match-head-commit", head);
  } catch (error) {
    stop(`Merge failed: ${String(error.stderr || error.message).trim().slice(0, 300)}\n    ${pending.length ? "The migration is applied and recorded. " : ""}Fix the PR (new head means a new QA approval), then rerun this command; it skips applied migrations.`);
  }
  const merged = ghJson("pr", "view", String(pr.number), "-R", repo, "--json", "state,mergeCommit");
  if (merged.state !== "MERGED") stop(`PR #${pr.number} is ${merged.state} after merge; check it by hand.`);
  return finish(pr, head, merged.mergeCommit.oid, names, after, qa.latest?.url);
}

async function finish(pr, head, mergeSha, names, rows, qaUrl) {
  step(`Wait for the production guard on ${mergeSha.slice(0, 7)}`);
  const guard = await waitForGuard(mergeSha);
  const via = guard.sha === mergeSha ? "" : ` on ${guard.sha.slice(0, 7)}, which contains it,`;
  const receipt = [
    `DevOps release of PR #${pr.number} at ${head.slice(0, 7)}.`,
    names.length
      ? `${names.map((n) => { const r = rows.find((x) => x.name === n); return `Migration \`${n}\` (sha256 ${r?.checksum.slice(0, 8)}…) applied with its ledger row at ${r?.applied_at}`; }).join("; ")}, then the schema cache was reloaded.`
      : "No migration.",
    `Merged as ${mergeSha.slice(0, 7)}. Production guard run ${guard.run.databaseId}${via} passed the core smoke ${guard.pass}/${guard.pass}.${qaUrl ? ` QA approval: ${qaUrl}.` : ""}`,
    "No payment, refund or ad activation by this release.",
  ];
  step("Receipt (paste into the issue)");
  console.log(receipt.join("\n"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Stop ? `STOP: ${error.message}` : `STOP (unexpected): ${error.message}`);
    process.exitCode = 1;
  });
}
