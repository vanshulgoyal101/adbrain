import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getPrimaryBusiness: vi.fn(),
  requireOwnedBusiness: vi.fn(),
  withMetaConnection: vi.fn(),
  metaClientForBusiness: vi.fn(),
  upsert: vi.fn(),
  read: vi.fn(),
  listLeadForms: vi.fn(),
  listLeadsForForm: vi.fn(),
}));

const business = { id: "business-1", name: "Business" };

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: () => ({
      upsert: mocks.upsert,
      select: () => ({
        eq: () => ({ order: mocks.read }),
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
  mocks.upsert.mockResolvedValue({ error: null, count: 0 });
  mocks.read.mockResolvedValue({ data: [], error: null });
  mocks.listLeadForms.mockResolvedValue([]);
  mocks.listLeadsForForm.mockReset().mockResolvedValue([]);
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  mocks.getPrimaryBusiness.mockResolvedValue(business);
  mocks.requireOwnedBusiness.mockResolvedValue({ businessId: business.id, userId: "user-1" });
  mocks.withMetaConnection.mockImplementation(async (_context, _options, execute) =>
    execute({
      listLeadForms: mocks.listLeadForms,
      listLeadsForForm: mocks.listLeadsForForm,
    }),
  );
});

describe("lead sync connection boundary", () => {
  it("counts only inserted leads, not duplicates fetched from Meta", async () => {
    mocks.listLeadForms.mockResolvedValue([{ id: "form-1", name: "Enquiries" }]);
    mocks.listLeadsForForm.mockResolvedValue([{ id: "lead-1", field_data: [] }, { id: "lead-2", field_data: [] }]);
    mocks.upsert.mockResolvedValue({ error: null, count: 1 });
    const { POST } = await import("@/app/api/leads/sync/route");
    const response = await POST();
    expect(await response.json()).toMatchObject({ imported: 1, failedForms: [] });
    expect(mocks.upsert).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ count: "exact", ignoreDuplicates: true }));
  });

  it("reports unreadable forms while retaining successful imports", async () => {
    mocks.listLeadForms.mockResolvedValue([{ id: "form-1", name: "Available" }, { id: "form-2", name: "Restricted" }]);
    mocks.listLeadsForForm.mockResolvedValueOnce([{ id: "lead-1", field_data: [] }]).mockRejectedValueOnce(new Error("denied"));
    mocks.upsert.mockResolvedValue({ error: null, count: 1 });
    const { POST } = await import("@/app/api/leads/sync/route");
    const response = await POST();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ imported: 1, failedForms: [{ id: "form-2", name: "Restricted" }] });
  });

  it("fails rather than claiming up-to-date when every form is unreadable", async () => {
    mocks.listLeadForms.mockResolvedValue([{ id: "form-1", name: "Restricted" }]);
    mocks.listLeadsForForm.mockRejectedValue(new Error("denied"));
    const { POST } = await import("@/app/api/leads/sync/route");
    const response = await POST();
    expect(response.status).toBe(502);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it.each([false, true])("does not replace saved leads with an empty success after a read failure (imports=%s)", async (hasImports) => {
    if (hasImports) {
      mocks.listLeadForms.mockResolvedValue([{ id: "form-1", name: "Available" }]);
      mocks.listLeadsForForm.mockResolvedValue([{ id: "lead-1", field_data: [] }]);
    }
    mocks.read.mockResolvedValue({ data: null, error: { message: "database unavailable" } });
    const { POST } = await import("@/app/api/leads/sync/route");
    const response = await POST();
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(await response.json()).not.toHaveProperty("leads");
  });

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