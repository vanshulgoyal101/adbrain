import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chooseSmokeMode, createStartedSince, createWindowStart } from "../scripts/smoke-mode.mjs";

// #2545: GitHub dropped the Nov 2 03:37Z create cron; the next scheduled picture run must take its place.
const at = (time: string) => new Date(`2026-11-02T${time}:00Z`);
const scheduled = (mode: string, time: string, createdToday: boolean | null, rerun = false) =>
  chooseSmokeMode({ event: "schedule", scheduled: mode, now: at(time), createdToday, rerun });

describe("chooseSmokeMode", () => {
  it("keeps the 03:37Z create when it fires on time", () => {
    expect(scheduled("create", "03:37", false)).toBe("create");
  });

  it("turns the first picture run after 03:37Z into the create when none ran today", () => {
    expect(scheduled("picture", "04:17", false)).toBe("create");
    expect(scheduled("picture", "08:17", false)).toBe("create");
  });

  it("stays one create a day: later picture runs and a late 03:37Z run do pictures", () => {
    expect(scheduled("picture", "04:17", true)).toBe("picture");
    expect(scheduled("create", "05:02", true)).toBe("picture");
  });

  it("never adds a create when unsure: a failed lookup or a re-run does pictures", () => {
    expect(scheduled("picture", "04:17", null)).toBe("picture");
    expect(scheduled("create", "03:37", null)).toBe("picture");
    expect(scheduled("create", "03:40", false, true)).toBe("picture");
  });

  it("never creates before 03:37Z and never touches prepare", () => {
    expect(scheduled("picture", "00:17", false)).toBe("picture");
    expect(scheduled("prepare", "08:47", false)).toBe("prepare");
  });

  it("leaves dispatched runs as asked", () => {
    expect(chooseSmokeMode({ event: "workflow_dispatch", scheduled: "picture", now: at("04:17"), createdToday: false })).toBe("picture");
    expect(chooseSmokeMode({ event: "workflow_dispatch", scheduled: "create", now: at("04:17"), createdToday: true })).toBe("create");
  });
});

describe("createStartedSince", () => {
  // Runs 11 (this one), 12 (picture) and 13 (create); job ids are run * 10.
  const marks: Record<string, string> = { "120": "picture\n", "130": "create\n" };
  const fakeGh = (calls: string[][]) => (args: string[]) => {
    calls.push(args);
    const path = args[2];
    if (path.includes("/workflows/")) return "11\n12\n13\n";
    const run = /runs\/(\d+)\/jobs/.exec(path)?.[1];
    if (run) return `${Number(run) * 10}\n`;
    const job = /check-runs\/(\d+)\//.exec(args[1])![1];
    return marks[job] ?? "";
  };
  const since = createWindowStart(at("04:17"));

  it("finds a job marked create that started since 03:00Z, skipping this run", () => {
    const calls: string[][] = [];
    expect(createStartedSince({ gh: fakeGh(calls), repo: "o/r", runId: "11", since })).toBe(true);
    // Runs from a day earlier, so a run created before 03:00Z that started after it still counts.
    expect(calls[0].slice(0, 3)).toEqual(["api", "--paginate", "repos/o/r/actions/workflows/create-smoke.yml/runs?created=%3E%3D2026-11-01T03%3A00%3A00Z&per_page=100"]);
    const jobs = calls.find((args) => args[2]?.includes("runs/12/jobs"))!;
    expect(jobs[2]).toContain("filter=all");
    expect(jobs[4]).toContain('.started_at >= "2026-11-02T03:00:00Z"');
    expect(calls.some((args) => args[2]?.includes("runs/11/"))).toBe(false);
  });

  it("is false when only picture runs are marked", () => {
    delete marks["130"];
    expect(createStartedSince({ gh: fakeGh([]), repo: "o/r", runId: "11", since })).toBe(false);
  });
});

// #2593: the dispatch-workflows route makes up dropped slots with mode `auto`; it must choose like a schedule.
describe("smoke-mode.mjs with SCHEDULED_MODE=auto", () => {
  it("is treated as a scheduled picture run, never a plain dispatch of `auto`", () => {
    const bin = mkdtempSync(join(tmpdir(), "smoke-mode-"));
    try {
      writeFileSync(join(bin, "gh"), "#!/bin/bash\necho lookup down >&2\nexit 1\n");
      chmodSync(join(bin, "gh"), 0o755);
      const out = execFileSync("node", ["scripts/smoke-mode.mjs"], {
        encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SCHEDULED_MODE: "auto", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_RUN_ATTEMPT: "1", GITHUB_REPOSITORY: "o/r", GITHUB_RUN_ID: "1" },
      });
      // Before 03:37Z it's a picture; after, the failed lookup keeps it a picture. A working lookup makes it `create`.
      expect(out).toBe("picture\n");
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  });
});
