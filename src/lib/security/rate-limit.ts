import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Sliding-window rate limiter. The shared path uses a Postgres SECURITY DEFINER
 * function (`check_rate_limit`) so limits hold across serverless instances; if
 * that call fails for any reason it falls back to the in-memory limiter below,
 * so a database hiccup never blocks legitimate use. The in-memory limiter is
 * per-instance and kept as the fallback (and for unit tests).
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
 * Shared (cross-instance) rate check backed by Postgres. Falls back to the
 * in-memory limiter if the RPC is unavailable (e.g. outside a request context).
 */
export async function checkRateLimit(
  key: string,
  opts: { limit: number; windowMs: number },
): Promise<RateLimitResult> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("check_rate_limit", {
      p_key: key,
      p_limit: opts.limit,
      p_window_ms: opts.windowMs,
    });
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row) throw error ?? new Error("no rate-limit row");
    return {
      ok: row.allowed,
      remaining: row.allowed ? Math.max(opts.limit - 1, 0) : 0,
      retryAfterMs: row.retry_after_ms ?? 0,
    };
  } catch {
    return rateLimit(key, opts);
  }
}

/**
 * Enforce a rate limit for a route. Returns a 429 NextResponse when the caller
 * is over the limit, or null when the request may proceed.
 */
export async function rateLimitResponse(
  key: string,
  opts: { limit: number; windowMs: number },
): Promise<NextResponse | null> {
  const result = await checkRateLimit(key, opts);
  if (result.ok) return null;
  const retryAfter = Math.ceil(result.retryAfterMs / 1000);
  return NextResponse.json(
    { error: "Too many requests. Please slow down and try again shortly." },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}

/** Test helper: clear all in-memory limiter state. */
export function _resetRateLimits(): void {
  buckets.clear();
}
