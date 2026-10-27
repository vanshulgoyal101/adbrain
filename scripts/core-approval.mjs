// Required check `core-approval` (#926): a PR that touches the core launch/Meta/money paths or a migration
// can't merge until QA, the Reviewer or the CTO approves its current head (or an earlier head with the same
// patch). A hold comment can't stop auto-merge; a missing approval can. Run by .github/workflows/core-approval.yml
// from the default branch, so PR code never runs with the status token.
//   node scripts/core-approval.mjs --pr <n>            set the commit status on the PR head
//   node scripts/core-approval.mjs --pr <n> --dry-run  print it only
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { changedLines, ctoReviews, moneyPath, qaApproval, reviewVerdicts } from "./release.mjs";

const repo = process.env.GITHUB_REPOSITORY ?? "vanshulgoyal101/adbrain";
export const CONTEXT = "core-approval";

/** Launch, Meta and money code plus migrations: the paths where an unreviewed change hurts customers (#914). */
export const corePath = /^(src\/lib\/meta\/|src\/lib\/campaign\/|src\/app\/api\/(meta|campaigns|managed|payments|spend-limits)\/|db\/migrations\/)/;

export function coreFiles(files) {
  return files.filter((f) => corePath.test(f) || moneyPath.test(f));
}

/**
 * The verdict for one PR. `comments` are issue comments and PR reviews ({ body, createdAt, url }), oldest first.
 * `samePatch(sha)` says whether an earlier head has the same changes as the current one.
 */
export function coreApproval({ files, head, headRef, labels = [], title = "", comments, samePatch = (sha) => head.toLowerCase().startsWith(sha.toLowerCase()) }) {
  if (headRef === "next") return { state: "success", description: "Deploy train: its PRs were gated into next" };
  const core = coreFiles(files);
  if (!core.length) return { state: "success", description: "No core launch/Meta/money/migration files" };
  // Rollbacks come first (AGENTS): a labelled revert ships without waiting for a verdict.
  if (labels.includes("rollback") && /^revert\b/i.test(title)) return { state: "success", description: "Rollback (revert + rollback label)" };
  const reviews = ctoReviews(comments);
  const reviewer = reviews.filter((r) => samePatch(r.sha)).at(-1);
  const qa = qaApproval(comments, head, samePatch);
  const short = head.slice(0, 7);
  if (reviewer?.approved || qa.approved) {
    const who = reviewer?.approved ? reviewer.body.split(" ")[0].replace(/[*_]/g, "") : "QA";
    return { state: "success", description: `${who} approved ${short}`, url: reviewer?.approved ? reviewer.url : qa.latest?.url };
  }
  const list = core.length > 2 ? `${core.slice(0, 2).join(", ")} +${core.length - 2}` : core.join(", ");
  return { state: "pending", description: `Needs QA/Reviewer/CTO approval of ${short}: ${list}`.slice(0, 140) };
}

function gh(args, opts = {}) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], ...opts });
}
const ghJson = (...args) => JSON.parse(gh(args));
/** `--paginate --jq '.[]|…'` prints one JSON value per line, whatever the page count. */
const ghLines = (...args) => gh(args).split("\n").filter(Boolean).map((line) => JSON.parse(line));

async function main() {
  const { values } = parseArgs({ options: { pr: { type: "string" }, "dry-run": { type: "boolean", default: false } } });
  const n = Number(values.pr);
  if (!Number.isInteger(n) || n <= 0) throw new Error("--pr <number> is required");
  const pr = ghJson("api", `repos/${repo}/pulls/${n}`);
  const head = pr.head.sha;
  const files = ghLines("api", "--paginate", `repos/${repo}/pulls/${n}/files?per_page=100`, "--jq", ".[].filename|tojson");
  const comments = [
    ...ghLines("api", "--paginate", `repos/${repo}/issues/${n}/comments?per_page=100`, "--jq", ".[]|{body,createdAt:.created_at,url:.html_url}|tojson"),
    ...reviewVerdicts(ghLines("api", "--paginate", `repos/${repo}/pulls/${n}/reviews?per_page=100`, "--jq", ".[]|{body,state,submitted_at,html_url}|tojson")),
  ].filter((c) => c.body).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // Same patch: an approval of an earlier head still counts after a clean merge of the base (as in release.mjs).
  const diffOf = (sha) => gh(["api", "-H", "Accept: application/vnd.github.diff", `repos/${repo}/compare/${pr.base.ref}...${sha}`]);
  const headLines = changedLines(gh(["pr", "diff", String(n), "-R", repo]));
  const memo = new Map();
  const samePatch = (sha) => {
    if (head.toLowerCase().startsWith(sha.toLowerCase())) return true;
    if (!memo.has(sha)) {
      try { memo.set(sha, changedLines(diffOf(sha)) === headLines); } catch { memo.set(sha, false); }
    }
    return memo.get(sha);
  };

  const verdict = coreApproval({ files, head, headRef: pr.head.ref, labels: pr.labels.map((l) => l.name), title: pr.title, comments, samePatch });
  console.log(`#${n} ${head.slice(0, 7)}: ${verdict.state} · ${verdict.description}`);
  if (values["dry-run"]) return;
  const args = ["api", "-X", "POST", `repos/${repo}/statuses/${head}`, "-f", `state=${verdict.state}`, "-f", `context=${CONTEXT}`, "-f", `description=${verdict.description}`];
  if (verdict.url) args.push("-f", `target_url=${verdict.url}`);
  gh(args);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`core-approval: ${error.message}`);
    process.exitCode = 1;
  });
}
