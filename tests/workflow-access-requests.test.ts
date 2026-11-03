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
  return body.join("\n").replaceAll("node scripts/access-request-action.mjs", 'node "$SCRIPTS/access-request-action.mjs"');
}

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

type Match = { number: number; state: "OPEN" | "CLOSED"; closedAt: string | null };

function runStep(response: unknown, existing: Record<string, Match[]> = {}, failOn = "") {
  dir = mkdtempSync(join(tmpdir(), "access-step-"));
  writeFileSync(join(dir, "response.json"), JSON.stringify(response));
  writeFileSync(join(dir, "curl"), `#!/bin/bash\nwhile [ $# -gt 0 ]; do [ "$1" = -o ] && cp "${dir}/response.json" "$2"; shift; done\nprintf 200\n`);
  writeFileSync(join(dir, "gh"), `#!/bin/bash
echo "$*" >> "${dir}/gh.log"
[ "$1 $2" = "issue ${failOn}" ] && exit 1
if [ "$1 $2" = "issue list" ]; then for k in ${Object.keys(existing).join(" ")}; do [[ "$*" == *"$k"* ]] && { cat "${dir}/$k.json"; exit 0; }; done; echo '[]'; exit 0; fi
if [ "$1 $2" = "issue create" ]; then while [ $# -gt 0 ]; do [ "$1" = -b ] && printf '%s\0' "$2" >> "${dir}/bodies"; shift; done; echo "https://github.com/o/r/issues/$RANDOM"; fi
`);
  for (const [k, matches] of Object.entries(existing)) writeFileSync(join(dir, `${k}.json`), JSON.stringify(matches));
  chmodSync(join(dir, "curl"), 0o755);
  chmodSync(join(dir, "gh"), 0o755);
  const run = () => execFileSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", stepScript()], {
    cwd: dir,
    env: { SCRIPTS: join(process.cwd(), "scripts"), NODE_ENV: "test", PATH: `${dir}:${process.env.PATH}`, CRON_SECRET: "s", BASE: "https://example.test", GITHUB_REPOSITORY: "o/r",
      GITHUB_SERVER_URL: "https://github.com", GITHUB_RUN_ID: "1" },
    stdio: "pipe",
  });
  if (failOn) expect(run).toThrow(); else run();
  let log = "";
  try { log = readFileSync(join(dir, "gh.log"), "utf8"); } catch { /* no gh calls */ }
  return log.trim().split("\n").filter(Boolean);
}

function createdBodies(): string[] {
  try { return readFileSync(join(dir, "bodies"), "utf8").split("\0").filter(Boolean); } catch { return []; }
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
    const calls = runStep({ ok: true, requests: [{ key: key(1), hours: 1 }, { key: "bad;key", hours: 1 }, { key: key(2), hours: 2 }], more: 0 }, { [key(1)]: [{ number: 7, state: "OPEN", closedAt: null }] });
    expect(calls.filter((call) => call.startsWith("issue create"))).toEqual([expect.stringContaining(`(${key(2)})`)]);
    expect(calls.some((call) => call.startsWith("issue comment"))).toBe(false);
  });

  // #2806: asking again after the CEO closed the issue must reach the CEO, not vanish.
  const closed: Match = { number: 9, state: "CLOSED", closedAt: "2026-11-02T12:55:00Z" };
  const at = (iso: string) => ({ ok: true, requests: [{ key: key(4), hours: 5, at: iso }], more: 0 });

  it("reopens a closed issue once when the person asked again after it closed", () => {
    const calls = runStep(at("2026-11-02T18:22:00.000Z"), { [key(4)]: [closed] });
    expect(calls.filter((call) => call.startsWith("issue create"))).toEqual([]);
    expect(calls.filter((call) => call.startsWith("issue reopen"))).toEqual(["issue reopen 9 -R o/r"]);
    expect(calls).toContain("issue edit 9 -R o/r --add-label waiting-owner");
    const comments = calls.filter((call) => call.startsWith("issue comment"));
    expect(comments).toHaveLength(1);
    expect(comments[0]).toContain("Asked again 5 h ago → CEO");
  });

  it.each(["edit", "comment", "reopen"])("fails the step and keeps the handoff retryable when `gh issue %s` fails (#2806)", (failing) => {
    const calls = runStep(at("2026-11-02T18:22:00.000Z"), { [key(4)]: [closed] }, failing);
    // The issue only reopens after the label and comment landed; until then it stays closed, so the next run tries again.
    if (failing !== "reopen") expect(calls.some((call) => call.startsWith("issue reopen"))).toBe(false);
    const retry = runStep(at("2026-11-02T18:22:00.000Z"), { [key(4)]: [closed] });
    expect(retry).toContain("issue reopen 9 -R o/r");
  });

  it("does nothing for a closed issue when the request is older than its close, or an issue is open", () => {
    expect(runStep(at("2026-11-02T12:00:00.000Z"), { [key(4)]: [closed] }).some((call) => /^issue (create|reopen|comment)/.test(call))).toBe(false);
    const open: Match = { number: 12, state: "OPEN", closedAt: null };
    expect(runStep(at("2026-11-03T01:00:00.000Z"), { [key(4)]: [closed, open] }).some((call) => /^issue (create|reopen|comment)/.test(call))).toBe(false);
  });

  it("keeps one issue per key when an older deploy sends no request time", () => {
    const calls = runStep({ ok: true, requests: [{ key: key(4), hours: 5 }], more: 0 }, { [key(4)]: [closed] });
    expect(calls.some((call) => /^issue (create|reopen|comment)/.test(call))).toBe(false);
  });

  it("asks for a private follow-up and App Review tracking, never a Tester invite (#2582)", () => {
    runStep({ ok: true, requests: [{ key: key(3), hours: 4 }], more: 0 });
    const [body, ...rest] = createdBodies();
    expect(rest).toEqual([]);
    expect(body).toContain("The app told them: we will WhatsApp you within a working day.");
    expect(body).toContain(`(key ${key(3)})`);
    expect(body).toMatch(/→ CEO: WhatsApp them privately about this request/);
    expect(body).toContain("#156");
    expect(body).not.toMatch(/tester/i);
    expect(body).not.toMatch(/#679/);
  });
});
