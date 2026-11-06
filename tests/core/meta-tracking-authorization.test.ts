import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthSessionMissingError } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  businessRow: vi.fn(),
  withMetaConnection: vi.fn(),
  getConnectionStatus: vi.fn(),
  rateLimitResponse: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: (table: string) => {
      expect(table).toBe("businesses");
      return { select: () => ({ eq: (_column: string, id: string) => ({ maybeSingle: () => mocks.businessRow(id) }) }) };
    },
  }),
}));
vi.mock("@/lib/meta/connection-access", async (original) => ({
  ...await original<typeof import("@/lib/meta/connection-access")>(),
  withMetaConnection: mocks.withMetaConnection,
  getConnectionStatus: mocks.getConnectionStatus,
}));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: mocks.rateLimitResponse }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const businessId = "11111111-1111-4111-8111-111111111111";
const otherBusiness = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const user = {
  id: "22222222-2222-4222-8222-222222222222",
  email: "team@adbrain.vanshul.com",
  email_confirmed_at: "2026-10-01T00:00:00Z",
};

async function get(id: string) {
  const { GET } = await import("@/app/api/meta/tracking/route");
  return GET(new Request(`http://localhost/api/meta/tracking?businessId=${id}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user }, error: null });
  mocks.businessRow.mockResolvedValue({ data: { id: businessId, owner_id: user.id }, error: null });
  mocks.rateLimitResponse.mockResolvedValue(null);
});

describe("tracking read uses the real business-ownership boundary", () => {
  it("refuses another owner's business before any Meta or connection read", async () => {
    mocks.businessRow.mockResolvedValue({ data: { id: otherBusiness, owner_id: "33333333-3333-4333-8333-333333333333" }, error: null });
    const response = await get(otherBusiness);
    expect(response.status).toBe(403);
    expect(mocks.businessRow).toHaveBeenCalledWith(otherBusiness);
    expect(mocks.withMetaConnection).not.toHaveBeenCalled();
    expect(mocks.getConnectionStatus).not.toHaveBeenCalled();
  });

  it("returns unavailable rather than an empty account when ownership cannot be checked", async () => {
    mocks.businessRow.mockResolvedValue({ data: null, error: { message: "private database detail" } });
    const response = await get(businessId);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private database detail");
    expect(mocks.withMetaConnection).not.toHaveBeenCalled();
  });

  it("distinguishes a missing session from an auth outage", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: new AuthSessionMissingError() });
    expect((await get(businessId)).status).toBe(401);
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: new Error("auth offline") });
    expect((await get(businessId)).status).toBe(503);
    expect(mocks.businessRow).not.toHaveBeenCalled();
  });

  it("fails closed if the session disappears during the ownership check", async () => {
    mocks.getUser
      .mockResolvedValueOnce({ data: { user }, error: null })
      .mockResolvedValueOnce({ data: { user: null }, error: new AuthSessionMissingError() });
    expect((await get(businessId)).status).toBe(401);
    expect(mocks.businessRow).not.toHaveBeenCalled();
    expect(mocks.withMetaConnection).not.toHaveBeenCalled();
  });

  it("allows the verified owner through with an authorized business context", async () => {
    mocks.withMetaConnection.mockResolvedValue({
      businessId, connectionGeneration: 4, binding: { adAccountId: "act_1", pageId: "page_1" }, status: { state: "none", pixelId: null },
    });
    mocks.getConnectionStatus.mockResolvedValue({
      businessId, generation: 4, authorization: "connected",
      selected: { adAccountId: "act_1", pageId: "page_1" },
    });
    const response = await get(businessId);
    expect(response.status).toBe(200);
    expect(mocks.businessRow).toHaveBeenCalledWith(businessId);
    expect(mocks.withMetaConnection).toHaveBeenCalledWith(
      expect.objectContaining({ businessId, userId: user.id }),
      { purpose: "read_insights", expectedGeneration: 4, binding: { adAccountId: "act_1", pageId: "page_1" }, event: false },
      expect.any(Function),
    );
  });
});
