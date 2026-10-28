import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { cronAuthError } from "@/lib/security/cron-auth";

const call = (authorization?: string) => new Request("https://x.test/api/cron/x", { headers: authorization ? { authorization } : {} });

describe("cron auth (#1636)", () => {
  it("is 404 while CRON_SECRET is unset, so 'Bearer ' never matches an empty secret", () => {
    expect(cronAuthError(call("Bearer "), "")?.status).toBe(404);
    expect(cronAuthError(call(), "")?.status).toBe(404);
  });

  it("lets only the exact bearer through", () => {
    expect(cronAuthError(call("Bearer s3cret"), "s3cret")).toBeNull();
    for (const header of [undefined, "Bearer s3cre", "bearer s3cret", "s3cret", "Bearer s3cretX"]) {
      expect(cronAuthError(call(header), "s3cret")?.status, String(header)).toBe(401);
    }
  });

  it("is the check every /api/cron route runs, with no hand-written compare left", () => {
    const routes = execFileSync("git", ["ls-files", "src/app/api/cron/*/route.ts"], { encoding: "utf8" }).trim().split("\n");
    expect(routes.length).toBeGreaterThan(10);
    for (const route of routes) {
      const source = readFileSync(route, "utf8");
      expect(source, route).toContain("cronAuthError(request)");
      expect(source, route).not.toMatch(/authorization"\) !==/);
    }
  });
});
