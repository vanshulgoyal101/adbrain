import type { CompletionResult, TokenUsage } from "./types";

/**
 * Process-local token accounting. Aggregates real usage reported by providers
 * so a paid key's spend is observable (and testable) without an external
 * service. Cache hits are counted separately as tokens *saved*.
 */

export interface UsageTotals {
  calls: number;
  cacheHits: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  savedTokens: number;
}

function emptyTotals(): UsageTotals {
  return {
    calls: 0,
    cacheHits: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    savedTokens: 0,
  };
}

const overall = emptyTotals();
const byProvider = new Map<string, UsageTotals>();

function bucket(provider: string): UsageTotals {
  let b = byProvider.get(provider);
  if (!b) {
    b = emptyTotals();
    byProvider.set(provider, b);
  }
  return b;
}

function add(totals: UsageTotals, usage: TokenUsage | undefined): void {
  totals.calls += 1;
  if (!usage) return;
  totals.promptTokens += usage.promptTokens;
  totals.completionTokens += usage.completionTokens;
  totals.totalTokens += usage.totalTokens;
}

/** Record one completion result against the running totals. */
export function recordUsage(result: CompletionResult): void {
  const b = bucket(result.provider);
  if (result.cached) {
    overall.cacheHits += 1;
    b.cacheHits += 1;
    const saved = result.usage?.totalTokens ?? 0;
    overall.savedTokens += saved;
    b.savedTokens += saved;
    return;
  }
  add(overall, result.usage);
  add(b, result.usage);
}

/** Snapshot of cumulative usage since process start (or last reset). */
export function usageSnapshot(): {
  overall: UsageTotals;
  byProvider: Record<string, UsageTotals>;
} {
  return {
    overall: { ...overall },
    byProvider: Object.fromEntries(
      [...byProvider.entries()].map(([k, v]) => [k, { ...v }]),
    ),
  };
}

/** Reset all counters (used by tests). */
export function resetUsage(): void {
  Object.assign(overall, emptyTotals());
  byProvider.clear();
}
