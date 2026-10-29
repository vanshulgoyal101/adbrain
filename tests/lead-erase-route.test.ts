import { beforeEach, describe, expect, it, vi } from "vitest";

// #1761 (DPDP erasure, #1758): owners delete an enquiry, or all of a campaign's, through RLS (leads_erase); the
// audit row names only ids and a count.
const m = vi.hoisted(() => ({ rpc: vi.fn(), campaign: null as unknown, audit: vi.fn(), user: { id: "owner" } as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: m.user } }) },
  rpc: m.rpc,
  from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: m.campaign, error: null }) }) }) }) }),
}) }));
vi.mock("@/lib/supabase/queries", () => ({ getPrimaryBusiness: async () => ({ id: "10000000-0000-4000-8000-000000000001" }) }));
vi.mock("@/lib/audit", () => ({ logEvent: m.audit }));
vi.mock("@/lib/observability/logger", () => ({ observeRoute: (_path: string, _method: string, handler: unknown) => handler }));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: async () => null }));

const business = "10000000-0000-4000-8000-000000000001";
const leadId = "20000000-0000-4000-8000-000000000001";
const campaignId = "30000000-0000-4000-8000-000000000001";

beforeEach(() => {
  m.rpc.mockReset().mockResolvedValue({ data: 1, error: null });
  m.audit.mockReset();
  m.campaign = { id: campaignId };
  m.user = { id: "owner" };
});

describe("DELETE /api/leads/[id] (#1761)", () => {
  const remove = async (id = leadId) => {
    const { DELETE } = await import("@/app/api/leads/[id]/route");
    return DELETE(new Request(`http://localhost/api/leads/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) });
  };

  it("erases the owner's enquiry and audits it without personal data", async () => {
    const response = await remove();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, deleted: 1 });
    expect(m.rpc).toHaveBeenCalledWith("leads_erase", { p_business_id: business, p_lead_id: leadId });
    expect(m.audit).toHaveBeenCalledWith({ businessId: business, action: "lead.deleted", entityType: "lead", entityId: leadId, details: { count: 1 } });
  });

  it("answers 404 when nothing of the owner's matched, and 400 for a bad id", async () => {
    m.rpc.mockResolvedValue({ data: 0, error: null });
    expect((await remove()).status).toBe(404);
    expect(m.audit).not.toHaveBeenCalled();
    expect((await remove("not-a-uuid")).status).toBe(400);
  });

  it("needs a signed-in owner", async () => {
    m.user = null;
    expect((await remove()).status).toBe(401);
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/leads?campaignId= (#1761)", () => {
  const removeAll = async (query: string) => {
    const { DELETE } = await import("@/app/api/leads/route");
    return DELETE(new Request(`http://localhost/api/leads?${query}`, { method: "DELETE" }));
  };

  it("erases every enquiry of the owner's campaign and audits the count", async () => {
    m.rpc.mockResolvedValue({ data: 7, error: null });
    const response = await removeAll(`campaignId=${campaignId}`);
    expect(await response.json()).toEqual({ ok: true, deleted: 7 });
    expect(m.rpc).toHaveBeenCalledWith("leads_erase", { p_business_id: business, p_campaign_id: campaignId });
    expect(m.audit).toHaveBeenCalledWith({ businessId: business, action: "leads.deleted", entityType: "campaign", entityId: campaignId, details: { count: 7 } });
  });

  it("refuses a campaign that isn't the owner's, or no campaign", async () => {
    m.campaign = null;
    expect((await removeAll(`campaignId=${campaignId}`)).status).toBe(404);
    expect((await removeAll("")).status).toBe(400);
    expect(m.rpc).not.toHaveBeenCalled();
  });
});
