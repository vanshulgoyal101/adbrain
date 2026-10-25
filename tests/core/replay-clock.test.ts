import { afterEach, describe, expect, it, vi } from "vitest";
import { settleInVirtualTime, useVirtualDeadlines } from "./replay";

// Captured before the virtual clock replaces setTimeout: stands in for real IO such as sharp's thread pool.
const realSetTimeout = globalThis.setTimeout;
const realIo = <T>(ms: number, value: T) => new Promise<T>((resolve) => realSetTimeout(() => resolve(value), ms));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("core replay: the virtual clock helper", () => {
  it("waits for real IO that outlasts a few event-loop turns while no virtual timer is pending", async () => {
    useVirtualDeadlines();
    await expect(settleInVirtualTime(realIo(300, "decoded"))).resolves.toBe("decoded");
  });

  it("still reports a replay that can never settle", async () => {
    useVirtualDeadlines();
    await expect(settleInVirtualTime(new Promise(() => {}), 600_000, 100)).rejects.toThrow("Core replay stalled with no pending timers.");
  });
});
