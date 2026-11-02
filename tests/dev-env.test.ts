import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// #2490: scripts/lib/dev-env.sh gives any worktree the pinned Node and a node_modules from the lockfile cache.
const lib = resolve(__dirname, "../scripts/lib/dev-env.sh");
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "dev-env-"));
  dirs.push(dir);
  const root = join(dir, "wt");
  mkdirSync(root);
  writeFileSync(join(root, "package-lock.json"), '{"lockfileVersion":3}');
  return { home: join(dir, "home"), root };
}

function run(script: string, env: Record<string, string>) {
  return spawnSync("bash", ["-c", `set -euo pipefail; source "${lib}"; ${script}`], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function seedCache(home: string, root: string) {
  const hash = run(`lockfile_hash "${root}"`, { HOME: home }).stdout.trim();
  const cache = join(home, "Library/Caches/adbrain/node_modules", hash);
  mkdirSync(cache, { recursive: true });
  writeFileSync(join(cache, ".package-lock.json"), "{}");
  writeFileSync(join(cache, "from-cache"), "yes");
  return cache;
}

describe("#2490 dev-env.sh", () => {
  it("says which Node to install instead of exiting silently when the pinned major is missing", () => {
    const { home, root } = sandbox();
    writeFileSync(join(root, ".nvmrc"), "99\n");
    const result = run(`use_pinned_node "${root}"; echo after`, { HOME: home, NVM_DIR: join(home, "nvm") });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Node 99 is required");
    expect(result.stdout).not.toContain("after");
  });

  // `cp -c` (APFS clone) is macOS-only, where workers run this; CI installs with npm ci.
  it.runIf(process.platform === "darwin")("replaces a partial node_modules from the cache", () => {
    const { home, root } = sandbox();
    seedCache(home, root);
    mkdirSync(join(root, "node_modules"));
    writeFileSync(join(root, "node_modules/half-copied"), "");
    const result = run(`ensure_node_modules "${root}"`, { HOME: home });
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(root, "node_modules/from-cache"), "utf8")).toBe("yes");
    expect(existsSync(join(root, "node_modules/half-copied"))).toBe(false);
    expect(existsSync(join(root, ".node_modules.tmp"))).toBe(false);
  });

  it.runIf(process.platform === "darwin")("replaces node_modules installed from another lockfile", () => {
    const { home, root } = sandbox();
    seedCache(home, root);
    mkdirSync(join(root, "node_modules"));
    writeFileSync(join(root, "node_modules/.package-lock.json"), "{}");
    writeFileSync(join(root, "node_modules/.lock-sha256"), "old-lockfile-hash");
    const result = run(`ensure_node_modules "${root}"`, { HOME: home });
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(root, "node_modules/from-cache"), "utf8")).toBe("yes");
    // The next run trusts what it just installed.
    expect(run(`ensure_node_modules "${root}" && ls "${root}/node_modules"`, { HOME: home }).stdout).toContain("from-cache");
  });

  it.runIf(process.platform === "darwin")("keeps an old cache it just used instead of pruning it", () => {
    const { home, root } = sandbox();
    const cache = seedCache(home, root);
    const old = new Date(Date.now() - 20 * 24 * 3600 * 1000);
    utimesSync(cache, old, old);
    const result = run(`ensure_node_modules "${root}"`, { HOME: home });
    expect(result.status, result.stderr).toBe(0);
    expect(statSync(cache).isDirectory()).toBe(true);
    expect(existsSync(join(cache, ".package-lock.json"))).toBe(true);
  });
});
