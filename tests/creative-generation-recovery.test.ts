import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  intent: vi.fn(),
  rateLimit: vi.fn(),
  audit: vi.fn(),
  auditFilters: [] as [string, string][],
}));
// #1407: the batch's closing audit row, read only when a batch looks unfinished.
function auditChain() {
  const chain = { select: () => chain, eq: (column: string, value: string) => { mocks.auditFilters.push([column, value]); return chain; }, limit: () => mocks.audit() };
  return chain;
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.intent }) }));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: mocks.rateLimit }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: (table: string) => table === "audit_log" ? auditChain() : ({
      select: () => ({
        eq: (column: string, value: string) => {
          mocks.eq(column, value);
          return {
            eq: (column: string, value: string) => {
              mocks.eq(column, value);
              return { order: mocks.select };
            },
          };
        },
      }),
    }),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auditFilters = [];
  mocks.audit.mockResolvedValue({ data: [], error: null });
  mocks.rateLimit.mockResolvedValue(null);
  mocks.getUser.mockResolvedValue({ data: { user: { id: "owner" } } });
  mocks.intent.mockResolvedValue({ data: { status: "processing", expectedCount: 3 }, error: null });
  mocks.select.mockResolvedValue({
    data: [{ id: "creative-1", business_id: "business", variant_group: "11111111-1111-4111-8111-111111111111" }],
    error: null,
  });
});

describe("creative generation recovery", () => {
  // #1407 (QA): a batch that finished 2 of 3 read 'partial' for 5 more minutes, so Studio said 'still being made'.
  it("#1407: a short batch whose closing audit row exists is 'ended', not 'partial'", async () => {
    mocks.intent.mockResolvedValue({ data: { status: "partial", expectedCount: 3 }, error: null });
    mocks.audit.mockResolvedValue({ data: [{ id: "a1" }], error: null });
    const { GET } = await import("@/app/api/creatives/generate/route");
    const response = await GET(new Request("http://localhost/api/creatives/generate?businessId=business&generationId=11111111-1111-4111-8111-111111111111"));
    await expect(response.json()).resolves.toMatchObject({ status: "ended", count: 1, expectedCount: 3 });
    expect(mocks.auditFilters).toEqual([["business_id", "business"], ["action", "creatives.generate"], ["details->>variantGroup", "11111111-1111-4111-8111-111111111111"]]);
  });

  it("returns persisted partial work without starting a second generation", async () => {
    const { GET } = await import("@/app/api/creatives/generate/route");
    const response = await GET(new Request("http://localhost/api/creatives/generate?businessId=business&generationId=11111111-1111-4111-8111-111111111111&expectedCount=3"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "partial", count: 1, expectedCount: 3 });
    expect(mocks.select).toHaveBeenCalled();
    expect(mocks.eq.mock.calls).toEqual([
      ["business_id", "business"],
      ["variant_group", "11111111-1111-4111-8111-111111111111"],
    ]);
  });

  it("requires a signed-in user before reading saved creatives", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const { GET } = await import("@/app/api/creatives/generate/route");
    const response = await GET(new Request("http://localhost/api/creatives/generate"));
    expect(response.status).toBe(401);
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it.each([
    { data: [], expectedCount: 3, status: "processing" },
    { data: [{ id: "creative-1" }], expectedCount: 1, status: "complete" },
  ])("returns $status for the saved result count", async ({ data, expectedCount, status }) => {
    mocks.select.mockResolvedValue({ data, error: null });
    mocks.intent.mockResolvedValue({ data: { status, expectedCount }, error: null });
    const { GET } = await import("@/app/api/creatives/generate/route");
    const response = await GET(new Request(`http://localhost/api/creatives/generate?businessId=business&generationId=11111111-1111-4111-8111-111111111111&expectedCount=${expectedCount}`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status, count: data.length });
  });

  it("reports unknown identities without implying paid work started", async () => {
    mocks.intent.mockResolvedValue({ data: { status: "unknown" }, error: null });
    const { GET } = await import("@/app/api/creatives/generate/route");
    const response = await GET(new Request("http://localhost/api/creatives/generate?businessId=business&generationId=11111111-1111-4111-8111-111111111111"));
    expect(response.status).toBe(404);
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("limits recovery requests before claiming an unknown ID", async () => {
    mocks.rateLimit.mockResolvedValue(new Response("Too many requests", { status: 429 }));
    const { GET } = await import("@/app/api/creatives/generate/route");
    const response = await GET(new Request("http://localhost/api/creatives/generate?businessId=business&generationId=11111111-1111-4111-8111-111111111111"));
    expect(response.status).toBe(429);
    expect(mocks.intent).not.toHaveBeenCalled();
  });

  it.each(["failed", "unresolved"])("reports a persisted %s outcome without calling it processing", async (status) => {
    mocks.intent.mockResolvedValue({ data: { status, expectedCount: 3 }, error: null });
    mocks.select.mockResolvedValue({ data: [], error: null });
    const { GET } = await import("@/app/api/creatives/generate/route");
    const response = await GET(new Request("http://localhost/api/creatives/generate?businessId=business&generationId=11111111-1111-4111-8111-111111111111&expectedCount=3"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status, count: 0 });
  });

  it("rejects a changed expected count without reading saved creatives", async () => {
    const { GET } = await import("@/app/api/creatives/generate/route");
    const response = await GET(new Request("http://localhost/api/creatives/generate?businessId=business&generationId=11111111-1111-4111-8111-111111111111&expectedCount=2"));
    expect(response.status).toBe(409);
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("does not expose database errors", async () => {
    mocks.select.mockResolvedValue({ data: null, error: { message: "private database details" } });
    const { GET } = await import("@/app/api/creatives/generate/route");
    const response = await GET(new Request("http://localhost/api/creatives/generate?businessId=business&generationId=11111111-1111-4111-8111-111111111111"));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Generation status is unavailable." });
  });

  it.each(["0", "7", "1.5", "invalid"])("rejects an invalid expected count: %s", async (count) => {
    const { GET } = await import("@/app/api/creatives/generate/route");
    const response = await GET(new Request(`http://localhost/api/creatives/generate?businessId=business&generationId=11111111-1111-4111-8111-111111111111&expectedCount=${count}`));
    expect(response.status).toBe(400);
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("rejects invalid reconciliation identifiers before querying creatives", async () => {
    const { GET } = await import("@/app/api/creatives/generate/route");
    const response = await GET(new Request("http://localhost/api/creatives/generate?businessId=business&generationId=not-a-uuid&expectedCount=3"));
    expect(response.status).toBe(400);
    expect(mocks.select).not.toHaveBeenCalled();
  });
});