import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "owner-1" } as { id: string } | null,
  existing: [] as unknown[],
  readError: null as unknown,
  rpcError: null as { code?: string; message: string } | null,
  rpc: vi.fn(),
  gte: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: mocks.user } }) } }) }));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: async () => null }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const query = {
      select: () => query, eq: () => query, limit: () => query,
      gte: (...args: unknown[]) => { mocks.gte(...args); return query; },
      abortSignal: async () => ({ data: mocks.readError ? null : mocks.existing, error: mocks.readError }),
    };
    return {
      from: () => query,
      rpc: (...args: unknown[]) => { mocks.rpc(...args); return { abortSignal: async () => ({ data: "event-1", error: mocks.rpcError }) }; },
    };
  },
}));

const BUSINESS = "927f384c-0000-4000-8000-000000000001";
const post = async (body: unknown = { businessId: BUSINESS }) => {
  const { POST } = await import("@/app/api/meta/access-request/route");
  const response = await POST(new Request("http://localhost/api/meta/access-request", { method: "POST", body: JSON.stringify(body) }));
  return { status: response.status, body: await response.json() };
};

beforeEach(() => {
  mocks.user = { id: "owner-1" }; mocks.existing = []; mocks.readError = null; mocks.rpcError = null;
  mocks.rpc.mockClear(); mocks.gte.mockClear();
});

describe("POST /api/meta/access-request (#725)", () => {
  it("writes the request to the audit log before answering ok", async () => {
    expect(await post()).toEqual({ status: 200, body: { ok: true } });
    expect(mocks.rpc).toHaveBeenCalledWith("append_verified_audit_event", expect.objectContaining({
      p_business_id: BUSINESS, p_actor_id: "owner-1", p_action: "meta.access_request", p_entity_type: "business",
    }));
    expect(mocks.gte).toHaveBeenCalledWith("created_at", `${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  });

  it("records once per user per day", async () => {
    mocks.existing = [{ id: "earlier-today" }];
    expect((await post()).status).toBe(200);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("never answers ok without a record", async () => {
    mocks.rpcError = { message: "timeout" };
    expect((await post()).status).toBe(503);
    mocks.rpcError = null;
    mocks.readError = { message: "down" };
    expect((await post()).status).toBe(503);
  });

  it("refuses another owner's business, a bad body and a signed-out caller", async () => {
    mocks.rpcError = { code: "42501", message: "Audit owner mismatch" };
    expect((await post()).status).toBe(404);
    expect((await post({ businessId: "nope" })).status).toBe(400);
    mocks.user = null;
    expect((await post()).status).toBe(401);
  });
});
