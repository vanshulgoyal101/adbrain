import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contract tests for route handlers: they must reject unauthenticated requests
 * and validate input before doing any work. Supabase's server client is mocked
 * so we control the "who is logged in" answer.
 */

const getUser = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: getUser },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null }) }),
      }),
    }),
  }),
}));

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  getUser.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/campaigns/create", () => {
  it("returns 401 when unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const { POST } = await import("@/app/api/campaigns/create/route");
    const res = await POST(jsonRequest({}));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when required fields are missing", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const { POST } = await import("@/app/api/campaigns/create/route");
    const res = await POST(jsonRequest({ businessId: "", creativeIds: [] }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/required/i);
  });
});

describe("POST /api/leads/sync", () => {
  it("returns 401 when unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const { POST } = await import("@/app/api/leads/sync/route");
    const res = await POST();
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: expect.any(String) });
  });
});
