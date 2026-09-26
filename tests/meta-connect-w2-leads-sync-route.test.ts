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
  formsPage: vi.fn(),
  leadsPage: vi.fn(),
  rpc: vi.fn(),
}));

const business = { id: "business-1", name: "Business" };
const syncId = "11111111-1111-4111-8111-111111111111";
type Progress = { formsDone: boolean; formsAfter: string | null; formsSeen: string[]; formIds: string[]; pending: { id: string; name: string; after: string | null; seen: string[]; failed: boolean }[]; discover: boolean };
let persisted: { id: string; version: number; state: string; progress: Progress } | undefined;
const savedLeads = new Map<string, Record<string, unknown>>();

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: () => ({
      upsert: mocks.upsert,
      select: () => ({
        eq: () => ({ order: () => ({ limit: () => ({ abortSignal: mocks.read }) }) }),
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
  vi.resetAllMocks();
  persisted = undefined;
  savedLeads.clear();
  mocks.upsert.mockImplementation(async (rows: Record<string, unknown>[]) => {
    let count = 0;
    for (const row of rows) {
      const id = String(row.meta_lead_id);
      if (savedLeads.has(id)) continue;
      savedLeads.set(id, row);
      count++;
    }
    return { error: null, count };
  });
  mocks.rpc.mockImplementation((name: string, args: { p_sync_id: string | null; p_version: number; p_rows: Record<string, unknown>[]; p_progress: Progress }) => ({
    abortSignal: async () => {
      if (name === "lead_sync_start") {
        if (args.p_sync_id && args.p_sync_id !== persisted?.id) return { error: { code: "P0002" } };
        persisted ??= { id: syncId, version: 0, state: "partial", progress: { formsDone: false, formsAfter: null, formsSeen: [], formIds: [], pending: [], discover: true } };
        return { data: [structuredClone(persisted)], error: null };
      }
      if (!persisted || persisted.version !== args.p_version) return { error: { code: "40001" } };
      const saved = args.p_rows.length ? await mocks.upsert(args.p_rows, { onConflict: "business_id,meta_lead_id", count: "exact", ignoreDuplicates: true }) : { count: 0 };
      if (saved.error) return { error: saved.error };
      persisted = { ...persisted, version: persisted.version + 1, progress: structuredClone(args.p_progress), state: args.p_progress.formsDone && args.p_progress.pending.length === 0 ? "complete" : "partial" };
      return { data: { run: structuredClone(persisted), imported: saved.count }, error: null };
    },
  }));
  mocks.read.mockImplementation(async () => ({ data: [...savedLeads.values()], error: null }));
  mocks.listLeadForms.mockResolvedValue([]);
  mocks.listLeadsForForm.mockReset().mockResolvedValue([]);
  mocks.formsPage.mockImplementation(async () => ({ data: await mocks.listLeadForms(), after: null }));
  mocks.leadsPage.mockImplementation(async (form: string) => ({ data: await mocks.listLeadsForForm(form), after: null }));
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  mocks.getPrimaryBusiness.mockResolvedValue(business);
  mocks.requireOwnedBusiness.mockResolvedValue({ businessId: business.id, userId: "user-1" });
  mocks.withMetaConnection.mockImplementation(async (_context, _options, execute) =>
    execute({
      listLeadFormsPage: mocks.formsPage,
      listLeadsForFormPage: mocks.leadsPage,
    }, { generation: 1, selected: { adAccountId: "act_sync", pageId: "page_sync" } }),
  );
});

describe("lead sync connection boundary", () => {
  it("reads at most three forms concurrently and preserves form order", async () => {
    const forms = ["first", "second", "third", "fourth"].map(id => ({ id, name: id }));
    mocks.listLeadForms.mockResolvedValue(forms);
    const resolveReads = new Map<string, (leads: { id: string; field_data: [] }[]) => void>();
    mocks.listLeadsForForm.mockImplementation((formId: string) => new Promise(resolve => resolveReads.set(formId, resolve)));
    const { POST } = await import("@/app/api/leads/sync/route");
    const response = POST();
    await vi.waitFor(() => expect(mocks.listLeadsForForm).toHaveBeenCalledTimes(3));
    for (const formId of ["third", "second", "first"]) resolveReads.get(formId)!([{ id: formId, field_data: [] }]);
    await vi.waitFor(() => expect(mocks.listLeadsForForm).toHaveBeenCalledTimes(4));
    resolveReads.get("fourth")!([{ id: "fourth", field_data: [] }]);
    expect((await response).status).toBe(200);
    expect(mocks.upsert.mock.calls.flatMap(([rows]) => rows.map((lead: { form_id: string }) => lead.form_id))).toEqual(forms.map(form => form.id));
  });

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
      expect.objectContaining({ purpose: "read_leads", signal: expect.any(AbortSignal) }),
      expect.any(Function),
    );
    expect(mocks.metaClientForBusiness).not.toHaveBeenCalled();
  });

  it("resumes an interrupted multi-page import without losing owner fields or recounting duplicates", async () => {
    mocks.formsPage.mockResolvedValueOnce({ data: [{ id: "form-1", name: "First" }], after: "forms2" })
      .mockResolvedValueOnce({ data: [{ id: "form-2", name: "Second" }], after: null });
    mocks.leadsPage.mockImplementation(async (form: string, options: { after: string | null }) => {
      if (form === "form-2") return { data: [{ id: "lead-3", field_data: [] }], after: null };
      if (options.after) throw new Error("Page two interrupted");
      return { data: [{ id: "lead-1", field_data: [] }], after: "leads2" };
    });
    const { POST } = await import("@/app/api/leads/sync/route");
    const first = await (await POST()).json();
    expect(first).toMatchObject({ imported: 2, sync: { id: syncId, state: "partial", hasMore: true }, failedForms: [{ id: "form-1", name: "First" }] });
    expect(savedLeads.size).toBe(2);
    Object.assign(savedLeads.get("lead-1")!, { workflow_status: "contacted", follow_up_note: "Call tomorrow", campaign_id: "verified-campaign" });
    mocks.leadsPage.mockResolvedValue({ data: [{ id: "lead-1", field_data: [] }, { id: "lead-2", field_data: [] }], after: null });
    const second = await POST(new Request("http://localhost/api/leads/sync", { method: "POST", body: JSON.stringify({ syncId }) }));
    expect(await second.json()).toMatchObject({ imported: 1, failedForms: [], sync: { id: syncId, state: "complete", hasMore: false } });
    expect(mocks.formsPage).toHaveBeenCalledTimes(2);
    expect(mocks.leadsPage).toHaveBeenLastCalledWith("form-1", { after: "leads2" });
    expect(savedLeads.size).toBe(3);
    expect(savedLeads.get("lead-1")).toMatchObject({ workflow_status: "contacted", follow_up_note: "Call tomorrow", campaign_id: "verified-campaign" });
  });

  it("keeps the checkpoint before a failed page save and resumes on an empty retry", async () => {
    mocks.listLeadForms.mockResolvedValue([{ id: "form-1", name: "Available" }]);
    mocks.listLeadsForForm.mockResolvedValue([{ id: "lead-1", field_data: [] }]);
    mocks.upsert.mockResolvedValueOnce({ error: { code: "08006" } });
    const { POST } = await import("@/app/api/leads/sync/route");
    const failed = await POST();
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({ imported: 0, sync: { id: syncId, state: "partial", hasMore: true } });
    expect(persisted?.progress.pending[0].after).toBeNull();
    expect(savedLeads.size).toBe(0);
    expect(await (await POST()).json()).toMatchObject({ imported: 1, sync: { id: syncId, state: "complete" } });
    expect(mocks.formsPage).toHaveBeenCalledTimes(1);
  });

  it("bounds provider pages and resumes the remaining forms rather than starving them", async () => {
    mocks.listLeadForms.mockResolvedValue(Array.from({ length: 30 }, (_, index) => ({ id: String(index), name: String(index) })));
    const { POST } = await import("@/app/api/leads/sync/route");
    expect(await (await POST()).json()).toMatchObject({ sync: { state: "partial", hasMore: true } });
    expect(mocks.formsPage.mock.calls.length + mocks.leadsPage.mock.calls.length).toBe(24);
    expect(await (await POST()).json()).toMatchObject({ sync: { state: "complete", hasMore: false } });
    expect(mocks.leadsPage.mock.calls.map(([id]) => id)).toEqual(Array.from({ length: 30 }, (_, index) => String(index)));
  });

  it("keeps a repeated lead cursor partial and preserves previously saved pages", async () => {
    mocks.listLeadForms.mockResolvedValue([{ id: "form-1", name: "Available" }]);
    mocks.leadsPage.mockResolvedValueOnce({ data: [{ id: "lead-1", field_data: [] }], after: "again" })
      .mockResolvedValue({ data: [{ id: "lead-2", field_data: [] }], after: "again" });
    const { POST } = await import("@/app/api/leads/sync/route");
    expect(await (await POST()).json()).toMatchObject({ imported: 1, sync: { state: "partial", hasMore: true } });
    expect(mocks.leadsPage).toHaveBeenCalledTimes(2);
    expect(savedLeads.size).toBe(1);
  });

  it.each(["42501", "P0002", "40001"])("rejects unavailable or changed-binding resumes before provider reads (%s)", async code => {
    mocks.rpc.mockReturnValue({ abortSignal: async () => ({ error: { code } }) });
    const { POST } = await import("@/app/api/leads/sync/route");
    expect((await POST()).status).toBe(code === "40001" ? 409 : 404);
    expect(mocks.formsPage).not.toHaveBeenCalled();
  });

  it("rejects caller-supplied scope and malformed sync IDs", async () => {
    const { POST } = await import("@/app/api/leads/sync/route");
    for (const body of [{ syncId: "bad" }, { businessId: "someone-else" }]) {
      expect((await POST(new Request("http://localhost/api/leads/sync", { method: "POST", body: JSON.stringify(body) }))).status).toBe(400);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("leaves a resumable checkpoint without dispatching after the deadline", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(AbortSignal.abort());
    try {
      const { POST } = await import("@/app/api/leads/sync/route");
      expect(await (await POST()).json()).toMatchObject({ imported: 0, sync: { state: "partial", hasMore: true } });
      expect(mocks.formsPage).not.toHaveBeenCalled();
      expect(mocks.leadsPage).not.toHaveBeenCalled();
    } finally { timeout.mockRestore(); }
  });

  it("retains a discovery continuation when a later form page fails", async () => {
    mocks.formsPage.mockResolvedValueOnce({ data: [{ id: "form-1", name: "First" }], after: "forms2" })
      .mockRejectedValueOnce(new Error("Malformed later page"));
    mocks.listLeadsForForm.mockResolvedValue([{ id: "lead-1", field_data: [] }]);
    const { POST } = await import("@/app/api/leads/sync/route");
    expect(await (await POST()).json()).toMatchObject({ imported: 1, sync: { state: "partial", hasMore: true } });
    expect(persisted?.progress.formsAfter).toBe("forms2");
    mocks.formsPage.mockResolvedValue({ data: [{ id: "form-2", name: "Second" }], after: null });
    mocks.listLeadsForForm.mockResolvedValue([{ id: "lead-2", field_data: [] }]);
    expect(await (await POST()).json()).toMatchObject({ imported: 1, sync: { state: "complete", hasMore: false } });
    expect(mocks.formsPage).toHaveBeenLastCalledWith({ after: "forms2" });
  });
});