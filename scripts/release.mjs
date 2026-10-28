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
import { refuseHeadless } from "./lib/headless.mjs";

const repo = "vanshulgoyal101/adbrain";
const projectId = "kmzuxrvfrwwpwmoovwcp";
// Everyone posts as one GitHub user and "QA: ..." also opens handoffs to QA, so only explicit, unconditional verdict words count.
const negative = /\b(not (approved|fine|ready)|changes requested|request(ed)? changes|blocked|reject(ed)?|on hold|hold (off|on|it|this|that|the (release|merge))|do not merge|please|once you|when you|if you|you (approved|accepted))\b/i;

// The latest QA verdict comment that names the head decides; approvals for the head carry the reviewed hashes.
/** PR reviews posted with `gh pr review --comment` count as verdicts, like comments (#423). */
export function reviewVerdicts(reviews) {
  return reviews.filter((r) => r.body?.trim() && r.submitted_at && r.state !== "PENDING")
    .map((r) => ({ body: r.body, createdAt: r.submitted_at, url: r.html_url }));
}

/** A verdict's first sentence: later sentences ("…isn't blocked", "please merge") don't veto it (#554). */
export const verdictSentence = (body) => body.split("\n")[0].split(/(?<=[.!?](?:\*\*)?)\s+(?=[A-Z`#(→])/)[0];

// A verdict naming an earlier head with the same patch against the base also counts, so a clean
// merge of the base into the PR needs no re-approval; migration hashes are still checked.
/** @param {(sha: string) => boolean} [samePatch] */
export function qaApproval(comments, headSha, samePatch = /** @type {(sha: string) => boolean} */ (() => false)) {
  const head = headSha.slice(0, 7).toLowerCase();
  const namesHead = (c) => c.body.toLowerCase().includes(head)
    || (verdictSentence(c.body).toLowerCase().match(/\b[0-9a-f]{7,40}\b/g) ?? []).some((sha) => samePatch(sha));
  const verdicts = comments
    .filter((c) => /^[*_\s]*QA\b/.test(c.body) && namesHead(c))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const firstLine = (c) => verdictSentence(c.body);
  const approves = (c) => /(?<![-\w])(re-)?(approved|accepted|fine to (merge|ship))\b/i.test(firstLine(c)) && !negative.test(firstLine(c));
  const latest = verdicts.at(-1);
  if (!latest || !approves(latest)) return { approved: false, latest };
  return { approved: true, latest, text: verdicts.filter(approves).map((c) => c.body.toLowerCase()).join("\n") };
}

/**
 * A diff's changed lines in order, per file, without context or hunk positions. Equal for two heads whose
 * own edits are byte-identical even when a merge of the base moved the surrounding lines (git patch-id differs; #567).
 */
export function changedLines(diff) {
  const out = diff.split("\n").filter((l) => l.startsWith("diff --git ") || (/^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l)));
  return out.some((l) => !l.startsWith("diff --git ")) ? out.join("\n") : "";
}

export function releaseMigrations(files) {
  const migrations = files.filter((f) => /^db\/migrations\/[^/]+\.sql$/.test(f.filename));
  const changed = migrations.filter((f) => f.status !== "added");
  if (changed.length) throw new Error(`Applied migrations are immutable; this PR ${changed.map((f) => `${f.status} ${f.filename}`).join(", ")}.`);
  return migrations.map((f) => f.filename).sort();
}

// Money code (dispatch item 5): these PRs, like migrations, need the CTO's review as well as QA's (#259).
// lib/managed: 2-Tier child spend caps set from the customer's allowance (#522).
export const moneyPath = /^src\/(lib\/payments\/|lib\/managed\/|app\/api\/payments\/|app\/api\/cron\/(enforce-spend|payment-health)\/|lib\/campaign\/(spend|activation|budget|funding))/;

// "CTO review of <sha>", "CTO re-review of <sha>", "CTO post-release review of <sha>" or the Reviewer's "Reviewer review of <sha>" (#575);
// in "<old> → <new>" the last sha is the one reviewed.
export function ctoReviews(comments) {
  return comments.flatMap((c) => {
    const line = c.body.split("\n")[0];
    const sha = line.match(/^[*_\s]*(?:CTO|Reviewer) (?:post-release |re-)?review of (?:[0-9a-f]{7,40}\s*(?:→|->)\s*)*([0-9a-f]{7,40})\b/i)?.[1];
    if (!sha) return [];
    const verdict = verdictSentence(c.body);
    const approved = /\*\*approved\.?\*\*/i.test(verdict) && !/\b(not approved|changes requested|request(ed)? changes|withdrawn|blocked)\b/i.test(verdict);
    return [{ ...c, sha: sha.toLowerCase(), approved }];
  }).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// The latest CTO review of the head, or of an earlier head with the same patch, decides.
export function ctoApproval(reviews, samePatch) {
  const latest = reviews.filter((review) => samePatch(review.sha)).at(-1);
  return { approved: Boolean(latest?.approved), latest };
}

export function supersededBy(log) {
  return log.match(/Superseded: production serves newer ([0-9a-f]{7,40})/)?.[1] ?? null;
}

export function smokeCounts(log) {
  return { pass: (log.match(/\dZ PASS /g) ?? []).length, fail: (log.match(/\dZ FAIL /g) ?? []).length };
}

/** #884: a migration needs a database backup that finished less than an hour ago. */
export const BACKUP_MAX_AGE_MS = 60 * 60_000;
export function backupFresh(run, now = Date.now()) {
  if (!run || run.status !== "completed" || run.conclusion !== "success") return false;
  return now - Date.parse(run.updatedAt) < BACKUP_MAX_AGE_MS;
}

/** Commit statuses as check runs; the API lists newest first, and failingChecks takes the newest per name. */
export function commitStatuses(statuses) {
  return statuses.map((st) => ({ name: st.context, status: st.state === "pending" ? "in_progress" : "completed",
    conclusion: st.state === "success" ? "success" : st.state, completedAt: st.created_at }));
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

const latestBackup = () => ghJson("run", "list", "-R", repo, "--workflow", "db-backup.yml", "--limit", "1", "--json", "databaseId,status,conclusion,updatedAt,url")[0];

/** No migration without a backup under an hour old (CEO, #884): dispatch one and wait if needed. */
async function requireFreshBackup(dry) {
  let run = latestBackup();
  if (backupFresh(run)) return console.log(`    Database backup ${run.url} finished ${Math.round((Date.now() - Date.parse(run.updatedAt)) / 60_000)} min ago.`);
  if (dry) return console.log("    No database backup under 1 h old; a real run dispatches db-backup.yml and waits for it.");
  step("Take a fresh database backup (db-backup.yml)");
  const started = Date.now();
  gh("workflow", "run", "db-backup.yml", "-R", repo, "--ref", "main");
  for (let i = 0; i < 60; i++) {
    await sleep(20_000);
    run = latestBackup();
    if (run && Date.parse(run.updatedAt) >= started - 60_000 && run.status === "completed") break;
  }
  if (!backupFresh(run)) stop(`The database backup did not succeed (${run?.url ?? "no run"}). No migration without one (#884): fix the backup, then rerun this command.`);
  console.log(`    Backup ${run.url} done.`);
}

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
  // #1513: even --dry-run loads the production Management token, and verdict comments are one shared GitHub user.
  refuseHeadless("release.mjs");
  const { values } = parseArgs({ options: { pr: { type: "string" }, "dry-run": { type: "boolean", default: false } } });
  if (!/^\d+$/.test(values.pr ?? "")) stop("Usage: node scripts/release.mjs --pr <number> [--dry-run]");
  const dry = values["dry-run"];
  const pr = ghJson("pr", "view", values.pr, "-R", repo, "--json", "number,state,baseRefName,headRefOid,mergeCommit,mergeStateStatus,url,closingIssuesReferences");
  // Migrations release to main; tenant and money code without one can go to next and ride the deploy train (#461).
  const base = pr.baseRefName;
  if (base !== "main" && base !== "next") stop(`PR #${pr.number} targets ${base}, not main or next.`);
  const head = pr.headRefOid;
  const files = lines(gh("api", "--paginate", `repos/${repo}/pulls/${pr.number}/files`, "--jq", ".[]|[.filename,.status]|@tsv")).map((l) => {
    const [filename, status] = l.split("\t");
    return { filename, status };
  });
  const names = releaseMigrations(files).map((path) => path.split("/").pop());
  if (base === "next" && names.length) stop(`PR #${pr.number} adds a migration; retarget it to main (migrations release to main).`);

  if (pr.state === "MERGED") {
    step(`PR #${pr.number} is already merged as ${pr.mergeCommit.oid.slice(0, 7)}; checking the production guard only.`);
    return finish(pr, head, pr.mergeCommit.oid, names, await ledger(names), null);
  }
  if (pr.state !== "OPEN") stop(`PR #${pr.number} is ${pr.state}.`);

  step(`Preflight PR #${pr.number} at ${head.slice(0, 7)} (read-only)`);
  if (pr.mergeStateStatus === "DIRTY") stop(`PR #${pr.number} conflicts with ${base}, so CI has not run on ${head.slice(0, 7)}. The author merges ${base}; a clean merge keeps QA's and the CTO's approvals (same patch).`);
  const required = lines(gh("api", `repos/${repo}/branches/main/protection/required_status_checks`, "--jq", ".contexts[]"));
  const checks = lines(gh("api", "--paginate", `repos/${repo}/commits/${head}/check-runs`, "--jq", ".check_runs[]|[.name,.status,.conclusion,.completed_at]|@tsv")).map((l) => {
    const [name, status, conclusion, completedAt] = l.split("\t");
    return { name, status, conclusion, completedAt };
  });
  // core-approval (#926) is a commit status, not a check run; count statuses the same way.
  checks.push(...commitStatuses(ghJson("api", `repos/${repo}/commits/${head}/statuses?per_page=100`)));
  const notGreen = failingChecks(required, checks);
  if (notGreen.length) stop(`Required checks not green on ${head.slice(0, 7)}: ${notGreen.join(", ")}. Wait for CI or fix it.`);
  console.log(`    CI: ${required.join(", ")} green`);

  const threads = [pr.number, ...pr.closingIssuesReferences.map((issue) => issue.number)];
  const comments = [
    ...threads.flatMap((n) => ghJson("api", "--paginate", `repos/${repo}/issues/${n}/comments?per_page=100`, "--jq", "[.[]|{body,createdAt:.created_at,url:.html_url}]")),
    ...reviewVerdicts(ghJson("api", "--paginate", `repos/${repo}/pulls/${pr.number}/reviews?per_page=100`, "--jq", "[.[]|{body,state,submitted_at,html_url}]")),
  ];
  const patches = new Map();
  const patchOf = (sha) => {
    if (!patches.has(sha)) {
      try {
        const diff = gh("api", "-H", "Accept: application/vnd.github.diff", `repos/${repo}/compare/${base}...${sha}`);
        const id = execFileSync("git", ["patch-id", "--stable"], { input: `${diff}\n`, encoding: "utf8" }).split(" ")[0] || null;
        patches.set(sha, { id, lines: changedLines(diff) });
      } catch {
        patches.set(sha, null);
      }
    }
    return patches.get(sha);
  };
  const samePatch = (sha) => {
    if (head.startsWith(sha)) return true;
    const [old, now] = [patchOf(sha), patchOf(head)];
    return Boolean(old && now && ((old.id && old.id === now.id) || (old.lines !== "" && old.lines === now.lines)));
  };
  const qa = qaApproval(comments, head, samePatch);
  if (qa.approved) console.log(`    QA approved ${head.slice(0, 7)}: ${qa.latest.url}`);
  else if (dry) console.log(`    QA has not approved ${head.slice(0, 7)} yet (latest QA verdict: ${qa.latest?.url ?? "none"}); continuing because --dry-run.`);
  else stop(`No QA approval naming ${head.slice(0, 7)} or a head with the same patch (latest QA verdict: ${qa.latest?.url ?? "none"}). QA must approve this head.`);

  if (names.length || files.some((f) => moneyPath.test(f.filename))) {
    const cto = ctoApproval(ctoReviews(comments), samePatch);
    const reviewed = cto.latest && !head.startsWith(cto.latest.sha) ? ` (reviewed ${cto.latest.sha}, same patch against main)` : "";
    if (cto.approved) console.log(`    CTO approved ${head.slice(0, 7)}${reviewed}: ${cto.latest.url}`);
    else if (dry) console.log(`    CTO has not approved ${head.slice(0, 7)} yet (latest CTO review: ${cto.latest?.url ?? "none"}); continuing because --dry-run.`);
    else stop(`Money or migration PR without a Reviewer or CTO review approving ${head.slice(0, 7)} or a head with the same patch (latest: ${cto.latest?.url ?? "none"}). Dispatch item 5 needs QA plus the Reviewer or the CTO.`);
  }

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
  if (pending.length) await requireFreshBackup(dry);
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
  if (pr.baseRefName === "next") {
    step("Receipt (paste into the issue)");
    console.log([
      `DevOps release of PR #${pr.number} at ${head.slice(0, 7)} into next. No migration.`,
      `Merged as ${mergeSha.slice(0, 7)}; it goes live on the next deploy train (within about 30 min), and that train's production guard smokes it.${qaUrl ? ` QA approval: ${qaUrl}.` : ""}`,
      "No payment, refund or ad activation by this release.",
    ].join("\n"));
    return;
  }
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
