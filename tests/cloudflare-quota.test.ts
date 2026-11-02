import { describe, expect, it } from "vitest";
import { cloudflareToday, CLOUDFLARE_ALERT_AT, CLOUDFLARE_FREE_PICTURES_A_DAY } from "@/lib/imageGen/cloudflare-quota";

// #2404: today's Cloudflare free pictures, counted from our own usage rows (UTC day, as Cloudflare resets).
type Filter = [string, string, unknown];

function usageRows(counts: { pictures: number; caps: number }) {
  const queries: Filter[][] = [];
  const client = {
    from(table: string) {
      const filters: Filter[] = [["from", table, null]];
      queries.push(filters);
      const query = {
        select: (columns: string, options: unknown) => { filters.push(["select", columns, options]); return query; },
        eq: (column: string, value: unknown) => { filters.push(["eq", column, value]); return query; },
        in: (column: string, value: unknown) => { filters.push(["in", column, value]); return query; },
        gte: (column: string, value: unknown) => { filters.push(["gte", column, value]); return query; },
        then: (resolve: (value: unknown) => void) => resolve({
          count: filters.some(([kind, column]) => kind === "eq" && column === "error_code") ? counts.caps : counts.pictures, error: null,
        }),
      };
      return query;
    },
  };
  return { client: client as never, queries };
}

const now = new Date("2026-10-31T19:40:00Z");

describe("Cloudflare free pictures today (#2404)", () => {
  it("counts today's Cloudflare pictures, made or used as a fallback, since 00:00 UTC", async () => {
    const { client, queries } = usageRows({ pictures: 12, caps: 0 });
    expect(await cloudflareToday(client, now)).toEqual({ day: "2026-10-31", pictures: 12, capped: false, alertAt: 45, dailyCap: 57, near: false });
    expect(queries[0]).toEqual(expect.arrayContaining([
      ["from", "llm_usage_events", null], ["eq", "usage_kind", "image"], ["eq", "provider", "cloudflare"],
      ["in", "status", ["success", "fallback"]], ["gte", "created_at", "2026-10-31T00:00:00.000Z"],
    ]));
    expect(queries[1]).toEqual(expect.arrayContaining([["eq", "error_code", "IMAGE_FREE_DAILY_LIMIT"], ["gte", "created_at", "2026-10-31T00:00:00.000Z"]]));
  });

  it("is near the cap from 45 pictures, and whenever Cloudflare refused one for the daily limit", async () => {
    expect(CLOUDFLARE_ALERT_AT).toBe(45);
    expect(CLOUDFLARE_FREE_PICTURES_A_DAY).toBe(57);
    expect(await cloudflareToday(usageRows({ pictures: 44, caps: 0 }).client, now)).toMatchObject({ pictures: 44, near: false });
    expect(await cloudflareToday(usageRows({ pictures: 45, caps: 0 }).client, now)).toMatchObject({ pictures: 45, near: true });
    expect(await cloudflareToday(usageRows({ pictures: 3, caps: 1 }).client, now)).toMatchObject({ pictures: 3, capped: true, near: true });
  });

  it("returns null when the rows can't be read, so a read failure never alerts", async () => {
    const failing = { from: () => { throw new Error("db down"); } } as never;
    expect(await cloudflareToday(failing, now)).toBeNull();
  });
});
