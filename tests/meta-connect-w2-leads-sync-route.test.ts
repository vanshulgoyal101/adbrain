import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getPrimaryBusiness: vi.fn(),
  requireOwnedBusiness: vi.fn(),
  withMetaConnection: vi.fn(),
  metaClientForBusiness: vi.fn(),
}));

const business = { id: "business-1", name: "Business" };

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: () => ({
      upsert: async () => ({ error: null }),
      select: () => ({
        eq: () => ({ order: async () => ({ data: [] }) }),
      }),
    }),
  }),
}));
vi.mock("@/lib/supabase/queries", () => ({ getPrimaryBusiness: mocks.getPrimaryBusiness }));
vi.mock("@/lib/meta/credentials", () => ({ metaClientForBusiness: mocks.metaClientForBusiness }));
vi.mock("@/lib/meta/connection-access", () => ({
  ConnectionAccessError: class ConnectionAccessError extends Error {
    code = "UNAVAILABLE";
  },
  requireOwnedBusiness: mocks.requireOwnedBusiness,
  withMetaConnection: mocks.withMetaConnection,
}));
vi.mock("@/lib/audit", () => ({ logEvent: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  mocks.getPrimaryBusiness.mockResolvedValue(business);
  mocks.requireOwnedBusiness.mockResolvedValue({ businessId: business.id, userId: "user-1" });
  mocks.withMetaConnection.mockImplementation(async (_context, _options, execute) =>
    execute({
      listLeadForms: vi.fn().mockResolvedValue([]),
      listLeadsForForm: vi.fn(),
    }),
  );
});

describe("lead sync connection boundary", () => {
  it("uses the authorized read-leads boundary instead of legacy credentials", async () => {
    const { POST } = await import("@/app/api/leads/sync/route");
    const response = await POST();

    expect(response.status).toBe(200);
    expect(mocks.withMetaConnection).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: business.id }),
      { purpose: "read_leads" },
      expect.any(Function),
    );
    expect(mocks.metaClientForBusiness).not.toHaveBeenCalled();
  });
});