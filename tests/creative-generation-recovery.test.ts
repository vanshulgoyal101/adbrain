import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: () => ({
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
  mocks.getUser.mockResolvedValue({ data: { user: { id: "owner" } } });
  mocks.select.mockResolvedValue({
    data: [{ id: "creative-1", business_id: "business", variant_group: "11111111-1111-4111-8111-111111111111" }],
    error: null,
  });
});

describe("creative generation recovery", () => {
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
    const { GET } = await import("@/app/api/creatives/generate/route");
    const response = await GET(new Request(`http://localhost/api/creatives/generate?businessId=business&generationId=11111111-1111-4111-8111-111111111111&expectedCount=${expectedCount}`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status, count: data.length });
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