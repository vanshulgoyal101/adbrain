import { describe, expect, it } from "vitest";
import { withRetry } from "../scripts/lib/prod-query.mjs";

// #2537: one slow page (30 s abort) or a network blip failed the whole nightly export.
describe("read-only production query retry", () => {
  const noWait = async () => {};

  it("retries a timeout, a network error and a 5xx/429, then returns", async () => {
    const failures = [
      Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }),
      new TypeError("fetch failed"),
      Object.assign(new Error("Read-only query failed (HTTP 503)."), { status: 503 }),
    ];
    let calls = 0;
    const result = await withRetry(async () => {
      calls += 1;
      if (failures.length) throw failures.shift();
      return ["ok"];
    }, { attempts: 4, wait: noWait });
    expect(result).toEqual(["ok"]);
    expect(calls).toBe(4);
  });

  it("gives up after the last attempt", async () => {
    let calls = 0;
    await expect(withRetry(async () => {
      calls += 1;
      throw Object.assign(new Error("Read-only query failed (HTTP 429)."), { status: 429 });
    }, { attempts: 3, wait: noWait })).rejects.toThrow(/429/);
    expect(calls).toBe(3);
  });

  it("does not retry a bad query or a missing token", async () => {
    for (const error of [Object.assign(new Error("Read-only query failed (HTTP 400)."), { status: 400 }), new Error("Supabase Management token is unavailable.")]) {
      let calls = 0;
      await expect(withRetry(async () => { calls += 1; throw error; }, { attempts: 3, wait: noWait })).rejects.toBe(error);
      expect(calls).toBe(1);
    }
  });
});
