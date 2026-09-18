import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("product logging integration coverage", () => {
  it("wraps every API and auth method without changing the exported HTTP surface", () => {
    const root = join(process.cwd(), "src/app");
    const routes = readdirSync(root, { recursive: true }).map(String).filter(path => /^(api|auth)\/.+\/route\.ts$/.test(path));
    expect(routes.length).toBeGreaterThanOrEqual(38);
    for (const route of routes) {
      const source = readFileSync(join(root, route), "utf8");
      expect(source, route).not.toMatch(/export async function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\(/);
      expect(source, route).toMatch(/export const (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) = observeRoute\(/);
    }
  });

  it("keeps the fresh schema and telemetry migration identical", () => {
    const migration = readFileSync(join(process.cwd(), "db/migrations/20260918_product_events.sql"), "utf8");
    const schema = readFileSync(join(process.cwd(), "db/schema.sql"), "utf8");
    expect(schema).toContain(migration);
  });
});