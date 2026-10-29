// #1627: the repo is public. Scans issue/PR bodies and comments changed since `--since` for customer data
// (Indian mobiles, emails, Meta ids, tokens, JWTs, payment ids) and records only the URL and the pattern type in one
// `owner:devops` issue. Never prints or stores a match.
//   node scripts/scan-public-data.mjs [--since <previous run's start, ISO>] [--dry-run]   (default: the last 30 min)
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const internal = JSON.parse(readFileSync(join(root, "src/lib/internal-accounts.json"), "utf8"));
const TEAM_DOMAINS = new Set([...(internal.domains ?? []), "example.com", "example.org", "example.invalid", "users.noreply.github.com"]);
const TEST_ACCOUNTS = new Set((internal.testAdAccountIds ?? []).map(String));
// The team's own Meta assets (Solaride, the owner's pilot business, and the AdBrain app): public by design, not customer data.
const TEAM_META_IDS = new Set(["2398686420592052", "885223068001054", "2286157145462990", "1158100643072508"]);
// The team's published business WhatsApp (the CTA in Solaride's live ads), stored as sha256 of its 10 digits so the number isn't repeated here.
const TEAM_PHONE_HASHES = new Set(["499ae9b5c6bf1de4fc2b431874783cb29f3e0d4286874ad9d003697541cc3226"]);
const teamPhone = (ten) => TEAM_PHONE_HASHES.has(createHash("sha256").update(ten).digest("hex"));

// Fake ids the team uses on purpose: 9000…/1234…/0000… runs and repeated digits.
const fakeNumber = (digits) => /^(9000|1234|0000)/.test(digits) || /^(\d)\1+$/.test(digits) || digits === "9876543210" || TEAM_META_IDS.has(digits);

/** GitHub's own ids (comment, review and run numbers) live in its URLs; drop URLs before matching digits. */
const withoutUrls = (text) => text.replace(/https?:\/\/\S+/g, " ").replace(/\b(issuecomment|pullrequestreview|discussion_r)-\d+/g, " ")
  .replace(/\b(comment|review|run|job|pr|issue|artifact)s?\s+#?\d{6,}(?:(?:\s*,\s*|\s+(?:and|or)\s+)#?\d{6,})*/gi, " ");

export const PATTERNS = [
  ["token", /\bEAA[A-Za-z0-9]{30,}/g],
  ["token", /\bsk-or-v1-[a-f0-9]{32,}/g],
  ["token", /\brzp_(live|test)_[A-Za-z0-9]{10,}/g],
  ["token", /\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g],
  ["jwt", /\beyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/g],
  ["payment_id", /\b(pay|order|rfnd|plink)_[A-Za-z0-9]{14}\b/g],
  ["email", /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+\.)+[A-Za-z]{2,}\b/g, (m) => !TEAM_DOMAINS.has(m.split("@")[1].toLowerCase())],
  ["meta_ad_account", /\bact_(\d{6,})\b/g, (m) => !fakeNumber(m.slice(4)) && !TEST_ACCOUNTS.has(m) && !TEST_ACCOUNTS.has(m.slice(4))],
  ["meta_id", /(?<![\d.\w-])\d{15,17}(?![\d\w])/g, (m) => !fakeNumber(m)],
  ["indian_mobile", /(?<![\d\w])(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?![\d\w])/g, (m) => !fakeNumber(m.replace(/\D/g, "").slice(-10)) && !teamPhone(m.replace(/\D/g, "").slice(-10))],
];

/** The pattern types found in one text, sorted and unique. Matches themselves are never returned. */
export function scan(text) {
  const found = new Set();
  const plain = withoutUrls(text ?? "");
  for (const [type, re, keep = () => true] of PATTERNS) {
    for (const match of (type === "token" || type === "jwt" ? text ?? "" : plain).matchAll(re)) {
      if (keep(match[0])) { found.add(type); break; }
    }
  }
  return [...found].sort();
}

const TITLE = "Possible customer data in a public issue or PR";

async function main() {
  const { values } = parseArgs({ options: { since: { type: "string" }, "dry-run": { type: "boolean", default: false } } });
  const repo = process.env.GITHUB_REPOSITORY ?? "vanshulgoyal101/adbrain";
  const token = process.env.GH_TOKEN;
  if (values.since && Number.isNaN(Date.parse(values.since))) throw new Error("--since must be an ISO time.");
  const headers = { Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const api = async (path, init) => {
    const response = await fetch(`https://api.github.com/repos/${repo}${path}`, { ...init, headers: { ...headers, ...init?.headers } });
    if (!response.ok) throw new Error(`GitHub ${response.status} on ${path.split("?")[0]}`);
    return response.json();
  };
  const pages = async (path) => {
    const all = [];
    for (let page = 1; page <= 10; page++) {
      const batch = await api(`${path}&per_page=100&page=${page}`);
      all.push(...batch);
      if (batch.length < 100) break;
    }
    return all;
  };
  // 5 minutes of overlap with the previous run; already-listed URLs are skipped below.
  const since = new Date((values.since ? Date.parse(values.since) : Date.now() - 30 * 60_000) - 5 * 60_000).toISOString();
  const items = [
    ...(await pages(`/issues?state=all&since=${since}`)).map((i) => ({ url: i.html_url, body: `${i.title}\n${i.body ?? ""}`, title: i.title })),
    ...(await pages(`/issues/comments?since=${since}`)).map((c) => ({ url: c.html_url, body: c.body })),
    ...(await pages(`/pulls/comments?since=${since}`)).map((c) => ({ url: c.html_url, body: c.body })),
  ].filter((item) => item.title !== TITLE);
  const hits = items.map((item) => ({ url: item.url, types: scan(item.body) })).filter((hit) => hit.types.length);
  console.log(`Scanned ${items.length} bodies/comments since ${since}: ${hits.length} with possible customer data.`);
  if (!hits.length) return;

  const open = (await api(`/issues?state=open&labels=owner:devops&per_page=100`)).find((issue) => issue.title === TITLE);
  const known = open?.body ?? "";
  const fresh = hits.filter((hit) => !known.includes(hit.url));
  const lines = fresh.map((hit) => `- [ ] ${hit.url}: ${hit.types.join(", ")}`).join("\n");
  for (const hit of fresh) console.log(`${hit.url}: ${hit.types.join(", ")}`);
  if (!fresh.length || values["dry-run"]) return;
  const intro = "DevOps redacts each item (edit the comment; replace the value with an opaque key), then ticks it. Only the URL and pattern type are listed here, never the value (#1627).";
  if (open) await api(`/issues/${open.number}`, { method: "PATCH", body: JSON.stringify({ body: `${known}\n${lines}` }) });
  else await api("/issues", { method: "POST", body: JSON.stringify({ title: TITLE, labels: ["core", "owner:devops"], body: `${intro}\n\n${lines}` }) });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.log(`::warning::public-data scan failed: ${String(error?.message ?? error).slice(0, 160)}`); });
}
