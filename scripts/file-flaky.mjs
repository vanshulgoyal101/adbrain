// #618: after the unit shards, open one `flaky` issue per test that only passed on its retry, or comment on the open
// one. Reads the reporter's JSON files (scripts/flaky-reporter.mjs) from the directory given as the first argument.
// Test names come from the repo's own code; gh gets them as arguments, never through a shell.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const LABEL = "flaky";

export function flakyTitle(test) {
  return `Flaky test: ${test.file} › ${test.name}`;
}

/** Dedupes across shards; a test with an open issue gets a comment, a new one gets an issue. */
export function planFlakyIssues(flaky, openIssues) {
  const byTitle = new Map(openIssues.map((issue) => [issue.title, issue.number]));
  const seen = new Set();
  const plan = { comment: [], create: [] };
  for (const test of flaky) {
    const title = flakyTitle(test);
    if (seen.has(title)) continue;
    seen.add(title);
    const number = byTitle.get(title);
    if (number) plan.comment.push({ number, test });
    else plan.create.push({ title, test });
  }
  return plan;
}

function readReports(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((file) => file.endsWith(".json"))
    .flatMap((file) => JSON.parse(readFileSync(join(dir, file), "utf8")));
}

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8" });
}

function main() {
  const flaky = readReports(process.argv[2] ?? "flaky");
  if (!flaky.length) return console.log("No flaky tests.");
  const repo = process.env.GITHUB_REPOSITORY;
  const run = `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  const ref = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME;
  gh(["label", "create", LABEL, "-R", repo, "--color", "fbca04", "--description", "Failed, then passed on retry in CI (#618)", "--force"]);
  const open = JSON.parse(gh(["issue", "list", "-R", repo, "-l", LABEL, "--state", "open", "--limit", "200", "--json", "number,title"]));
  const plan = planFlakyIssues(flaky, open);
  const seenIn = (test) => `\`${test.name}\` failed, then passed on retry ${test.retries} in [this run](${run}) on \`${ref}\`.`;
  for (const { number, test } of plan.comment) {
    gh(["issue", "comment", String(number), "-R", repo, "-b", `CI: again. ${seenIn(test)}`]);
    console.log(`Flaky again: #${number} ${test.name}`);
  }
  for (const { title, test } of plan.create) {
    const body = [
      `CI (#618): ${seenIn(test)} The job stayed green, so this test can hide a real failure or block a PR on a bad retry.`,
      "",
      `**Do:** find why \`${test.file}\` is order- or timing-dependent and fix it at the cause (for example, wait for the effect, not a fixed delay). Close this issue when it's fixed; a later flake reopens the count with a new issue.`,
    ].join("\n");
    const url = gh(["issue", "create", "-R", repo, "-t", title, "-b", body, "-l", LABEL, "-l", "bug", "-l", "ready", "-l", "lane:dev"]).trim();
    console.log(`Flaky: ${url} ${test.name}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
