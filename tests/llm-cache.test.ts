import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cacheKey,
  clearLLMCache,
  llmCacheSize,
  withCache,
} from "@/lib/llm/cache";
import type { ChatMessage, CompletionResult } from "@/lib/llm/types";

const MESSAGES: ChatMessage[] = [
  { role: "system", content: "be brief" },
  { role: "user", content: "hi" },
];

function result(text: string): CompletionResult {
  return {
    text,
    provider: "groq",
    model: "m",
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  };
}

afterEach(() => {
  clearLLMCache();
  vi.restoreAllMocks();
});

describe("cacheKey", () => {
  it("is stable for identical requests", () => {
    expect(cacheKey(MESSAGES, { temperature: 0.3 })).toBe(
      cacheKey(MESSAGES, { temperature: 0.3 }),
    );
  });

  it("differs when messages, temperature, maxTokens or json change", () => {
    const base = cacheKey(MESSAGES, { temperature: 0.3 });
    expect(cacheKey(MESSAGES, { temperature: 0.4 })).not.toBe(base);
    expect(cacheKey(MESSAGES, { temperature: 0.3, maxTokens: 100 })).not.toBe(
      base,
    );
    expect(cacheKey(MESSAGES, { temperature: 0.3, json: true })).not.toBe(base);
    expect(
      cacheKey([{ role: "user", content: "other" }], { temperature: 0.3 }),
    ).not.toBe(base);
  });
});

describe("withCache", () => {
  it("bypasses cache entirely when disabled", async () => {
    const produce = vi.fn(async () => result("a"));
    const a = await withCache("k", undefined, produce);
    const b = await withCache("k", undefined, produce);
    expect(produce).toHaveBeenCalledTimes(2);
    expect(a.cached).toBeUndefined();
    expect(b.cached).toBeUndefined();
    expect(llmCacheSize()).toBe(0);
  });

  it("serves a second identical call from cache without re-producing", async () => {
    const produce = vi.fn(async () => result("a"));
    const first = await withCache("k", true, produce);
    const second = await withCache("k", true, produce);
    expect(produce).toHaveBeenCalledTimes(1);
    expect(first.cached).toBeUndefined();
    expect(second.cached).toBe(true);
    expect(second.text).toBe("a");
  });

  it("de-duplicates concurrent identical calls (single-flight)", async () => {
    let resolve!: (r: CompletionResult) => void;
    const produce = vi.fn(
      () => new Promise<CompletionResult>((r) => (resolve = r)),
    );
    const p1 = withCache("k", true, produce);
    const p2 = withCache("k", true, produce);
    resolve(result("shared"));
    const [a, b] = await Promise.all([p1, p2]);
    expect(produce).toHaveBeenCalledTimes(1);
    expect(a.text).toBe("shared");
    expect(b.text).toBe("shared");
    expect(b.cached).toBe(true);
  });

  it("re-produces once the TTL has expired", async () => {
    const produce = vi.fn(async () => result("a"));
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    await withCache("k", { ttlMs: 100 }, produce);
    now.mockReturnValue(1_050);
    await withCache("k", { ttlMs: 100 }, produce);
    expect(produce).toHaveBeenCalledTimes(1); // still fresh
    now.mockReturnValue(2_000);
    await withCache("k", { ttlMs: 100 }, produce);
    expect(produce).toHaveBeenCalledTimes(2); // expired -> re-produced
  });
});
