import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Route-handler contract tests for the endpoints not covered by
 * api-contract.test.ts. Every route must (1) reject anonymous callers before
 * doing any work, and (2) validate input before touching Meta/the LLM/the DB.
 * Supabase, Meta and the rate limiter are mocked so nothing external is hit.
 */

const getUser = vi.fn();
const rateLimitResponse = vi.fn();
const getPrimaryBusiness = vi.fn();
const metaClientForBusiness = vi.fn();
const upsert = vi.fn();
const del = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null }),
          eq: () => ({ limit: async () => ({ data: [] }) }),
        }),
        in: async () => ({ data: [] }),
      }),
      upsert,
      update: () => ({ eq: async () => ({ error: null }) }),
      delete: () => ({ eq: del }),
    }),
  }),
}));

vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse }));
vi.mock("@/lib/supabase/queries", () => ({
  getPrimaryBusiness,
  getActiveInstructionsText: async () => "",
  getPerformanceRows: async () => [],
  getSpendLimits: async () => ({
    weeklyCapRupees: null,
    alertPct: 80,
    autoPause: false,
  }),
  getCampaignSpend: async () => [],
}));
vi.mock("@/lib/meta/credentials", () => ({ metaClientForBusiness }));
vi.mock("@/lib/audit", () => ({ logEvent: async () => {} }));

const BUSINESS = { id: "b1", name: "Acme", website: null, locations: [] };

function post(body: unknown, url = "http://localhost/api/x"): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Some handlers are typed against NextRequest (cookies/nextUrl). */
function nextPost(body: unknown, url = "http://localhost/api/x"): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  vi.clearAllMocks();
  rateLimitResponse.mockResolvedValue(null); // not rate-limited by default
  getPrimaryBusiness.mockResolvedValue(BUSINESS);
  metaClientForBusiness.mockResolvedValue(null);
  upsert.mockResolvedValue({ error: null });
  del.mockResolvedValue({ error: null });
});

afterEach(() => vi.resetModules());

const anon = () => getUser.mockResolvedValue({ data: { user: null } });
const signedIn = (over: Record<string, unknown> = {}) =>
  getUser.mockResolvedValue({
    data: { user: { id: "u1", email: "owner@example.com", ...over } },
  });

describe("POST /api/spend-limits", () => {
  it("rejects anonymous callers", async () => {
    anon();
    const { POST } = await import("@/app/api/spend-limits/route");
    expect((await POST(post({}))).status).toBe(401);
  });

  it("rejects a negative weekly cap", async () => {
    signedIn();
    const { POST } = await import("@/app/api/spend-limits/route");
    const res = await POST(post({ weeklyCapRupees: -1 }));
    expect(res.status).toBe(422);
  });

  it("rejects an out-of-range alert percentage", async () => {
    signedIn();
    const { POST } = await import("@/app/api/spend-limits/route");
    expect((await POST(post({ alertPct: 0 }))).status).toBe(422);
    expect((await POST(post({ alertPct: 101 }))).status).toBe(422);
  });

  it("stores a valid cap and treats 0/blank as no cap", async () => {
    signedIn();
    const { POST } = await import("@/app/api/spend-limits/route");
    expect((await POST(post({ weeklyCapRupees: 7000, alertPct: 75 }))).status).toBe(200);
    expect(upsert.mock.calls[0][0]).toMatchObject({
      weekly_cap_rupees: 7000,
      alert_pct: 75,
      auto_pause: false,
    });

    await POST(post({ weeklyCapRupees: 0 }));
    expect(upsert.mock.calls[1][0]).toMatchObject({ weekly_cap_rupees: null });
  });

  it("returns 400 when the user has no business", async () => {
    signedIn();
    getPrimaryBusiness.mockResolvedValue(null);
    const { POST } = await import("@/app/api/spend-limits/route");
    expect((await POST(post({}))).status).toBe(400);
  });
});

describe("POST /api/meta/connect", () => {
  it("rejects anonymous callers", async () => {
    anon();
    const { POST } = await import("@/app/api/meta/connect/route");
    expect((await POST(nextPost({}))).status).toBe(401);
  });

  it("requires both an ad account and a page", async () => {
    signedIn();
    const { POST } = await import("@/app/api/meta/connect/route");
    expect((await POST(nextPost({ adAccountId: "act_1" }))).status).toBe(422);
    expect((await POST(nextPost({ pageId: "p1" }))).status).toBe(422);
  });
});

describe("POST /api/meta/disconnect", () => {
  it("rejects anonymous callers", async () => {
    anon();
    const { POST } = await import("@/app/api/meta/disconnect/route");
    expect((await POST()).status).toBe(401);
  });

  it("deletes the stored connection for the business", async () => {
    signedIn();
    const { POST } = await import("@/app/api/meta/disconnect/route");
    expect((await POST()).status).toBe(200);
    expect(del).toHaveBeenCalled();
  });
});

describe("GET /api/meta/accounts", () => {
  it("rejects anonymous callers", async () => {
    anon();
    const { GET } = await import("@/app/api/meta/accounts/route");
    expect((await GET()).status).toBe(401);
  });

  it("returns 400 when no OAuth connection is stored", async () => {
    signedIn();
    const { GET } = await import("@/app/api/meta/accounts/route");
    expect((await GET()).status).toBe(400);
  });
});

describe("GET /api/meta/geo-search", () => {
  it("rejects anonymous callers", async () => {
    anon();
    const { GET } = await import("@/app/api/meta/geo-search/route");
    const res = await GET(new Request("http://localhost/api/meta/geo-search?q=jai"));
    expect(res.status).toBe(401);
  });

  it("returns an empty result for a too-short query without calling Meta", async () => {
    signedIn();
    const { GET } = await import("@/app/api/meta/geo-search/route");
    const res = await GET(new Request("http://localhost/api/meta/geo-search?q=a"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ results: [] });
    expect(metaClientForBusiness).not.toHaveBeenCalled();
  });

  it("maps Meta matches to the UI shape", async () => {
    signedIn();
    metaClientForBusiness.mockResolvedValue({
      searchGeoLocations: async () => [
        { key: "1027633", name: "Jaipur", type: "city", region: "Rajasthan", country_code: "IN" },
      ],
    });
    const { GET } = await import("@/app/api/meta/geo-search/route");
    const res = await GET(new Request("http://localhost/api/meta/geo-search?q=jaipur"));
    await expect(res.json()).resolves.toEqual({
      results: [
        { key: "1027633", name: "Jaipur", type: "city", region: "Rajasthan", countryCode: "IN" },
      ],
    });
  });

  it("surfaces a Meta failure as 502", async () => {
    signedIn();
    metaClientForBusiness.mockResolvedValue({
      searchGeoLocations: async () => {
        throw new Error("meta down");
      },
    });
    const { GET } = await import("@/app/api/meta/geo-search/route");
    const res = await GET(new Request("http://localhost/api/meta/geo-search?q=jaipur"));
    expect(res.status).toBe(502);
  });
});

describe("GET /api/campaigns/lead-forms", () => {
  it("rejects anonymous callers", async () => {
    anon();
    const { GET } = await import("@/app/api/campaigns/lead-forms/route");
    expect((await GET()).status).toBe(401);
  });

  it("degrades gracefully when Meta isn't connected", async () => {
    signedIn();
    const { GET } = await import("@/app/api/campaigns/lead-forms/route");
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ forms: [] });
  });
});

describe("GET /api/campaigns/report", () => {
  it("rejects anonymous callers", async () => {
    anon();
    const { GET } = await import("@/app/api/campaigns/report/route");
    expect((await GET()).status).toBe(401);
  });

  it("serves a downloadable markdown report", async () => {
    signedIn();
    const { GET } = await import("@/app/api/campaigns/report/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/text\/markdown/);
    expect(res.headers.get("Content-Disposition")).toMatch(/attachment; filename=/);
    expect(await res.text()).toContain("Acme");
  });
});

describe("POST /api/creatives/generate", () => {
  it("rejects anonymous callers", async () => {
    anon();
    const { POST } = await import("@/app/api/creatives/generate/route");
    expect((await POST(post({}))).status).toBe(401);
  });

  it("honours the rate limiter before doing any work", async () => {
    signedIn();
    rateLimitResponse.mockResolvedValue(
      new Response(JSON.stringify({ error: "Too many" }), { status: 429 }),
    );
    const { POST } = await import("@/app/api/creatives/generate/route");
    const res = await POST(post({ businessId: "b1", brief: "hi" }));
    expect(res.status).toBe(429);
  });

  it("requires businessId and brief", async () => {
    signedIn();
    const { POST } = await import("@/app/api/creatives/generate/route");
    expect((await POST(post({ businessId: "", brief: "" }))).status).toBe(400);
  });
});

describe("POST /api/creatives/export", () => {
  it("rejects anonymous callers", async () => {
    anon();
    const { POST } = await import("@/app/api/creatives/export/route");
    expect((await POST(post({}))).status).toBe(401);
  });

  it("requires at least one creative id", async () => {
    signedIn();
    const { POST } = await import("@/app/api/creatives/export/route");
    expect((await POST(post({ creativeIds: [] }))).status).toBe(400);
  });

  it("404s when none of the ids resolve", async () => {
    signedIn();
    const { POST } = await import("@/app/api/creatives/export/route");
    expect((await POST(post({ creativeIds: ["x"] }))).status).toBe(404);
  });
});

describe("POST /api/internal/meta-traffic", () => {
  it("rejects anonymous callers", async () => {
    anon();
    const { POST } = await import("@/app/api/internal/meta-traffic/route");
    expect((await POST(post({}))).status).toBe(401);
  });

  it("is disabled in production when no allowlist is configured", async () => {
    signedIn();
    vi.stubEnv("NODE_ENV", "production");
    process.env.TRAFFIC_GENERATOR_ALLOWED_EMAILS = "";
    const { POST } = await import("@/app/api/internal/meta-traffic/route");
    expect((await POST(post({}))).status).toBe(404);
    vi.unstubAllEnvs();
  });

  it("forbids users outside the allowlist", async () => {
    signedIn({ email: "stranger@example.com" });
    process.env.TRAFFIC_GENERATOR_ALLOWED_EMAILS = "owner@example.com";
    const { POST } = await import("@/app/api/internal/meta-traffic/route");
    expect((await POST(post({}))).status).toBe(403);
    process.env.TRAFFIC_GENERATOR_ALLOWED_EMAILS = "";
  });

  it("admits an allowlisted user (case-insensitive)", async () => {
    signedIn({ email: "Owner@Example.com" });
    process.env.TRAFFIC_GENERATOR_ALLOWED_EMAILS = "owner@example.com";
    const { POST } = await import("@/app/api/internal/meta-traffic/route");
    const res = await POST(post({}));
    // Past the gate: fails later on Meta not being configured, not on 403.
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(404);
    process.env.TRAFFIC_GENERATOR_ALLOWED_EMAILS = "";
  });
});
