import { NextResponse } from "next/server";

/**
 * Best-effort in-memory sliding-window rate limiter. Per-instance only: on
 * serverless it limits within a warm instance rather than globally, but it
 * still caps abuse from a single session cheaply and never blocks legitimate
 * use. For hard global limits, back this with a shared store (Postgres/Redis).
 */
const buckets = new Map<string, number[]>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  /** Milliseconds until the next request would be allowed (0 when ok). */
  retryAfterMs: number;
}

export function rateLimit(
  key: string,
  opts: { limit: number; windowMs: number },
  now: number = Date.now(),
): RateLimitResult {
  const { limit, windowMs } = opts;
  const windowStart = now - windowMs;
  const hits = (buckets.get(key) ?? []).filter((t) => t > windowStart);

  if (hits.length >= limit) {
    buckets.set(key, hits);
    const retryAfterMs = Math.max(hits[0] + windowMs - now, 0);
    return { ok: false, remaining: 0, retryAfterMs };
  }

  hits.push(now);
  buckets.set(key, hits);
  return { ok: true, remaining: limit - hits.length, retryAfterMs: 0 };
}

/**
 * Enforce a rate limit for a route. Returns a 429 NextResponse when the caller
 * is over the limit, or null when the request may proceed.
 */
export function rateLimitResponse(
  key: string,
  opts: { limit: number; windowMs: number },
): NextResponse | null {
  const result = rateLimit(key, opts);
  if (result.ok) return null;
  const retryAfter = Math.ceil(result.retryAfterMs / 1000);
  return NextResponse.json(
    { error: "Too many requests. Please slow down and try again shortly." },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}

/** Test helper: clear all limiter state. */
export function _resetRateLimits(): void {
  buckets.clear();
}
