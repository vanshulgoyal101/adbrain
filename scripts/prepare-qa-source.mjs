import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, constants, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const digest = value => createHash("sha256").update(value).digest("hex");
const excluded = new Set([".git", ".next", ".vercel", ".qa-artifacts", "node_modules", "coverage", "test-results"]);
const sourcePath = file => typeof file === "string" && file.length > 0 && !isAbsolute(file)
  && !/[\\\0\t\r\n]/.test(file) && posix.normalize(file) === file
  && !file.split("/").some(part => ["", ".", ".."].includes(part) || excluded.has(part) || part.startsWith(".env"));

export function verifyManifest(manifest, head, hash) {
  assert.match(head, /^[a-f0-9]{40}$/);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(manifest.head, head, "Unexpected source HEAD");
  assert.equal(manifest.hash, hash, "Unexpected manifest identity");
  assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0);
  assert.equal(digest(JSON.stringify(manifest.files)), hash, "Manifest content does not match its digest");
  const names = new Set();
  for (const row of manifest.files) {
    assert.ok(sourcePath(row.file), "Unsafe or excluded source path");
    assert.match(row.sha256, /^[a-f0-9]{64}$/);
    assert.ok(!names.has(row.file), "Duplicate source path");
    names.add(row.file);
  }
  return manifest;
}

function filesUnder(root, relative = "") {
  return readdirSync(join(root, relative)).flatMap(name => {
    const file = posix.join(relative, name);
    const stat = lstatSync(join(root, file));
    assert.ok(!stat.isSymbolicLink(), "Symlink refused");
    if (stat.isDirectory()) return filesUnder(root, file);
    assert.ok(stat.isFile(), "Non-regular file refused");
    return [file];
  });
}

export function verifySource(root, manifest) {
  assert.ok(lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink());
  assert.deepEqual(filesUnder(root).sort(), manifest.files.map(row => row.file).sort(), "Source file set differs");
  for (const row of manifest.files) {
    assert.equal(digest(readFileSync(join(root, row.file))), row.sha256, `Source hash differs: ${row.file}`);
  }
  return manifest.files.length;
}

function copySource(source, preferred, manifest) {
  const target = existsSync(preferred) ? `${preferred}-${randomUUID().slice(0, 8)}` : preferred;
  mkdirSync(target, { mode: 0o700 });
  for (const row of manifest.files) {
    const destination = join(target, row.file);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(source, row.file), destination, constants.COPYFILE_EXCL);
  }
  verifySource(target, manifest);
  return target;
}

function main() {
  const { values } = parseArgs({ options: {
    archive: { type: "string" }, head: { type: "string" }, manifest: { type: "string" },
  } });
  assert.ok(values.archive && values.head && values.manifest, "Explicit archive, head and manifest required");
  const repo = process.cwd();
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: "/tmp", LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  const run = (command, args, options = {}) => execFileSync(command, args, {
    env, maxBuffer: 128 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"], ...options,
  });
  assert.equal(run("git", ["rev-parse", "HEAD"]).toString().trim(), values.head, "Checkout HEAD changed");
  const original = resolve(values.archive);
  assert.ok(lstatSync(original).isFile() && !lstatSync(original).isSymbolicLink());
  const archiveHash = digest(readFileSync(original));
  const members = run("tar", ["-tzf", original]).toString().trim().split("\n");
  assert.equal(new Set(members).size, members.length, "Duplicate archive entries");
  assert.ok(members.every(name => sourcePath(name.replace(/\/$/, ""))), "Unsafe archive entry");
  assert.ok(run("tar", ["-tvzf", original]).toString().trim().split("\n").every(line => ["-", "d"].includes(line[0])), "Archive links or special files refused");
  const extract = member => run("tar", ["-xOf", original, member]);
  const prefix = "independent-qa-2026-09-26/final/";
  const manifest = verifyManifest(JSON.parse(extract(`${prefix}source-manifest.json`)), values.head, values.manifest);
  const patch = extract(`${prefix}source.patch`);
  const names = new Set(manifest.files.map(row => row.file));
  const changed = run("git", ["apply", "--numstat", "-z", "-"], { input: patch }).toString().split("\0").filter(Boolean);
  for (const entry of changed) assert.ok(names.has(entry.split("\t")[2]), "Patch modifies a path outside the manifest");
  const base = run("git", ["ls-tree", "-rz", values.head]).toString().split("\0").filter(Boolean)
    .map(entry => ({ mode: entry.slice(0, 6), file: entry.slice(entry.indexOf("\t") + 1) })).filter(row => names.has(row.file));
  assert.ok(base.every(row => ["100644", "100755"].includes(row.mode)), "Base contains non-regular source");
  run("git", ["check-ignore", ".qa-artifacts/devops-qa-a-o1/probe"]);
  const namespace = join(repo, ".qa-artifacts/devops-qa-a-o1");
  mkdirSync(namespace, { recursive: true, mode: 0o700 });
  const evidence = mkdtempSync(join(namespace, "assembly-"));
  const workspace = mkdtempSync("/tmp/adbrain-devops-qa-a-o1-");
  const baseline = join(workspace, "candidate-b");
  mkdirSync(baseline);
  console.log(JSON.stringify({ checkpoint: "allocated", workspace, evidence }));
  const archiveCopy = join(evidence, "baseline-archive.tar.gz");
  copyFileSync(original, archiveCopy, constants.COPYFILE_EXCL);
  assert.equal(digest(readFileSync(archiveCopy)), archiveHash);
  run("tar", ["-xf", "-", "-C", baseline], { input: run("git", ["archive", values.head, "--", ...base.map(row => row.file)]) });
  run("git", ["apply", "--check", "--whitespace=nowarn", "-"], { cwd: baseline, input: patch });
  run("git", ["apply", "--whitespace=nowarn", "-"], { cwd: baseline, input: patch });
  verifySource(baseline, manifest);
  const overlays = [];
  for (const member of members.filter(name => !name.endsWith("/") && /\/(e2e-fixtures|reproducers)\/|\/(qa-network-guard\.cjs|playwright\.config\.ts|qa-local-rest\.mjs|qa-studio-recovery\.mjs|qa-browser-probes\.mjs)$/.test(name))) {
    const content = extract(member);
    const destination = join(evidence, "overlays", member);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content, { mode: 0o600, flag: "wx" });
    overlays.push({ file: member, sha256: digest(content) });
  }
  const currentPaths = [...new Set(run("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).toString().split("\0").filter(sourcePath))].sort();
  const current = currentPaths.filter(file => existsSync(join(repo, file))).map(file => {
    for (let path = file; path !== "."; path = dirname(path)) assert.ok(!lstatSync(join(repo, path)).isSymbolicLink(), "Current source symlink refused");
    return { file, sha256: digest(readFileSync(join(repo, file))) };
  });
  const before = new Map(manifest.files.map(row => [row.file, row.sha256]));
  const after = new Map(current.map(row => [row.file, row.sha256]));
  const delta = {
    modified: current.filter(row => before.has(row.file) && before.get(row.file) !== row.sha256).map(row => ({ ...row, baseline_sha256: before.get(row.file) })),
    added: current.filter(row => !before.has(row.file)),
    missing: manifest.files.filter(row => !after.has(row.file)),
  };
  const copies = {
    dev: copySource(baseline, "/tmp/adbrain-dev-b-o1", manifest),
    dev2: copySource(baseline, "/tmp/adbrain-dev2-devc-o1", manifest),
    qa: copySource(baseline, join(workspace, "qa-candidate-b"), manifest),
  };
  for (const row of current) assert.equal(digest(readFileSync(join(repo, row.file))), row.sha256, "Current source changed during capture; repeat comparison");
  const finalPaths = [...new Set(run("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).toString().split("\0").filter(sourcePath))].sort();
  assert.deepEqual(finalPaths, currentPaths, "Current file list changed during capture");
  assert.equal(digest(readFileSync(original)), archiveHash, "Original QA archive changed");
  const receipt = { board: "O-2", captured_at: new Date().toISOString(), head: values.head,
    manifest: manifest.hash, file_count: manifest.files.length, archive_sha256: archiveHash,
    patch_sha256: digest(patch), baseline, copies, evidence, overlays, overlay_manifest: digest(JSON.stringify(overlays)),
    current_manifest: digest(JSON.stringify(current)), current, delta, runtime: process.version,
    dependencyInstall: "not run; source-only copies", servicesStarted: false, providerCalls: 0 };
  writeFileSync(join(evidence, "source-manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600, flag: "wx" });
  writeFileSync(join(evidence, "assembly-receipt.json"), JSON.stringify(receipt, null, 2), { mode: 0o600, flag: "wx" });
  for (const file of filesUnder(baseline)) chmodSync(join(baseline, file), 0o444);
  console.log(JSON.stringify({ ...receipt, current: undefined, overlays: { count: overlays.length, hash: receipt.overlay_manifest }, delta }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    console.error(JSON.stringify({ error: "QA assembly failed; preserve partial owned outputs for inspection", code: error.code ?? "ASSEMBLY_FAILED", status: error.status }));
    process.exitCode = 1;
  }
}