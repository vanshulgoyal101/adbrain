// Builds the full fresh-install schema: the frozen base db/schema.sql plus every migration in
// db/migrations that is not listed in db/schema.base-migrations.txt, in filename order.
// A new migration PR adds only its file, so two migration PRs never touch the same lines.
//   node scripts/build-schema.mjs > /tmp/schema.sql
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function readBaseSchema(root = defaultRoot) {
  return readFileSync(join(root, "db/schema.sql"), "utf8");
}

export function foldedMigrations(root = defaultRoot) {
  const file = join(root, "db/schema.base-migrations.txt");
  return new Set(existsSync(file) ? readFileSync(file, "utf8").split("\n").map(line => line.trim()).filter(Boolean) : []);
}

export function migrationFiles(root = defaultRoot) {
  return readdirSync(join(root, "db/migrations")).filter(name => /^\d[\w-]*\.sql$/.test(name)).sort();
}

/** Migrations applied after the base, in filename order. */
export function appendedMigrations(root = defaultRoot) {
  const folded = foldedMigrations(root);
  return migrationFiles(root).filter(name => !folded.has(name));
}

export function buildSchema(root = defaultRoot) {
  const tail = appendedMigrations(root).map(name => readFileSync(join(root, "db/migrations", name), "utf8").trim());
  const base = readBaseSchema(root);
  return tail.length ? `${base.trimEnd()}\n\n${tail.join("\n\n")}\n` : base;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.stdout.write(buildSchema());
