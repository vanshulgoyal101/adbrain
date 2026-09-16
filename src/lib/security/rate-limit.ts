import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Sliding-window rate limiter. The shared path uses a Postgres SECURITY DEFINER
 * function (`check_rate_limit`) so limits hold across serverless instances.
 * Production fails closed when shared enforcement is unavailable. In-memory
 * fallback is limited to local development and tests.
 */
const buckets = new Map<string, number[]>();

export interface RateLimitResult {
  ok: boolean;
  unavailable?: boolean;
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
 * Shared rate check backed by Postgres. Only non-production environments may
 * fall back to the in-memory limiter if the RPC is unavailable.
 */
export async function checkRateLimit(
  key: string,
  opts: { limit: number; windowMs: number },
): Promise<RateLimitResult> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("check_rate_limit", {
      p_key: key,
      p_limit: opts.limit,
      p_window_ms: opts.windowMs,
    });
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row || typeof row.allowed !== "boolean" ||
        !Number.isFinite(row.retry_after_ms) || row.retry_after_ms < 0) {
      throw new Error("Invalid rate-limit result");
    }
    return {
      ok: row.allowed,
      remaining: row.allowed ? Math.max(opts.limit - 1, 0) : 0,
      retryAfterMs: row.retry_after_ms ?? 0,
    };
  } catch {
    if (process.env.NODE_ENV === "production") {
      return { ok: false, unavailable: true, remaining: 0, retryAfterMs: 30_000 };
    }
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
  if (result.unavailable) {
    return NextResponse.json(
      { error: "Request protection is temporarily unavailable. Please try again shortly." },
      { status: 503, headers: { "Retry-After": "30" } },
    );
  }
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
