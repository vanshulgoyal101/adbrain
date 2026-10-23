import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendedMigrations, buildSchema, foldedMigrations, migrationFiles } from "../scripts/build-schema.mjs";

const roots: string[] = [];
function fixture(migrations: Record<string, string>, folded: string[]) {
  const root = mkdtempSync(join(tmpdir(), "adbrain-schema-"));
  roots.push(root);
  mkdirSync(join(root, "db/migrations"), { recursive: true });
  writeFileSync(join(root, "db/schema.sql"), "-- base\ncreate table a();\n");
  writeFileSync(join(root, "db/schema.base-migrations.txt"), `${folded.join("\n")}\n`);
  for (const [name, sql] of Object.entries(migrations)) writeFileSync(join(root, "db/migrations", name), sql);
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("generated schema", () => {
  it("is exactly the base when every migration is already folded in", () => {
    const root = fixture({ "20260101_a.sql": "begin;\ncommit;\n" }, ["20260101_a.sql"]);
    expect(buildSchema(root)).toBe("-- base\ncreate table a();\n");
  });

  it("appends only unfolded migrations, in filename order, with their exact text", () => {
    const root = fixture({ "20260101_a.sql": "folded();\n", "20260103_c.sql": "third();\n", "20260102_b.sql": "second();\n" }, ["20260101_a.sql"]);
    expect(appendedMigrations(root)).toEqual(["20260102_b.sql", "20260103_c.sql"]);
    expect(buildSchema(root)).toBe("-- base\ncreate table a();\n\nsecond();\n\nthird();\n");
  });

  it("lets two migration branches merge without touching a shared file", () => {
    const main = fixture({ "20260101_a.sql": "folded();\n" }, ["20260101_a.sql"]);
    const first = fixture({ "20260101_a.sql": "folded();\n", "20260104_x.sql": "x();\n" }, ["20260101_a.sql"]);
    const second = fixture({ "20260101_a.sql": "folded();\n", "20260105_y.sql": "y();\n" }, ["20260101_a.sql"]);
    const merged = fixture({ "20260101_a.sql": "folded();\n", "20260104_x.sql": "x();\n", "20260105_y.sql": "y();\n" }, ["20260101_a.sql"]);
    expect(migrationFiles(first).filter(name => !migrationFiles(main).includes(name))).toEqual(["20260104_x.sql"]);
    expect(migrationFiles(second).filter(name => !migrationFiles(main).includes(name))).toEqual(["20260105_y.sql"]);
    expect(buildSchema(merged)).toContain("x();\n\ny();");
  });

  it("covers every migration in the repository: folded into the base or appended", () => {
    const folded = foldedMigrations();
    const files = migrationFiles();
    expect(files.length).toBeGreaterThan(30);
    for (const name of folded) expect(files, `${name} is listed as folded but missing`).toContain(name);
    expect(appendedMigrations()).toEqual(files.filter(name => !folded.has(name)));
    for (const name of appendedMigrations()) expect(buildSchema()).toContain(readFileSync(join(process.cwd(), "db/migrations", name), "utf8").trim());
  });
});
