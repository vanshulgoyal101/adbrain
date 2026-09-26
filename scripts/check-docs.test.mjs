import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { checkDocumentation } from "./check-docs.mjs";

function fixture(context, files = {}) {
  const root = mkdtempSync(resolve(tmpdir(), "adbrain-docs-check-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [file, contents] of Object.entries({
    "package.json": JSON.stringify({ scripts: { test: "vitest run", "docs:check": "node scripts/check-docs.mjs" } }),
    ...files,
  })) {
    const path = resolve(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }
  return root;
}

test("parses reference links, parentheses, encoded paths and GitHub duplicate headings", context => {
  const root = fixture(context, {
    "README.md": "# Start\n[Guide][guide]\n[Source](src/app/(app)/sample.ts#L2)\n[Named](docs/My%20Guide.md#named)\n[Second](docs/My%20Guide.md#same-1)\n\n[guide]: docs/My%20Guide.md#same\n",
    "docs/My Guide.md": '# Same\n# Same\n<a id="named"></a>\n',
    "src/app/(app)/sample.ts": "export const value = 1;\nexport const next = 2;\n",
  });
  assert.equal(checkDocumentation(root).errors, 0);
});

test("fails missing headings, invalid JSON and commands without revealing example values", context => {
  const root = fixture(context, {
    "README.md": '# Start\n[Missing](#absent)\n`npm run imaginary`\n```json\n{"privateExample": DO_NOT_ECHO}\n```\n',
  });
  const result = checkDocumentation(root);
  assert.equal(result.errors, 3);
  assert(!JSON.stringify(result.diagnostics).includes("DO_NOT_ECHO"));
});

test("keeps historical and unavailable private evidence separate from current errors", context => {
  const root = fixture(context, {
    "README.md": "# Start\n[Receipt](.qa-artifacts/missing.json)\n",
    "docs/qa/old.md": "# Old\n[Historical file](gone.md)\n",
    "docs/ROADMAP-HISTORY-2026-09-26.md": "# Old roadmap\n`npm run retired`\n",
  });
  const current = checkDocumentation(root);
  assert.equal(current.checked.length, 1);
  assert.equal(current.errors, 0);
  assert.equal(current.warnings, 1);
  const all = checkDocumentation(root, { all: true });
  assert.equal(all.checked.length, 3);
  assert.equal(all.errors, 0);
  assert.equal(all.warnings, 3);
  assert.equal(all.inventory.find(entry => entry.file === "docs/qa/old.md").role, "historical");
  assert.equal(all.inventory.find(entry => entry.file.endsWith("HISTORY-2026-09-26.md")).role, "historical");
});

test("inventories handler exports, environment keys and migrations without importing application code", context => {
  const root = fixture(context, {
    "README.md": "# Start\n",
    "src/app/api/example/[id]/route.ts": 'throw new Error("must never execute");\nexport async function GET() {}\nexport const POST = () => {};\nexport { handler as DELETE };\nprocess.env.API_SETTING;\nprocess.env["OTHER_SETTING"];\n',
    "src/lib/env.ts": "const envSchema = z.object({ FEATURE_ENABLED: z.boolean() });\nenvironment.LOCAL_TEST_ENABLED;\n",
    ".env.example": "EXAMPLE_SETTING=synthetic-only\n",
    "db/migrations/20260926_example.sql": "create table if not exists private.example(id uuid);\n",
  });
  const result = checkDocumentation(root);
  assert.deepEqual(result.source.routes[0].methods, ["DELETE", "GET", "POST"]);
  assert.equal(result.source.routes[0].path, "/api/example/[id]");
  assert.deepEqual(result.source.environment, ["API_SETTING", "EXAMPLE_SETTING", "FEATURE_ENABLED", "LOCAL_TEST_ENABLED", "OTHER_SETTING"]);
  assert.deepEqual(result.source.tables, ["private.example"]);
  assert.equal(result.coverage.migrationsNotMentioned.length, 1);
});

test("CLI executes through a symlink and returns a failing exit code for current errors", context => {
  const root = fixture(context, { "README.md": "# Start\n[Missing](absent.md)\n" });
  const link = resolve(root, "check.mjs");
  symlinkSync(fileURLToPath(new URL("./check-docs.mjs", import.meta.url)), link);
  const result = spawnSync(process.execPath, [link, "--root", root, "--json"], { encoding: "utf8" });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(result.stdout).errors, 1);
});

test("reports unclosed fences without rejecting closed quoted or longer fences", context => {
  const root = fixture(context, {
    "README.md": "# Start\n> ```sh\n> npm test\n> ````\n\n```sh\nnpm test\n",
  });
  const result = checkDocumentation(root);
  assert.equal(result.errors, 1);
  assert.equal(result.diagnostics[0].message, "Unclosed fenced code block");
});