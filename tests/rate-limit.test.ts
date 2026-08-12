import { afterEach, describe, expect, it } from "vitest";
import {
  _resetRateLimits,
  rateLimit,
  rateLimitResponse,
} from "@/lib/security/rate-limit";

afterEach(() => _resetRateLimits());

describe("rateLimit", () => {
  it("allows up to the limit within the window", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) {
      const r = rateLimit("k", { limit: 3, windowMs: 1000 }, t0 + i);
      expect(r.ok).toBe(true);
    }
    expect(r4("k", t0 + 3).ok).toBe(false);
  });

  it("reports remaining and retryAfter when blocked", () => {
    const t0 = 5_000_000;
    rateLimit("u", { limit: 1, windowMs: 2000 }, t0);
    const blocked = rateLimit("u", { limit: 1, windowMs: 2000 }, t0 + 500);
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBe(1500);
  });

  it("frees capacity once the window slides past old hits", () => {
    const t0 = 9_000_000;
    rateLimit("s", { limit: 1, windowMs: 1000 }, t0);
    expect(rateLimit("s", { limit: 1, windowMs: 1000 }, t0 + 500).ok).toBe(false);
    // After the window, the old hit expires.
    expect(rateLimit("s", { limit: 1, windowMs: 1000 }, t0 + 1001).ok).toBe(true);
  });

  it("keeps separate buckets per key", () => {
    const t0 = 2_000_000;
    expect(rateLimit("a", { limit: 1, windowMs: 1000 }, t0).ok).toBe(true);
    expect(rateLimit("b", { limit: 1, windowMs: 1000 }, t0).ok).toBe(true);
  });
});

describe("rateLimitResponse", () => {
  it("returns null while under the limit", () => {
    expect(rateLimitResponse("x", { limit: 2, windowMs: 1000 })).toBeNull();
  });

  it("returns a 429 with a Retry-After header when over the limit", () => {
    rateLimitResponse("y", { limit: 1, windowMs: 60_000 });
    const res = rateLimitResponse("y", { limit: 1, windowMs: 60_000 });
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
    expect(res!.headers.get("Retry-After")).toBeTruthy();
  });
});

function r4(key: string, now: number) {
  return rateLimit(key, { limit: 3, windowMs: 1000 }, now);
}
