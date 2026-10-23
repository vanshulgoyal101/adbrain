import { describe, expect, it } from "vitest";
import { changedItems, parseArgs } from "../scripts/wait-for-work.mjs";

type Item = { number: number; updatedAt: string };
const items = (...list: Item[]) => new Map(list.map(item => [item.number, item]));

describe("wait-for-work", () => {
  it("parses a role, watch list and limits", () => {
    expect(parseArgs(["--role", "qa", "--watch", "#157, 219", "--interval", "30", "--timeout", "90"])).toEqual({
      role: "qa", watch: [157, 219], intervalSeconds: 30, timeoutMinutes: 90, once: false,
    });
    expect(parseArgs(["--role", "cto", "--once"]).once).toBe(true);
  });

  it("rejects unknown roles, bad numbers and too-fast polling", () => {
    expect(() => parseArgs([])).toThrow(/--role/);
    expect(() => parseArgs(["--role", "owner"])).toThrow(/--role/);
    expect(() => parseArgs(["--role", "qa", "--watch", "abc"])).toThrow(/--watch/);
    expect(() => parseArgs(["--role", "qa", "--interval", "5"])).toThrow(/--interval/);
    expect(() => parseArgs(["--role", "qa", "--bogus"])).toThrow(/Unknown option/);
  });

  it("wakes on a new item or an updated one, not on an unchanged queue", () => {
    const baseline = items({ number: 157, updatedAt: "2026-10-23T12:00:00Z" }, { number: 219, updatedAt: "2026-10-23T12:30:00Z" });
    expect(changedItems(baseline, baseline)).toEqual([]);
    const updated = items({ number: 157, updatedAt: "2026-10-23T12:00:00Z" }, { number: 219, updatedAt: "2026-10-23T12:55:00Z" });
    expect(changedItems(baseline, updated).map((item: Item) => item.number)).toEqual([219]);
    const added = items(...baseline.values(), { number: 221, updatedAt: "2026-10-23T12:40:00Z" });
    expect(changedItems(baseline, added).map((item: Item) => item.number)).toEqual([221]);
  });

  it("ignores items that leave the queue", () => {
    const baseline = items({ number: 157, updatedAt: "a" }, { number: 219, updatedAt: "b" });
    expect(changedItems(baseline, items({ number: 157, updatedAt: "a" }))).toEqual([]);
  });
});
