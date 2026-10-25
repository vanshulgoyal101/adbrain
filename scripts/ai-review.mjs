// Advisory AI review of high-risk PR changes (#423), on Groq's free tier ($0): money, Meta,
// migrations, auth and tenant code only. Never blocks a merge; rate limits are skipped with a note.
//   node scripts/ai-review.mjs <pr-number>   (CI: GITHUB_REPOSITORY, GH_TOKEN, GROQ_REVIEW_API_KEY)
// Runs from the base commit in CI, so a PR's own code never runs with the key.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const HIGH_RISK = /^(db\/migrations\/|src\/lib\/(meta|payments|managed|supabase|security)\/|src\/app\/api\/(auth|payments|meta|spend-limits)\/|src\/(middleware|proxy)\.ts$)/;
// Production's interview and planner use qwen on Groq; a separate model keeps its own rate limit.
export const MODEL = "openai/gpt-oss-120b";
export const MARKER = "<!-- ai-review -->";
// Groq free tier: 8,000 tokens a minute for this model; ~16k chars of diff plus the answer fits once.
const MAX_DIFF_CHARS = 16_000;

/** Splits a unified diff into per-file chunks and keeps only high-risk files, capped in size. */
export function highRiskDiff(diff) {
  const files = diff.split(/(?=^diff --git )/m).filter(Boolean);
  const kept = [];
  const skipped = [];
  let size = 0;
  for (const chunk of files) {
    const path = chunk.match(/^diff --git a\/(\S+)/)?.[1];
    if (!path || !HIGH_RISK.test(path)) continue;
    if (size + chunk.length > MAX_DIFF_CHARS) { skipped.push(path); continue; }
    kept.push({ path, chunk });
    size += chunk.length;
  }
  return { paths: kept.map((f) => f.path), diff: kept.map((f) => f.chunk).join(""), skipped };
}

export function prompt(title, diff) {
  return [
    { role: "system", content: "You review a pull request for AdBrain, a Next.js + Supabase app that runs Meta ads for small businesses and handles their money. Report only high-confidence, concrete problems: security holes (tenant isolation, RLS, auth, secrets in logs or URLs, SSRF), money errors (charging, refunds, spend caps, rounding, GST), data loss, broken migrations (locks, irreversible changes, missing RLS or grants), and logic bugs. Ignore style, naming and tests unless a test hides a bug. For each finding give `path:line`, the problem and a fix in at most 3 sentences. If nothing is clearly wrong, reply exactly: No high-confidence findings." },
    { role: "user", content: `PR title: ${title}\n\nDiff (high-risk files only):\n${diff}` },
  ];
}

/** @param {{ model: string, paths: string[], skipped: string[], body: string | null, note?: string | null }} review */
export function renderComment({ model, paths, skipped, body, note = null }) {
  const lines = [MARKER, `**AI review (advisory, not a verdict; free ${model} on Groq, #423).** Files: ${paths.map((p) => `\`${p}\``).join(", ") || "none"}.`];
  if (skipped.length) lines.push(`Not reviewed (diff too large): ${skipped.map((p) => `\`${p}\``).join(", ")}.`);
  lines.push("", note ?? body);
  return lines.join("\n");
}

const gh = (...args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

async function main() {
  const pr = process.argv[2];
  const repo = process.env.GITHUB_REPOSITORY;
  const key = process.env.GROQ_REVIEW_API_KEY;
  if (!/^\d+$/.test(pr ?? "") || !repo) throw new Error("Usage: ai-review.mjs <pr-number> (needs GITHUB_REPOSITORY)");
  if (!key) { console.log("GROQ_REVIEW_API_KEY not available (fork PR?); skipped."); return; }
  const title = JSON.parse(gh("pr", "view", pr, "-R", repo, "--json", "title")).title;
  const { paths, diff, skipped } = highRiskDiff(gh("pr", "diff", pr, "-R", repo));
  if (!paths.length && !skipped.length) { console.log("No high-risk files; nothing to review."); return; }
  let body = null, note = null;
  if (!paths.length) note = "Skipped: every high-risk file's diff is too large for the free model.";
  else {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, messages: prompt(title, diff), temperature: 0.1, max_tokens: 2000, reasoning_effort: "low", include_reasoning: false }),
      signal: AbortSignal.timeout(90_000),
    }).catch(() => null);
    if (!response?.ok) note = `Skipped: Groq answered ${response ? `HTTP ${response.status}` : "nothing"} (free tier busy or rate-limited). The PR isn't blocked; push again to retry.`;
    else body = (await response.json())?.choices?.[0]?.message?.content?.trim() || "Skipped: the model returned an empty answer.";
  }
  const comment = renderComment({ model: MODEL, paths, skipped, body, note });
  const existing = JSON.parse(gh("api", `repos/${repo}/issues/${pr}/comments?per_page=100`)).find((c) => c.body?.startsWith(MARKER));
  if (existing) gh("api", "-X", "PATCH", `repos/${repo}/issues/comments/${existing.id}`, "-f", `body=${comment}`);
  else gh("api", "-X", "POST", `repos/${repo}/issues/${pr}/comments`, "-f", `body=${comment}`);
  console.log(note ?? `Reviewed ${paths.length} file(s).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((error) => {
    // Advisory: never fail the PR.
    console.log(`::warning::AI review skipped: ${error instanceof Error ? error.message.slice(0, 200) : "error"}`);
  });
}
