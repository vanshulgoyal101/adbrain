import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// #725: the scheduled job's "Facebook access requests" step, run as written in the workflow with stub
// curl and gh, so its public-issue cap and dedupe are tested, not just read.
function stepScript(): string {
  const lines = readFileSync(join(process.cwd(), ".github/workflows/scheduled-jobs.yml"), "utf8").split("\n");
  const start = lines.findIndex((line) => line.includes("- name: Facebook access requests"));
  const run = lines.findIndex((line, index) => index > start && line.trim() === "run: |");
  const body: string[] = [];
  for (const line of lines.slice(run + 1)) {
    if (line.trim() && !line.startsWith("          ")) break;
    body.push(line.slice(10));
  }
  return body.join("\n");
}

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function runStep(response: unknown, existingKeys: string[] = []) {
  dir = mkdtempSync(join(tmpdir(), "access-step-"));
  writeFileSync(join(dir, "response.json"), JSON.stringify(response));
  writeFileSync(join(dir, "curl"), `#!/bin/bash\nwhile [ $# -gt 0 ]; do [ "$1" = -o ] && cp "${dir}/response.json" "$2"; shift; done\nprintf 200\n`);
  writeFileSync(join(dir, "gh"), `#!/bin/bash
echo "$*" >> "${dir}/gh.log"
if [ "$1 $2" = "issue list" ]; then for k in ${existingKeys.join(" ")}; do [[ "$*" == *"$k"* ]] && { echo 1; exit 0; }; done; echo 0; exit 0; fi
if [ "$1 $2" = "issue create" ]; then echo "https://github.com/o/r/issues/$RANDOM"; fi
`);
  chmodSync(join(dir, "curl"), 0o755);
  chmodSync(join(dir, "gh"), 0o755);
  execFileSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", stepScript()], {
    cwd: dir,
    env: { NODE_ENV: "test", PATH: `${dir}:${process.env.PATH}`, CRON_SECRET: "s", BASE: "https://example.test", GITHUB_REPOSITORY: "o/r",
      GITHUB_SERVER_URL: "https://github.com", GITHUB_RUN_ID: "1" },
    stdio: "pipe",
  });
  let log = "";
  try { log = readFileSync(join(dir, "gh.log"), "utf8"); } catch { /* no gh calls */ }
  return log.trim().split("\n").filter(Boolean);
}

const key = (n: number) => n.toString(16).padStart(12, "a");

describe("scheduled job: Facebook access requests (#692, #725)", () => {
  it("opens at most 5 public issues for 20 new keys, and notes the rest on the newest", () => {
    const calls = runStep({ ok: true, requests: Array.from({ length: 20 }, (_, n) => ({ key: key(n), hours: n })), more: 3 });
    const created = calls.filter((call) => call.startsWith("issue create"));
    expect(created).toHaveLength(5);
    for (const call of created) expect(call).toMatch(/-l core -l waiting-owner -t Facebook access request \([a-f0-9]{12}\)/);
    expect(calls.filter((call) => call.startsWith("issue comment"))).toEqual([
      expect.stringMatching(/^issue comment https:\/\/github\.com\/o\/r\/issues\/\d+ -R o\/r --body 18 more access requests are waiting/),
    ]);
  });

  it("skips keys that already have an issue and malformed keys, with no note when nothing waits", () => {
    const calls = runStep({ ok: true, requests: [{ key: key(1), hours: 1 }, { key: "bad;key", hours: 1 }, { key: key(2), hours: 2 }], more: 0 }, [key(1)]);
    expect(calls.filter((call) => call.startsWith("issue create"))).toEqual([expect.stringContaining(`(${key(2)})`)]);
    expect(calls.some((call) => call.startsWith("issue comment"))).toBe(false);
  });
});
