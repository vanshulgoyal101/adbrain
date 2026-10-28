import { describe, expect, it } from "vitest";
import { FREE_QUOTAS, usageLines } from "../scripts/plan-usage.mjs";

const MB = 1024 * 1024;

describe("free-plan usage alert (#1856)", () => {
  it("flags only quotas at or above 80%", () => {
    const lines = usageLines({ database: 60 * MB, storage: 820 * MB, mau: 18 });
    expect(lines.map((l: { key: string; over: boolean }) => [l.key, l.over])).toEqual([["database", false], ["storage", true], ["mau", false]]);
    expect(lines[1].text).toBe("Storage (all buckets): 820 MB of 1024 MB (80%)");
    expect(lines[2].text).toBe("Monthly active users: 18 of 50000 (0%)");
  });
  it("uses the Free plan's quotas", () => {
    expect(FREE_QUOTAS).toEqual({ database: 500 * MB, storage: 1024 * MB, mau: 50_000 });
  });
});
