// #618: a Vitest reporter for CI. With `retry: 1`, a test that fails and then passes on its retry is flaky: the job
// stays green and the test is recorded here, so `file-flaky.mjs` can open or update its `flaky` issue.
// Appends, because one job runs Vitest more than once (changed-file tests, then file-scanning tests).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";

export default class FlakyReporter {
  // Vitest passes its reporter options here; the report path comes only from FLAKY_REPORT.
  constructor() {
    this.out = process.env.FLAKY_REPORT;
    this.flaky = [];
  }

  onTestCaseResult(test) {
    const diagnostic = test.diagnostic();
    if (!diagnostic?.flaky || test.result().state !== "passed") return;
    this.flaky.push({ file: relative(process.cwd(), test.module.moduleId), name: test.fullName, retries: diagnostic.retryCount });
  }

  onTestRunEnd() {
    if (!this.out) return;
    const earlier = existsSync(this.out) ? JSON.parse(readFileSync(this.out, "utf8")) : [];
    mkdirSync(dirname(this.out), { recursive: true });
    writeFileSync(this.out, JSON.stringify([...earlier, ...this.flaky], null, 2));
  }
}
