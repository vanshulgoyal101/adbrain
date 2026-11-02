import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import FlakyReporter from "../scripts/flaky-reporter.mjs";
import { flakyTitle, planFlakyIssues } from "../scripts/file-flaky.mjs";

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

function testCase(name: string, state: "passed" | "failed", flaky: boolean, retryCount = flaky ? 1 : 0) {
  return {
    fullName: name,
    module: { moduleId: join(process.cwd(), "tests/sample.test.tsx") },
    result: () => ({ state }),
    diagnostic: () => ({ flaky, retryCount }),
  };
}

// #618: CI retries a failed test once; one that passes on the retry is flaky, recorded and filed, not a red job.
describe("#618 flaky reporter", () => {
  it("records only tests that passed on a retry, and appends across runs in one job", () => {
    const dir = mkdtempSync(join(tmpdir(), "flaky-"));
    dirs.push(dir);
    const out = join(dir, "nested", "shard-1.json");
    vi.stubEnv("FLAKY_REPORT", out);
    const first = new FlakyReporter();
    first.onTestCaseResult(testCase("steady", "passed", false));
    first.onTestCaseResult(testCase("wobbly > shows the review", "passed", true));
    first.onTestCaseResult(testCase("broken", "failed", false, 1));
    first.onTestRunEnd();
    const second = new FlakyReporter();
    second.onTestCaseResult(testCase("other wobble", "passed", true));
    second.onTestRunEnd();
    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual([
      { file: "tests/sample.test.tsx", name: "wobbly > shows the review", retries: 1 },
      { file: "tests/sample.test.tsx", name: "other wobble", retries: 1 },
    ]);
  });

  it("writes nothing without a report path", () => {
    vi.stubEnv("FLAKY_REPORT", "");
    const reporter = new FlakyReporter();
    reporter.onTestCaseResult(testCase("wobbly", "passed", true));
    expect(() => reporter.onTestRunEnd()).not.toThrow();
  });

  it("opens one issue per new flaky test and comments on an open one, deduped across shards", () => {
    const seen = { file: "tests/a.test.tsx", name: "a > opens", retries: 1 };
    const fresh = { file: "tests/b.test.tsx", name: "b > saves", retries: 1 };
    const plan = planFlakyIssues([seen, fresh, { ...fresh }], [{ number: 7, title: flakyTitle(seen) }]);
    expect(plan).toEqual({
      comment: [{ number: 7, test: seen }],
      create: [{ title: "Flaky test: tests/b.test.tsx › b > saves", test: fresh }],
    });
  });
});
