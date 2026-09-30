import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { productActions } from "@/lib/observability/client-events";

describe("product logging integration coverage", () => {
  it("annotates key workflows with fixed allowlisted action codes only", () => {
    const actions = new Set<string>();
    for (const name of ["studio", "brand-form", "campaigns", "lead-inbox", "brand-assets", "production-checkout", "meta-connection"]) {
      const path = join(process.cwd(), `src/components/${name}.tsx`);
      const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      let count = 0;
      function inspect(node: ts.Node) {
        if (ts.isJsxAttribute(node) && node.name.getText(source) === "data-product-event") {
          count += 1;
          const value = node.initializer;
          const choices = value && ts.isStringLiteral(value) ? [value]
            : value && ts.isJsxExpression(value) && value.expression && ts.isConditionalExpression(value.expression)
              ? [value.expression.whenTrue, value.expression.whenFalse] : [];
          expect(choices.length, name).toBeGreaterThan(0);
          for (const choice of choices) {
            if (!ts.isStringLiteral(choice)) throw new Error("Analytics actions must be fixed labels");
            expect(productActions, name).toContain(choice.text);
            actions.add(choice.text);
          }
        }
        ts.forEachChild(node, inspect);
      }
      inspect(source);
      expect(count, name).toBeGreaterThan(0);
    }
    expect([...actions].sort()).toEqual([...productActions].sort());
  });
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