import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ calls: [] as [string, ...unknown[]][], row: null as unknown, failUpdate: false }));
const chain = () => {
  const q: Record<string, unknown> = {};
  for (const name of ["update", "select", "eq", "is"]) q[name] = (...args: unknown[]) => { m.calls.push([name, ...args]); return q; };
  q.maybeSingle = async () => ({ data: m.row, error: null });
  q.then = (resolve: (value: unknown) => void) => resolve({ error: m.failUpdate ? { message: "x" } : null });
  return q;
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) }, from: () => chain() }) }));
vi.mock("@/lib/supabase/queries", () => ({ getPrimaryBusiness: async () => ({ id: "10000000-0000-4000-8000-000000000001" }) }));
vi.mock("@/lib/observability/logger", () => ({ observeRoute: (_path: string, _method: string, handler: unknown) => handler }));
import { PATCH } from "@/app/api/leads/[id]/route";

const leadId = "20000000-0000-4000-8000-000000000001";
const patch = (body: unknown) => PATCH(new Request(`http://localhost/api/leads/${leadId}`, { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id: leadId }) });

beforeEach(() => { m.calls = []; m.row = { id: leadId, workflow_status: "contacted", first_contacted_at: "2026-10-27T10:05:00.000Z" }; m.failUpdate = false; });

describe("PATCH /api/leads/[id] {contacted: true} (#1049)", () => {
  it("records the first reply time once (only while unset) and moves a new enquiry to contacted; the client can't send a time", async () => {
    const response = await patch({ contacted: true });
    expect(response.status).toBe(200);
    expect((await response.json()).lead.first_contacted_at).toBe("2026-10-27T10:05:00.000Z");
    const updates = m.calls.filter(([name]) => name === "update").map(([, value]) => value);
    expect(updates).toEqual([{ first_contacted_at: expect.any(String) }, { workflow_status: "contacted" }]);
    expect(m.calls).toContainEqual(["is", "first_contacted_at", null]);
    expect(m.calls).toContainEqual(["eq", "workflow_status", "new"]);
    expect((await patch({ first_contacted_at: "2020-01-01T00:00:00Z" })).status).toBe(400);
    expect((await patch({ contacted: false })).status).toBe(400);
  });

  it("reports a failed save instead of success", async () => {
    m.failUpdate = true;
    expect((await patch({ contacted: true })).status).toBe(503);
  });
});
