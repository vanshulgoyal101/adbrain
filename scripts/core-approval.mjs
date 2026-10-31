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
const MIGRATION = /^db\/migrations\//;

export const corePath = /^(src\/lib\/meta\/|src\/lib\/campaign\/|src\/app\/api\/(meta|campaigns|managed|payments|spend-limits)\/|db\/migrations\/)/;
/**
 * #1740: tenant and auth boundaries: cron routes write across every business with the admin client, the WhatsApp
 * webhook binds phones to businesses, and `security`/`internal-accounts` decide who may do what.
 */
export const tenantPath = /^src\/(app\/api\/(cron|whatsapp|privacy-requests)\/|lib\/(security|alerts)\/|lib\/internal-accounts\.(ts|json)$|lib\/privacy-requests\.ts$)/;

export function coreFiles(files) {
  return files.filter((f) => !/\.md$/i.test(f) && (corePath.test(f) || tenantPath.test(f) || moneyPath.test(f)));
}

/**
 * Prose a person reads: two or more words, or non-ASCII letters (Hindi), and nothing shaped like code: no
 * `= { } [ ] < > | \\ "`, no column or field list (`id, name, status`), no PostgREST filter (`status.eq.`).
 */
export function prose(text) {
  const t = text.trim();
  if (!/\p{L}{2,}[\s\S]*\s[\s\S]*\p{L}/u.test(t) && !/[^\x00-\x7F]/.test(t)) return false;
  if (/[={}[\]<>|\\"]/.test(t) || /\.\w+\./.test(t) || /^[\w.*]+(\s*,\s*[\w.*]+)+$/.test(t)) return false;
  return !/^(https?:|\/|\.)/.test(t);
}

// Calls whose string argument is a query, a match or a lookup, not words for a person.
const LOOKUP = new Set(["select", "or", "and", "eq", "neq", "in", "is", "like", "ilike", "filter", "match", "contains", "not",
  "textSearch", "rpc", "from", "order", "includes", "startsWith", "endsWith", "indexOf", "lastIndexOf", "test", "exec",
  "search", "replace", "replaceAll", "split", "parse", "RegExp", "fetch", "get", "has", "set", "delete", "getItem",
  "setItem", "querySelector", "querySelectorAll", "require", "import", "graph", "request", "post", "put", "patch"]);

/** Whether a changed literal sits where words go (a message, a label), not where code reads it. */
function wordsPlace(ts, node) {
  let child = node;
  let parent = node.parent;
  // A template part belongs to its template; judge where the whole template sits.
  if (ts.isTemplateSpan(parent)) { child = parent.parent; parent = child.parent; }
  else if (ts.isTemplateExpression(parent)) { child = parent; parent = child.parent; }
  if (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent)) { child = parent; parent = child.parent; }
  if (ts.isBinaryExpression(parent)) {
    const op = parent.operatorToken.kind;
    return op === ts.SyntaxKind.PlusToken || op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken;
  }
  if (ts.isCaseClause(parent) || ts.isElementAccessExpression(parent) || ts.isComputedPropertyName(parent)) return false;
  if (ts.isTaggedTemplateExpression(parent) || ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)
    || ts.isExternalModuleReference(parent) || ts.isImportTypeNode?.(parent) || ts.isLiteralTypeNode(parent)) return false;
  if ((ts.isPropertyAssignment(parent) || ts.isPropertySignature?.(parent) || ts.isEnumMember(parent)) && parent.name === child) return false;
  if (ts.isPropertyAssignment(parent) && /^(fields|select|url|href|src|path|endpoint|key|id|code|status|type|kind)$/i.test(parent.name.getText())) return false;
  if (ts.isJsxAttribute(parent) && /^(href|src|action|key|id|name|type|value|pattern)$/.test(parent.name.getText())) return false;
  if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
    const callee = parent.expression;
    const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text
      : callee.kind === ts.SyntaxKind.ImportKeyword ? "import" : "";
    if (!name || LOOKUP.has(name)) return false;
  }
  return true;
}

/** Leaf tokens in source order (comments are trivia, so they never appear); null when the file doesn't parse. */
function leaves(ts, fileName, text) {
  const kind = /\.tsx$|\.jsx$/.test(fileName) ? ts.ScriptKind.TSX : /\.m?js$/.test(fileName) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  if (file.parseDiagnostics?.length) return null;
  const out = [];
  const walk = (node) => {
    const children = node.getChildren(file);
    if (!children.length) {
      if (node.kind !== ts.SyntaxKind.EndOfFileToken) out.push(node);
      return;
    }
    // A string or template part is one token even when the parser gives it no children.
    for (const child of children) walk(child);
  };
  walk(file);
  return { file, out };
}

/**
 * #364 (owner, Oct 31): a change that only rewords what an owner reads isn't a launch, Meta or money behaviour
 * change. True when the base and head copies have the same tokens in the same order (comments ignored), and
 * every token that differs is a string, template part or JSX text that is prose (`prose`) in a words place
 * (`wordsPlace`). Anything else (a reorder, a moved or swapped value, a status, key, query, number, an added or
 * removed line of code, a parse error, a non-JS file, a new or deleted file) keeps the gate.
 * @param {typeof import("typescript")} ts
 * @param {string} fileName
 * @param {string | null} base the file at the PR's merge base
 * @param {string | null} head the file at the PR head
 */
export function wordsOnly(ts, fileName, base, head) {
  if (!ts || base == null || head == null || !/\.(ts|tsx|js|jsx|mjs)$/.test(fileName)) return false;
  const a = leaves(ts, fileName, base);
  const b = leaves(ts, fileName, head);
  if (!a || !b || a.out.length !== b.out.length) return false;
  let changed = 0;
  for (let i = 0; i < a.out.length; i++) {
    const x = a.out[i];
    const y = b.out[i];
    if (x.kind !== y.kind) return false;
    const before = x.getText(a.file);
    const after = y.getText(b.file);
    if (before === after) continue;
    const K = ts.SyntaxKind;
    if (![K.StringLiteral, K.NoSubstitutionTemplateLiteral, K.TemplateHead, K.TemplateMiddle, K.TemplateTail, K.JsxText].includes(y.kind)) return false;
    // A template part is judged as its whole template's words, with N for each expression.
    const words = (node, file) => {
      if (node.kind === K.JsxText) return node.getText(file);
      const template = ts.isTemplateExpression(node.parent) ? node.parent : ts.isTemplateSpan(node.parent) ? node.parent.parent : null;
      return template ? template.head.text + template.templateSpans.map((span) => `N${span.literal.text}`).join("") : node.text;
    };
    if (!prose(words(x, a.file)) || !prose(words(y, b.file))) return false;
    if (!wordsPlace(ts, x) || !wordsPlace(ts, y)) return false;
    changed++;
  }
  return changed > 0 || base !== head;
}

/**
 * #2147: in a main → next sync merge, a core file is exempt only if the head's copy is main's (already gated
 * there) and next hasn't changed it since the merge base, so taking main's side can't drop a gated change on
 * next. Blob shas; null means the file is missing (null === null: on neither next nor the base).
 * @param {{ head: string | null, main: string | null, next: string | null, base: string | null }} b
 */
export function syncExempt({ head, main, next, base }) {
  return Boolean(head) && head === main && next === base;
}

/**
 * @typedef {{ body: string, createdAt: string, url?: string }} Verdict
 * @param {{ files: string[], head: string, headRef: string, headRepo?: string, baseRef?: string, labels?: string[], title?: string, comments: Verdict[], samePatch?: (sha: string) => boolean, onMain?: (file: string) => boolean }} pr
 * The verdict for one PR. `comments` are issue comments and PR reviews ({ body, createdAt, url }), oldest first.
 * `samePatch(sha)` says whether an earlier head has the same changes as the current one.
 * `onMain(file)` says whether a sync merge's file is exempt (`syncExempt`): main takes only gated content, so a
 * person's main → next sync merge (#2106) isn't held on main's own released migration (#2147).
 */
export function coreApproval({ files, head, headRef, headRepo = repo, baseRef = "main", labels = [], title = "", comments, samePatch = (sha) => head.toLowerCase().startsWith(sha.toLowerCase()), onMain = () => false, wordsFiles = new Set() }) {
  // #1740: only this repo's own next → main is the train; a fork's (public repo) or any other base's `next` isn't.
  if (headRef === "next" && headRepo === repo && baseRef === "main") return { state: "success", description: "Deploy train: its PRs were gated into next" };
  const touched = coreFiles(files);
  const core = touched.filter((f) => !onMain(f));
  if (touched.length && !core.length) return { state: "success", description: "Core files are identical to main's (already gated there)" };
  if (!core.length) return { state: "success", description: "No core launch/Meta/money/migration files" };
  // Rollbacks come first (AGENTS): a labelled revert ships without waiting for a verdict.
  if (labels.includes("rollback") && /^revert\b/i.test(title)) return { state: "success", description: "Rollback (revert + rollback label)" };
  const reviews = ctoReviews(comments);
  const reviewer = reviews.filter((r) => samePatch(r.sha)).at(-1);
  const qa = qaApproval(comments, head, samePatch);
  const short = head.slice(0, 7);
  const list = core.length > 2 ? `${core.slice(0, 2).join(", ")} +${core.length - 2}` : core.join(", ");
  // A QA verdict on this head that isn't an approval ("changes requested") holds the PR, whoever else approved.
  if (qa.latest && !qa.approved) return { state: "pending", description: `QA requested changes at ${short}`, url: qa.latest.url };
  const who = reviewer?.approved ? reviewer.body.split(" ")[0].replace(/[*_:]/g, "") : "QA";
  // #364: words only. Launch/Meta/tenant wording ships on green CI; money wording needs one approval, not two.
  if (core.every((f) => !MIGRATION.test(f) && wordsFiles.has(f))) {
    if (!core.some((f) => moneyPath.test(f))) return { state: "success", description: `Words only: prose strings and comments in ${core.length} core file(s)` };
    if (reviewer?.approved || qa.approved) return { state: "success", description: `${who} approved ${short} (money words only)`, url: reviewer?.approved ? reviewer.url : qa.latest?.url };
    return { state: "pending", description: `Money words only: needs one QA/Reviewer/CTO approval of ${short}: ${list}`.slice(0, 140) };
  }
  // Money and migrations need QA and the CTO or Reviewer (AGENTS, ORCHESTRATION item 5); #1083 merged on one.
  if (core.some((f) => moneyPath.test(f) || MIGRATION.test(f))) {
    if (qa.approved && reviewer?.approved) return { state: "success", description: `QA and ${who} approved ${short} (money/migration)`, url: reviewer.url };
    const missing = [qa.approved ? null : "QA", reviewer?.approved ? null : "CTO/Reviewer"].filter(Boolean).join(" and ");
    return { state: "pending", description: `Money/migration: needs ${missing} approval of ${short}: ${list}`.slice(0, 140) };
  }
  if (reviewer?.approved || qa.approved) {
    return { state: "success", description: `${who} approved ${short}`, url: reviewer?.approved ? reviewer.url : qa.latest?.url };
  }
  return { state: "pending", description: `Needs QA/Reviewer/CTO approval of ${short}: ${list}`.slice(0, 140) };
}

function gh(args, opts = {}) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], ...opts });
}
const ghJson = (...args) => JSON.parse(gh(args));
/** `--paginate --jq '.[]|…'` prints one JSON value per line, whatever the page count. */
const ghLines = (...args) => gh(args).split("\n").filter(Boolean).map((line) => JSON.parse(line));

/** The file at a commit, or null when it doesn't exist there. */
function fileAt(file, ref) {
  try {
    return gh(["api", "-H", "Accept: application/vnd.github.raw", `repos/${repo}/contents/${file.split("/").map(encodeURIComponent).join("/")}?ref=${ref}`]);
  } catch (e) {
    if (/HTTP 404/.test(String(e.stderr ?? e.message))) return null;
    throw e;
  }
}

/**
 * #364: the core files whose change is words only. Needs the TypeScript parser: the workflow installs a pinned
 * copy at CORE_APPROVAL_TS; without it (or on any error) the set is empty and every core file stays gated.
 */
async function wordsOnlyFiles(core, baseRef, head) {
  const candidates = core.filter((f) => !MIGRATION.test(f));
  if (!candidates.length || candidates.length > 20) return new Set();
  try {
    const spec = process.env.CORE_APPROVAL_TS ? pathToFileURL(process.env.CORE_APPROVAL_TS).href : "typescript";
    const mod = await import(spec);
    const ts = mod.default ?? mod;
    const base = ghJson("api", `repos/${repo}/compare/${baseRef}...${head}`, "--jq", "{sha: .merge_base_commit.sha}").sha;
    return new Set(candidates.filter((f) => wordsOnly(ts, f, fileAt(f, base), fileAt(f, head))));
  } catch (error) {
    console.log(`words-only check skipped (${error instanceof Error ? error.message.split("\n")[0] : error}); core files stay gated`);
    return new Set();
  }
}

async function main() {
  const { values } = parseArgs({ options: { pr: { type: "string" }, "dry-run": { type: "boolean", default: false } } });
  const n = Number(values.pr);
  if (!Number.isInteger(n) || n <= 0) throw new Error("--pr <number> is required");
  const pr = ghJson("api", `repos/${repo}/pulls/${n}`);
  const head = pr.head.sha;
  const files = ghLines("api", "--paginate", `repos/${repo}/pulls/${n}/files?per_page=100`, "--jq", ".[].filename|tojson");
  const wordsFiles = await wordsOnlyFiles(coreFiles(files), pr.base.ref, head);
  const comments = [
    ...ghLines("api", "--paginate", `repos/${repo}/issues/${n}/comments?per_page=100`, "--jq", ".[]|{body,createdAt:.created_at,url:.html_url}|tojson"),
    ...reviewVerdicts(ghLines("api", "--paginate", `repos/${repo}/pulls/${n}/reviews?per_page=100`, "--jq", ".[]|{body,state,submitted_at,html_url}|tojson")),
  ].filter((c) => c.body).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // Same patch: an approval of an earlier head still counts after a clean merge of the base (as in release.mjs).
  const diffOf = (sha) => gh(["api", "-H", "Accept: application/vnd.github.diff", `repos/${repo}/compare/${pr.base.ref}...${sha}`]);
  // Lazy and fail-safe: GitHub refuses diffs over 300 files (HTTP 406). Then only a verdict on the exact head counts.
  let headLines;
  const memo = new Map();
  const samePatch = (sha) => {
    if (head.toLowerCase().startsWith(sha.toLowerCase())) return true;
    if (!memo.has(sha)) {
      try {
        headLines ??= changedLines(diffOf(head));
        memo.set(sha, changedLines(diffOf(sha)) === headLines);
      } catch { memo.set(sha, false); }
    }
    return memo.get(sha);
  };

  // #2147: a 404 is a missing file (null); any other failure throws, so the status stays pending.
  const blobs = new Map();
  const blob = (file, ref) => {
    const key = `${ref}:${file}`;
    if (!blobs.has(key)) {
      try {
        blobs.set(key, gh(["api", `repos/${repo}/contents/${file.split("/").map(encodeURIComponent).join("/")}?ref=${ref}`, "--jq", ".sha"]).trim() || null);
      } catch (e) {
        if (!/HTTP 404/.test(String(e.stderr ?? e.message))) throw e;
        blobs.set(key, null);
      }
    }
    return blobs.get(key);
  };
  // Only a sync merge qualifies: the head contains main's tip and next doesn't, so a PR that merely reverts a
  // core file to main's copy is still gated.
  const compare = (ref) => ghJson("api", `repos/${repo}/compare/main...${ref}`, "--jq", "{behind_by, base: .merge_base_commit.sha}");
  let sync;
  let base;
  const onMain = (file) => {
    if (sync === undefined) {
      sync = false;
      if (pr.base.ref === "next" && compare(head).behind_by === 0) {
        const next = compare("next");
        if (next.behind_by > 0) { sync = true; base = next.base; }
      }
    }
    return sync && syncExempt({ head: blob(file, head), main: blob(file, "main"), next: blob(file, "next"), base: blob(file, base) });
  };

  const verdict = coreApproval({ files, head, headRef: pr.head.ref, headRepo: pr.head.repo?.full_name ?? "", baseRef: pr.base.ref, labels: pr.labels.map((l) => l.name), title: pr.title, comments, samePatch, onMain, wordsFiles });
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
