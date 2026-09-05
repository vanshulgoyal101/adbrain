import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = JSON.parse(
  readFileSync(new URL("../vercel.json", import.meta.url), "utf8"),
) as { crons: { path: string; schedule: string }[] };

describe("Vercel Hobby deployment configuration", () => {
  it("keeps both operational backstops registered", () => {
    expect(config.crons.map((cron) => cron.path).sort()).toEqual([
      "/api/cron/enforce-spend",
      "/api/cron/keepalive",
    ]);
  });

  it("uses a single daily invocation for every cron", () => {
    for (const cron of config.crons) {
      const fields = cron.schedule.trim().split(/\s+/);
      expect(fields, cron.path).toHaveLength(5);
      expect(fields[0], cron.path).toMatch(/^(?:[0-9]|[1-5][0-9])$/);
      expect(fields[1], cron.path).toMatch(/^(?:[0-9]|1[0-9]|2[0-3])$/);
      expect(fields.slice(2), cron.path).toEqual(["*", "*", "*"]);
    }
  });
});