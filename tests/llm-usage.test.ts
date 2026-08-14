import { afterEach, describe, expect, it } from "vitest";
import {
  recordUsage,
  resetUsage,
  usageSnapshot,
} from "@/lib/llm/usage";
import type { CompletionResult } from "@/lib/llm/types";

function result(
  over: Partial<CompletionResult> = {},
): CompletionResult {
  return {
    text: "x",
    provider: "google",
    model: "gemini",
    usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
    ...over,
  };
}

afterEach(() => resetUsage());

describe("usage accounting", () => {
  it("aggregates token counts overall and per provider", () => {
    recordUsage(result());
    recordUsage(result({ provider: "groq" }));
    const snap = usageSnapshot();
    expect(snap.overall.calls).toBe(2);
    expect(snap.overall.totalTokens).toBe(28);
    expect(snap.byProvider.google.totalTokens).toBe(14);
    expect(snap.byProvider.groq.totalTokens).toBe(14);
  });

  it("counts cache hits as saved tokens, not spend", () => {
    recordUsage(result());
    recordUsage(result({ cached: true }));
    const snap = usageSnapshot();
    expect(snap.overall.calls).toBe(1);
    expect(snap.overall.cacheHits).toBe(1);
    expect(snap.overall.totalTokens).toBe(14);
    expect(snap.overall.savedTokens).toBe(14);
  });

  it("tolerates results without usage metadata", () => {
    recordUsage(result({ usage: undefined }));
    const snap = usageSnapshot();
    expect(snap.overall.calls).toBe(1);
    expect(snap.overall.totalTokens).toBe(0);
  });

  it("resets all counters", () => {
    recordUsage(result());
    resetUsage();
    expect(usageSnapshot().overall.calls).toBe(0);
  });
});
