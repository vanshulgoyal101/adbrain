import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  requireOwnedBusiness: vi.fn(),
  rpc: vi.fn(),
  row: null as Record<string, unknown> | null,
}));

const operationRow = {
  id: "a123a123-a123-4123-8123-a123a123a123",
  business_id: "b123b123-b123-4123-8123-b123b123b123",
  draft_id: "d123d123-d123-4123-8123-d123d123d123",
  campaign_id: null,
  draft_version: 1,
  connection_generation: 4,
  kind: "campaign_create",
  idempotency_key: "idem-1234",
  request_hash: "a".repeat(64),
  state: "needs_reconciliation",
  phase: "reconcile",
  lease_until: null,
  attempt_count: 1,
  payload: {},
  result: null,
  external_ids: ["meta-campaign-1"],
  sanitized_error: "redacted",
  created_at: "2026-09-07T10:00:00.000Z",
  updated_at: "2026-09-07T10:00:00.000Z",
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: mocks.row ?? operationRow, error: null }) }),
      }),
    }),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/meta/connection-access", () => ({
  ConnectionAccessError: class ConnectionAccessError extends Error {
    code = "FORBIDDEN";
  },
  requireOwnedBusiness: mocks.requireOwnedBusiness,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.row = null;
  mocks.rpc.mockResolvedValue({ data: [operationRow], error: null });
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  mocks.requireOwnedBusiness.mockResolvedValue({ businessId: operationRow.business_id, userId: "user-1" });
});

describe("GET /api/campaigns/operations/[id]", () => {
  it("persists expiry before returning a recovery outcome", async () => {
    mocks.row = { ...operationRow, state: "running", phase: "campaign", lease_until: "2020-01-01T00:00:00Z" };
    const { GET } = await import("@/app/api/campaigns/operations/[id]/route");
    const response = await GET(new Request("http://localhost/api/campaigns/operations/o"), { params: Promise.resolve({ id: operationRow.id }) });
    expect(response.status).toBe(200);
    expect((await response.json()).data.state).toBe("needs_reconciliation");
    expect(mocks.rpc).toHaveBeenCalledWith("expire_campaign_operation", { p_operation_id: operationRow.id, p_business_id: operationRow.business_id });
  });

  it("does not mutate a foreign operation before ownership is proven", async () => {
    mocks.row = { ...operationRow, state: "running", lease_until: "2020-01-01T00:00:00Z" };
    mocks.requireOwnedBusiness.mockRejectedValue(new Error("Access denied"));
    const { GET } = await import("@/app/api/campaigns/operations/[id]/route");
    const response = await GET(new Request("http://localhost/api/campaigns/operations/o"), { params: Promise.resolve({ id: operationRow.id }) });
    expect(response.status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("returns a safe reconciliation DTO without raw errors or external IDs", async () => {
    const { GET } = await import("@/app/api/campaigns/operations/[id]/route");
    const response = await GET(new Request("http://localhost/api/campaigns/operations/o"), {
      params: Promise.resolve({ id: operationRow.id }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      operationId: operationRow.id,
      businessId: operationRow.business_id,
      state: "needs_reconciliation",
      campaignId: null,
      blockers: [{ code: "RECONCILIATION_REQUIRED" }],
    });
    expect(JSON.stringify(body)).not.toContain("redacted");
    expect(JSON.stringify(body)).not.toContain("meta-campaign-1");
  });
});