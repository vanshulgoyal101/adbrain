import { createHash } from "node:crypto";
import type {
  ChatMessage,
  CompletionOptions,
  CompletionResult,
} from "./types";

/**
 * In-process response cache + single-flight for LLM completions.
 *
 * Two identical requests never cost tokens twice: a resolved response is served
 * from the cache until its TTL expires, and concurrent identical requests share
 * one in-flight promise. Keyed on the semantic request (messages + model-facing
 * options + model) — NOT the API key — so any key in the pool can satisfy it.
 *
 * Process-local by design: it survives within a warm serverless instance and is
 * a pure token-saver, never a correctness dependency. Callers opt in per request
 * and only for low-variance calls where a stale-but-identical answer is fine.
 */

const DEFAULT_TTL_MS = 10 * 60_000; // 10 minutes
const MAX_ENTRIES = 500;
const DEFAULT_PROMPT_VERSION = "2026-09-05-v2";

interface CacheEntry {
  result: CompletionResult;
  expiresAt: number;
}

const store = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CompletionResult>>();

/** Stable key over the token-relevant request shape. */
export function cacheKey(
  messages: ChatMessage[],
  options: CompletionOptions,
): string {
  const payload = JSON.stringify({
    promptVersion: options.promptVersion ?? DEFAULT_PROMPT_VERSION,
    messages: messages.map((m) => [m.role, m.content]),
    provider: options.provider ?? null,
    model: options.model ?? null,
    temperature: options.temperature ?? null,
    maxTokens: options.maxTokens ?? null,
    json: options.json ?? false,
  });
  return createHash("sha256").update(payload).digest("hex");
}

function ttlFor(cache: CompletionOptions["cache"]): number {
  if (cache && typeof cache === "object") return cache.ttlMs;
  return DEFAULT_TTL_MS;
}

/**
 * Wrap a completion producer with cache + single-flight semantics. When caching
 * is disabled the producer is called directly with no bookkeeping.
 */
export async function withCache(
  key: string,
  cache: CompletionOptions["cache"],
  produce: () => Promise<CompletionResult>,
): Promise<CompletionResult> {
  if (!cache) return produce();

  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) {
    return { ...hit.result, cached: true };
  }
  if (hit) store.delete(key);

  const pending = inflight.get(key);
  if (pending) {
    const result = await pending;
    return { ...result, cached: true };
  }

  const promise = produce();
  inflight.set(key, promise);
  try {
    const result = await promise;
    store.set(key, { result, expiresAt: now + ttlFor(cache) });
    evictIfNeeded();
    return result;
  } finally {
    inflight.delete(key);
  }
}

/** Drop the oldest entries once the cache grows past its bound. */
function evictIfNeeded(): void {
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

/** Clear all cached responses (used by tests). */
export function clearLLMCache(): void {
  store.clear();
  inflight.clear();
}

/** Current cache size, for diagnostics/tests. */
export function llmCacheSize(): number {
  return store.size;
}
