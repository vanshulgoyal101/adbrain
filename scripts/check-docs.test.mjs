import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { appCopy, checkDocumentation, environmentDrift, mirrorDrift, missingLabels, moneyDrift, moneyFacts, scheduleDrift, scriptEnvironment, stampMirror } from "./check-docs.mjs";

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
    "README.md": "# Start\n[Guide][guide]\n[Source](src/app/(app)/sample.ts#L2)\n[Named](docs/team/My%20Guide.md#named)\n[Second](docs/team/My%20Guide.md#same-1)\n\n[guide]: docs/team/My%20Guide.md#same\n",
    "docs/README.md": "# Docs\n[Team](team/README.md)\n",
    "docs/team/README.md": "# Team\n[Guide](My%20Guide.md)\n",
    "docs/team/My Guide.md": '# Same\n# Same\n<a id="named"></a>\n',
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
const route = 'export async function GET() {}\n';
const messages = result => result.diagnostics.filter(item => item.severity === "error").map(item => `${item.file} ${item.message}`);

test("layered docs: every API handler has exactly one inventory row on one api page (#1851)", context => {
  const root = fixture(context, {
    "README.md": "# Start\n",
    "src/app/api/a/route.ts": route, "src/app/api/b/[id]/route.ts": route, "src/app/api/c/route.ts": route,
    "docs/README.md": "# Docs\n[API](api/README.md)\n",
    "docs/api/README.md": "# API\n[One](one.md) [Two](two.md)\n",
    "docs/api/one.md": "# One\n| GET | `/api/a` | x | y |\n| GET/POST | `/api/b/[id]?q=1` | x | y |\n| GET | `/api/gone` | x | y |\n",
    "docs/api/two.md": "# Two\n| GET | `/api/a` | x | y |\nProse may mention `/api/c` freely.\n",
  });
  assert.deepEqual(messages(checkDocumentation(root)).sort(), [
    "docs/api/README.md API route has no inventory row: /api/c",
    "docs/api/one.md Inventory row for a route with no handler: /api/gone",
    "docs/api/two.md API route listed on more than one api page: /api/a (docs/api/one.md, docs/api/two.md)",
  ]);
});

test("layered docs: every environment key is in a configuration page (#1851)", context => {
  const root = fixture(context, {
    "README.md": "# Start\n",
    "src/lib/x.ts": "process.env.DOCUMENTED_KEY; process.env.MISSING_KEY;\n",
    "docs/README.md": "# Docs\n[Ops](operations/README.md)\n",
    "docs/operations/README.md": "# Ops\n[Config](configuration.md) [Pay](configuration-payments.md)\n",
    "docs/operations/configuration.md": "# Config\n",
    "docs/operations/configuration-payments.md": "# Pay\n`DOCUMENTED_KEY`\n",
  });
  assert.deepEqual(messages(checkDocumentation(root)), ["docs/operations/configuration.md Environment key not documented: MISSING_KEY"]);
});

test("layered docs: short pages, an index per folder linking each page, nothing new loose in docs/ (#1851)", context => {
  const long = "# Long\n" + "line\n".repeat(300);
  const root = fixture(context, {
    "README.md": "# Start\n",
    "docs/README.md": "# Docs\n[Product](product/README.md) [Roadmap](roadmap.md) [Loose](loose.md)\n",
    "docs/roadmap.md": "# Roadmap\n",
    "docs/loose.md": "# Loose\n",
    "docs/product/README.md": "# Product\n[Brand](brand.md)\n",
    "docs/product/brand.md": long,
    "docs/product/create.md": "# Create\n",
    "docs/operations/runbooks/one.md": "# One\n",
    "docs/plans/README.md": "# Plans\n[Live](live.md) [Stale](stale.md)\n",
    "docs/plans/live.md": "# Live\n\n**Status:** active: building it (#1).\n",
    "docs/plans/stale.md": "# Stale\n\nNo status.\n",
  });
  assert.deepEqual(messages(checkDocumentation(root)).sort(), [
    "docs/README.md Index does not link docs/operations/README.md",
    "docs/README.md Index does not link docs/plans/README.md",
    "docs/loose.md Put pages in a docs/ subfolder (product, architecture, api, operations, team, plans)",
    "docs/operations Folder has no README.md index",
    "docs/operations/runbooks Folder has no README.md index",
    "docs/plans/stale.md Plan needs a `**Status:** active` or `**Status:** done` line under its title",
    "docs/product/README.md Index does not link docs/product/create.md",
    "docs/product/brand.md Page has 301 lines; split it (limit 300)",
  ]);
});

test("layered docs: code, scripts and workflows name only docs that exist (#1851)", context => {
  const root = fixture(context, {
    "README.md": "# Start\n",
    "docs/README.md": "# Docs\n",
    "scripts/x.mjs": "// see docs/README.md#docs and docs/MOVED.md\n// https://supabase.com/docs/guides/api.md is external\n",
    ".github/workflows/y.yml": "# docs/operations/gone.md\n",
    ".github/skills/z/SKILL.md": "docs/third-party.md\n",
    "tests/x.test.ts": "'docs/sample.md'\n",
    "AGENTS.md": "# Agents\n[Docs](docs/README.md)\n",
  });
  assert.deepEqual(messages(checkDocumentation(root)).sort(), [
    ".github/workflows/y.yml Names a missing doc: docs/operations/gone.md",
    "scripts/x.mjs Names a missing doc: docs/MOVED.md",
  ]);
});

test("flags quoted labels the app never shows, allowing filled templates and support words", context => {
  const root = fixture(context, {
    "src/components/card.tsx": 'export const Card = () => <p>{`Each ${chat} costs ${cost}.`}<button>Go live</button></p>;\n',
    "messages/en.json": JSON.stringify({ waiting: "{n, plural, one {# person is waiting for your reply.} other {# people are waiting.}}" }),
  });
  const texts = [
    { line: 1, text: 'Tap "Go live". It says "Each chat costs ₹45." and "1 person is waiting for your reply."' },
    { line: 2, text: 'Tap "Go live now please" or "Launch it".' },
    { line: 3, text: 'Owner says: "it is broken"' },
    { line: 4, text: 'Then reply: "We are on it." The owner may write "पिक्चर नहीं आई".' },
  ];
  assert.deepEqual(missingLabels(texts, appCopy(root)).map(({ line, label }) => `${line} ${label}`), ["2 Go live now please", "2 Launch it"]);
});

test("scheduled-jobs.md must list every cron and nothing that is gone", context => {
  const root = fixture(context, {
    ".github/workflows/nightly.yml": 'on:\n  schedule:\n    - cron: "30 21 * * *"\n    - cron: \'0 5 * * 1\'\n',
    "vercel.json": JSON.stringify({ crons: [{ path: "/api/cron/keepalive", schedule: "0 6 * * *" }] }),
    "db/migrations/1_jobs.sql": "select cron.schedule('adbrain-a', '*/15 * * * *', 'x'); select cron.schedule('adbrain-b', '1 * * * *', 'x');",
    "db/migrations/2_jobs.sql": "select cron.unschedule('adbrain-b'); select cron.schedule('adbrain-a', '*/5 * * * *', 'x');",
  });
  const doc = "| Source | Schedule |\n| --- | --- |\n| `nightly.yml` | `30 21 * * *` |\n| `/api/cron/keepalive` | `0 6 * * *` |\n| `adbrain-a` | `*/15 * * * *` |\n| `adbrain-b` | `1 * * * *` |\n";
  assert.deepEqual(scheduleDrift(root, doc).map(({ line, message }) => `${line} ${message}`), [
    "1 Schedule missing from the table: `nightly.yml 0 5 * * 1`",
    "1 Schedule missing from the table: `adbrain-a */5 * * * *`",
    "5 Documented schedule no longer exists: `adbrain-a */15 * * * *`",
    "6 Documented schedule no longer exists: `adbrain-b 1 * * * *`",
  ]);
});

test("a Hindi page names its stale English page until it is refreshed and stamped", context => {
  const root = fixture(context, {
    "docs/product/go.md": "# Go\n\nTap \"Go live\".\n\n```\n# not a heading \"x\"\n```\n",
    "docs/product/hi/go.md": "# जाएँ\n\nयह [Go](../go.md) का हिंदी रूप है। \"Go live\" दबाएँ।\n",
  });
  const hindi = resolve(root, "docs/product/hi/go.md");
  assert.match(mirrorDrift(hindi, readFileSync(hindi, "utf8")), /No mirror stamp/);
  stampMirror(hindi);
  assert.match(readFileSync(hindi, "utf8"), /^# जाएँ\n<!-- mirrors \.\.\/go\.md [0-9a-f]{12} -->\n/);
  assert.equal(mirrorDrift(hindi, readFileSync(hindi, "utf8")), null);
  writeFileSync(resolve(root, "docs/product/go.md"), "# Go\n\nTap \"Go live\". More words.\n\n```\n# changed code \"y\"\n```\n");
  assert.equal(mirrorDrift(hindi, readFileSync(hindi, "utf8")), null);
  writeFileSync(resolve(root, "docs/product/go.md"), "# Go\n\nTap \"Go live now\".\n");
  assert.match(mirrorDrift(hindi, readFileSync(hindi, "utf8")), /\.\.\/go\.md changed since this translation/);
  assert.ok(checkDocumentation(root, { files: ["docs/product/hi/go.md"] }).diagnostics.some(item => item.severity === "error" && /changed since this translation/.test(item.message)));
});

test("configuration docs list every variable scripts read, and nothing that is never read", context => {
  const root = fixture(context, {
    "scripts/smoke.mjs": "const { SMOKE_EMAIL: email } = process.env; const t = process.env.VERCEL_TOKEN ?? process.env[\"GH_REPO\"]; process.env.GITHUB_OUTPUT;\n",
    "scripts/doctor.sh": 'echo "${APP_URL:-}" "$LOCAL_ONLY"\n',
    "next.config.ts": "export default { env: { sha: process.env.VERCEL_GIT_COMMIT_SHA } };\n",
  });
  const scripts = scriptEnvironment(root);
  assert.deepEqual([...scripts].sort(), ["APP_URL", "GH_REPO", "GITHUB_OUTPUT", "SMOKE_EMAIL", "VERCEL_GIT_COMMIT_SHA", "VERCEL_TOKEN"]);
  const pages = [{ file: "docs/operations/configuration.md", text: "| `SMOKE_EMAIL` | x |\n| `APP_URL` | x |\n| `OLD_KEY` | gone |\n| `GET` | a verb |\n| `META_APP_ID` | x |\n" }];
  assert.deepEqual(environmentDrift(["META_APP_ID"], scripts, pages).map(({ line, message }) => `${line} ${message}`), [
    "1 Environment key read by scripts but not documented: GH_REPO",
    "1 Environment key read by scripts but not documented: VERCEL_TOKEN",
    "3 Documented environment key nothing reads: OLD_KEY",
  ]);
});

test("a ₹ amount or % in docs/product must come from a source constant or be a listed example", context => {
  const sources = {
    "src/lib/campaign/budget.ts": "export const BUDGET_PRESETS = [300, 500, 1000] as const;\n",
    "src/components/setup-go-live.tsx": "export const SETUP_RUN_DAYS = 2;\nexport const SETUP_RUN_DAY_CHOICES = [SETUP_RUN_DAYS, 7] as const;\n",
    "src/lib/payments/allocation.ts": "return Math.ceil(capPaise * (10_000 + (input.taxRateBps ?? 1_800)) / 10_000);\n",
    "src/lib/plan/status.ts": "export const PLAN_PRICE_PAISE = 99_900;\n",
    "src/lib/campaign/verdict.ts": "export const EVIDENCE_MIN_SPEND = 500;\n",
    "src/lib/meta/insights.ts": "export const BEST_AD_MARGIN = 0.3;\n",
    "src/lib/creative/design.ts": "export const STORY_SAFE = { top: 0.14, bottom: 0.35, side: 0.06 } as const;\n",
  };
  const root = fixture(context, sources);
  const prose = [{ line: 3, text: "₹300 a day for 2 days, ₹708 at most incl. 18% GST; 7 days is ₹2,478. Then ₹999 a month. Each chat costs ₹45." }];
  assert.deepEqual(moneyDrift(prose, moneyFacts(root).facts), []);
  assert.deepEqual(moneyDrift([{ line: 4, text: "Only ₹1,499 and 25% off." }], moneyFacts(root).facts), [{ line: 4, amount: "₹1,499" }, { line: 4, amount: "25%" }]);
  writeFileSync(resolve(root, "src/lib/payments/allocation.ts"), "(input.taxRateBps ?? 2_800)\n");
  writeFileSync(resolve(root, "src/lib/plan/status.ts"), "export const PLAN_PRICE_PAISE = 1_49_900;\n");
  assert.deepEqual(moneyDrift(prose, moneyFacts(root).facts).map(({ amount }) => amount), ["₹708", "18%", "₹2,478", "₹999"]);
  rmSync(resolve(root, "src/lib/meta/insights.ts"));
  assert.deepEqual(moneyFacts(root).missing, ["src/lib/meta/insights.ts BEST_AD_MARGIN = ([\\d.]+)"]);
});
