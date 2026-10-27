// Weekly restore drill of the nightly encrypted pg_dump (#884, item 3).
//   node scripts/restore-drill.mjs [--run <id> | --file <dump.sql.gz.cms>] [--post]
// Downloads the newest successful db-backup.yml artifact, decrypts it with the private key from DevOps's
// keychain, restores it into a throwaway local Postgres 17 and checks every table's row count against
// the dump's own data. Deletes the cluster, the key and the decrypted dump. --post comments the result on #884.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";

const REPO = "vanshulgoyal101/adbrain";
const BIN = process.env.META_TEST_PG_BIN ?? "/opt/homebrew/opt/postgresql@17/bin";
// Stand-ins for what Supabase provides outside the dumped schemas.
const BOOTSTRAP = `create role anon; create role authenticated; create role service_role bypassrls;
create role supabase_auth_admin; create role authenticator; create role supabase_admin;
create schema extensions; create extension if not exists pgcrypto schema extensions;
create extension if not exists "uuid-ossp" schema extensions;`;
// The dump recreates schemas that Postgres or the bootstrap already made.
const BENIGN = [/schema "(public|extensions)" already exists/];

/** Rows per table in a plain pg_dump: the lines between each `COPY <table> … FROM stdin;` and `\.`. */
export function dumpRowCounts(sql) {
  const counts = {};
  let table = null;
  for (const line of sql.split("\n")) {
    if (table) {
      if (line === "\\.") table = null;
      else counts[table]++;
      continue;
    }
    const m = /^COPY ([^\s(]+)/.exec(line);
    if (m) { table = m[1].replaceAll('"', ""); counts[table] = 0; }
  }
  return counts;
}

/** Restore errors that mean lost schema or data (benign "already exists" lines left out). */
export function realErrors(stderr) {
  return stderr.split("\n").filter((l) => /ERROR:/.test(l) && !BENIGN.some((re) => re.test(l)));
}

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024, ...opts });
}

async function main() {
  const { values } = parseArgs({ options: { run: { type: "string" }, file: { type: "string" }, post: { type: "boolean", default: false } } });
  const run = values.file ? "local" : values.run ?? JSON.parse(sh("gh", ["run", "list", "-R", REPO, "-w", "db-backup.yml", "--status", "success", "-L", "1", "--json", "databaseId"]))[0]?.databaseId;
  if (!run) throw new Error("No successful db-backup.yml run to drill.");
  const work = mkdtempSync(join(tmpdir(), "adbrain-drill-"));
  const socket = mkdtempSync("/tmp/pgdrill.");
  const cluster = join(work, "data");
  let running = false;
  const started = Date.now();
  try {
    if (values.file) sh("cp", [values.file, join(work, "local.sql.gz.cms")]);
    else sh("gh", ["run", "download", String(run), "-R", REPO, "-D", work]);
    const file = readdirSync(work, { recursive: true }).map(String).find((f) => f.endsWith(".sql.gz.cms"));
    if (!file) throw new Error(`Run ${run} has no encrypted dump.`);
    const key = join(work, "key.pem");
    writeFileSync(key, Buffer.from(sh("security", ["find-generic-password", "-a", "devops", "-s", "adbrain-backup-key", "-w"]).trim(), "base64"), { mode: 0o600 });
    const gz = join(work, "dump.sql.gz");
    sh("openssl", ["cms", "-decrypt", "-binary", "-inform", "DER", "-inkey", key, "-in", join(work, file), "-out", gz]);
    rmSync(key, { force: true });
    const sql = gunzipSync(readFileSync(gz)).toString("utf8");
    const expected = dumpRowCounts(sql);

    sh(join(BIN, "initdb"), ["-D", cluster, "--auth=trust", "--encoding=UTF8", "--locale=C"]);
    sh(join(BIN, "pg_ctl"), ["-D", cluster, "-l", join(work, "pg.log"), "-o", `-k ${socket} -p 5497 -c listen_addresses=''`, "-w", "start"]);
    running = true;
    const psql = ["-h", socket, "-p", "5497", "-d", "postgres", "-q", "-X"];
    sh(join(BIN, "psql"), [...psql, "-c", BOOTSTRAP]);
    const restore = spawnSync(join(BIN, "psql"), [...psql, "-v", "ON_ERROR_STOP=0"], { input: sql, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    const errors = realErrors(restore.stderr ?? "");
    const exact = {};
    for (const table of Object.keys(expected)) {
      const [schema, name] = table.split(".");
      exact[table] = Number(sh(join(BIN, "psql"), [...psql, "-At", "-c", `select count(*) from "${schema}"."${name}"`]).trim());
    }
    const mismatched = Object.keys(expected).filter((t) => exact[t] !== expected[t]);
    const rows = Object.values(expected).reduce((a, b) => a + b, 0);
    const ok = !errors.length && !mismatched.length;
    const seconds = Math.round((Date.now() - started) / 1000);
    const summary = `${ok ? "PASS" : "FAIL"}: restore drill of db-backup run ${run} (${file.split("/").pop().replace(".sql.gz.cms", "")}): ${Object.keys(expected).length} tables, ${rows} rows, ${mismatched.length} count mismatches, ${errors.length} restore errors, ${seconds} s end to end.`;
    console.log(summary);
    for (const t of mismatched) console.log(`  mismatch ${t}: dump ${expected[t]}, restored ${exact[t]}`);
    for (const e of errors.slice(0, 5)) console.log(`  ${e.replace(/^psql:[^:]*:\d+: /, "")}`);
    if (values.post) sh("gh", ["issue", "comment", "884", "-R", REPO, "--body", `DevOps (weekly drill): ${summary}${mismatched.length ? `\nMismatches: ${mismatched.join(", ")}` : ""}`]);
    if (!ok) process.exitCode = 1;
  } finally {
    if (running) spawnSync(join(BIN, "pg_ctl"), ["-D", cluster, "-m", "immediate", "-w", "stop"]);
    rmSync(work, { recursive: true, force: true });
    rmSync(socket, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main().catch((error) => { console.error(error.message); process.exit(1); });
