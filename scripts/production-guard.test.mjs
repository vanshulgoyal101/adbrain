import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { SourceTextModule, SyntheticModule, createContext } from "node:vm";

const source = readFileSync(new URL("./production-guard.mjs", import.meta.url), "utf8");
const bad = { uid: "dpl_bad", url: "bad.invalid", created: 200, meta: { githubCommitSha: "bad-deploy" } };
const newer = { uid: "dpl_new", url: "new.invalid", created: 300, meta: { githubCommitSha: "healthy-new" } };
const prior = { uid: "dpl_old", url: "old.invalid", created: 100, meta: { githubCommitSha: "prior-good" } };
const served = (deployment) => ({ ...deployment, id: deployment.uid, createdAt: deployment.created });

// Run the actual CLI module; only network, CLI execution and workflow-output writes are replaced.
async function rollback({ current = [served(bad), served(bad)], deployments = [newer, bad, prior], sha = "bad-deploy", expectedId } = {}) {
  const promotions = [];
  const logs = [];
  const process = { argv: ["node", "production-guard.mjs", "rollback", sha, expectedId], env: { VERCEL_TOKEN: "synthetic-only" }, exitCode: 0 };
  let reads = 0;
  const context = createContext({
    process, URL,
    console: { log: (message) => logs.push(message) },
    fetch: async (url) => {
      if (url.pathname === "/v13/deployments/adbrain.vanshul.com") {
        const deployment = promotions.length ? served(prior) : current[Math.min(reads++, current.length - 1)];
        if (deployment instanceof Error) throw deployment;
        return { ok: true, json: async () => deployment };
      }
      assert.equal(url.pathname, "/v6/deployments");
      if (deployments instanceof Error) throw deployments;
      return { ok: true, json: async () => ({ deployments }) };
    },
  });
  const guardModule = new SourceTextModule(source, { context });
  await guardModule.link((specifier) => {
    if (specifier === "node:child_process") {
      return new SyntheticModule(["execFileSync"], function () {
        this.setExport("execFileSync", (command, args) => {
          assert.equal(command, "npx");
          assert.deepEqual(Array.from(args.slice(0, 3)), ["--yes", "vercel@60.1.3", "promote"]);
          promotions.push(args[3]);
        });
      }, { context });
    }
    assert.equal(specifier, "node:fs");
    return new SyntheticModule(["appendFileSync"], function () {
      this.setExport("appendFileSync", () => assert.fail("rollback must not write workflow outputs"));
    }, { context });
  });
  let error;
  try { await guardModule.evaluate(); } catch (caught) { error = caught; }
  return { promotions, logs: logs.join("\n"), error, exitCode: error ? 1 : process.exitCode, reads };
}

test("rolls back the still-served failed deployment to its intended prior deployment", async () => {
  const result = await rollback();
  assert.equal(result.error, undefined);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.promotions, ["old.invalid"]);
  assert.equal(result.reads, 2);
});

test("does not promote over a newer release already serving before rollback", async () => {
  const result = await rollback({ current: [served(newer)] });
  assert.deepEqual(result.promotions, []);
  assert.equal(result.exitCode, 0);
  assert.match(result.logs, /Superseded|changed/i);
});

test("rechecks serving identity after candidate lookup and refuses a newly live release", async () => {
  const result = await rollback({ current: [served(bad), served(newer)] });
  assert.deepEqual(result.promotions, []);
  assert.equal(result.exitCode, 0);
  assert.equal(result.reads, 2);
  assert.match(result.logs, /Superseded|changed/i);
});

test("refuses a replacement deployment even when it has the same commit", async () => {
  const replacement = { ...served(bad), id: "dpl_rebuilt", createdAt: 300 };
  const result = await rollback({ current: [served(bad), replacement] });
  assert.deepEqual(result.promotions, []);
  assert.match(result.logs, /Superseded|changed/i);
});

test("final check refuses a changed commit even when the deployment ID still matches", async () => {
  const changed = { ...served(bad), meta: { githubCommitSha: "healthy-new" } };
  const result = await rollback({ current: [served(bad), changed] });
  assert.deepEqual(result.promotions, []);
  assert.equal(result.exitCode, 0);
  assert.equal(result.reads, 2);
  assert.match(result.logs, /Superseded|changed/i);
});

for (const [stage, options] of [
  ["initial identity lookup", { current: [new Error("synthetic API failure")] }],
  ["READY history lookup", { deployments: new Error("synthetic API failure") }],
  ["final identity lookup", { current: [served(bad), new Error("synthetic API failure")] }],
]) {
  test(`cannot promote after a failed ${stage}`, async () => {
    const result = await rollback(options);
    assert.deepEqual(result.promotions, []);
    assert.equal(result.exitCode, 1);
    assert.match(result.error?.message ?? "", /synthetic API failure/);
  });
}

test("cannot promote without an earlier READY deployment", async () => {
  const result = await rollback({ deployments: [newer, bad] });
  assert.deepEqual(result.promotions, []);
  assert.equal(result.exitCode, 1);
  assert.match(result.error?.message ?? "", /No earlier READY/);
});

test("does not guess a rollback boundary when the failed deployment is missing", async () => {
  const result = await rollback({ deployments: [newer, prior] });
  assert.deepEqual(result.promotions, []);
  assert.equal(result.exitCode, 1);
});

test("does not confuse a different deployment of the failed commit with the served deployment", async () => {
  const result = await rollback({ deployments: [newer, { ...bad, uid: "dpl_other" }, prior] });
  assert.deepEqual(result.promotions, []);
  assert.equal(result.exitCode, 1);
});

for (const stage of [0, 1]) {
  for (const unknown of [
    { ...served(bad), meta: {} },
    { ...served(bad), id: undefined },
  ]) {
    test(`fails closed for unknown serving identity at check ${stage + 1}: ${unknown.id ?? "missing id"}`, async () => {
      const current = stage === 0 ? [unknown] : [served(bad), unknown];
      const result = await rollback({ current });
      assert.deepEqual(result.promotions, []);
      assert.equal(result.exitCode, 1);
    });
  }
}

test("authorized drill accepts its explicitly captured commit and deployment ID", async () => {
  const result = await rollback({ sha: "bad-deploy", expectedId: "dpl_bad" });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.promotions, ["old.invalid"]);
});

test("authorized drill cannot roll back a release that replaced its captured deployment", async () => {
  const result = await rollback({ expectedId: "dpl_drill_before" });
  assert.deepEqual(result.promotions, []);
  assert.match(result.logs, /Superseded|changed/i);
});

test("unknown failed commit never authorizes speculative rollback", async () => {
  const result = await rollback({ sha: "unknown", current: [{ ...served(bad), meta: {} }] });
  assert.deepEqual(result.promotions, []);
  assert.equal(result.exitCode, 1);
});

const workflow = readFileSync(new URL("../.github/workflows/production-guard.yml", import.meta.url), "utf8");
const capture = workflow.split("      - name: Capture the authorized drill deployment before the forced smoke\n")[1]
  .split("      - name:")[0].split("        run: |\n")[1].replace(/^          /gm, "");
const drillSha = "a".repeat(40);
for (const [index, fixture] of [
  { name: "captures the served release rather than the workflow ref", current: { sha: drillSha, id: "dpl_captured" }, ok: true },
  { name: "refuses an unknown commit", current: { sha: "unknown", id: "dpl_captured" }, ok: false },
  { name: "refuses a missing deployment ID", current: { sha: drillSha }, ok: false },
  { name: "refuses multiline workflow-output injection", current: { sha: drillSha, id: "dpl_captured\nsha=other" }, ok: false },
].entries()) {
  test(`drill snapshot ${fixture.name}`, () => {
    const output = `.production-guard-test-${process.pid}-${index}`;
    writeFileSync(output, "", { flag: "wx" });
    try {
      const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c",
        'node() { [ "$*" = "scripts/production-guard.mjs live" ] || return 1; printf "%s\\n" "$DRILL_DEPLOYMENT"; }\n' + capture], {
        encoding: "utf8",
        env: { PATH: "/usr/bin:/bin", GITHUB_OUTPUT: output, SHA: "c".repeat(40), DRILL_DEPLOYMENT: JSON.stringify(fixture.current) },
      });
      assert.equal(result.status === 0, fixture.ok, `${fixture.name}: ${result.stderr}`);
      assert.equal(readFileSync(output, "utf8"), fixture.ok ? `sha=${drillSha}\ndeployment=dpl_captured\n` : "");
    } finally { unlinkSync(output); }
  });
}
