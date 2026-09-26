import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseLeadFields } from "@/lib/leads/parse";
import { buildLeadDigest, relativeAge } from "@/lib/leads/digest";
import { leadListSchema, leadUpdateSchema } from "@/lib/leads/filters";
import { getLeadPage } from "@/lib/leads/queries";
import { GET } from "@/app/api/leads/route";
import { PATCH } from "@/app/api/leads/[id]/route";

const databaseMocks = vi.hoisted(() => ({
  getUser: vi.fn(), business: vi.fn(), rpc: vi.fn(), from: vi.fn(), update: vi.fn(),
  eq: vi.fn(), select: vi.fn(), maybeSingle: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: databaseMocks.getUser }, rpc: databaseMocks.rpc, from: databaseMocks.from,
}) }));
vi.mock("@/lib/supabase/queries", () => ({ getPrimaryBusiness: databaseMocks.business }));
vi.mock("@/lib/observability/logger", () => ({ observeRoute: (_path: string, _method: string, handler: unknown) => handler }));

describe("enquiry list and follow-up routes", () => {
  const businessId = "10000000-0000-4000-8000-000000000001";
  const leadId = "20000000-0000-4000-8000-000000000001";
  beforeEach(() => {
    vi.clearAllMocks();
    databaseMocks.getUser.mockResolvedValue({ data: { user: { id: "owner" } } });
    databaseMocks.business.mockResolvedValue({ id: businessId });
    databaseMocks.rpc.mockResolvedValue({ data: { leads: [], nextCursor: null, total: 225 }, error: null });
    databaseMocks.from.mockReturnValue(databaseMocks);
    databaseMocks.update.mockReturnValue(databaseMocks);
    databaseMocks.eq.mockReturnValue(databaseMocks);
    databaseMocks.select.mockReturnValue(databaseMocks);
    databaseMocks.maybeSingle.mockResolvedValue({ data: { id: leadId, workflow_status: "booked", follow_up_note: "Synthetic" }, error: null });
  });
  const patch = (body: unknown, id = leadId) => PATCH(new Request(`http://localhost/api/leads/${id}`, {
    method: "PATCH", body: JSON.stringify(body),
  }), { params: Promise.resolve({ id }) });

  it("returns the actual saved-record count with private no-store caching", async () => {
    const response = await GET(new Request("http://localhost/api/leads?query=customer&status=booked&contact=ready"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ leads: [], total: 225, nextCursor: null });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(databaseMocks.rpc).toHaveBeenCalledWith("get_lead_page", expect.objectContaining({
      p_business_id: businessId, p_query: "customer", p_status: "booked", p_contact: "ready", p_limit: 50,
    }));
  });

  it("binds opaque cursors to the tenant, filters and stable database position", async () => {
    const position = { id: leadId, key: "2026-09-01T00:00:00.000001", missing: false };
    databaseMocks.rpc.mockResolvedValueOnce({ data: { leads: [], total: 225, nextCursor: position }, error: null });
    const first = await getLeadPage(businessId);
    await getLeadPage(businessId, { cursor: first.nextCursor });
    expect(databaseMocks.rpc).toHaveBeenLastCalledWith("get_lead_page", expect.objectContaining({
      p_after_id: leadId, p_after_key: position.key, p_after_null: false,
    }));
    await expect(getLeadPage(businessId, { cursor: first.nextCursor, status: "booked" })).rejects.toThrow("Cursor");
    await expect(getLeadPage("10000000-0000-4000-8000-000000000002", { cursor: first.nextCursor })).rejects.toThrow("Cursor");
    expect(databaseMocks.rpc).toHaveBeenCalledTimes(2);
  });

  it("requires authentication and refuses client-selected tenants or malformed cursors", async () => {
    expect((await GET(new Request("http://localhost/api/leads?business_id=foreign"))).status).toBe(400);
    expect((await GET(new Request("http://localhost/api/leads?cursor=garbage"))).status).toBe(400);
    databaseMocks.getUser.mockResolvedValue({ data: { user: null } });
    expect((await GET(new Request("http://localhost/api/leads"))).status).toBe(401);
    expect((await patch({ workflow_status: "booked" })).status).toBe(401);
    expect(databaseMocks.rpc).not.toHaveBeenCalled();
    expect(databaseMocks.update).not.toHaveBeenCalled();
  });

  it("saves only owner-managed fields scoped to both row and server-derived business", async () => {
    expect((await patch({ workflow_status: "booked", follow_up_note: "Synthetic" })).status).toBe(200);
    expect(databaseMocks.update).toHaveBeenCalledWith({ workflow_status: "booked", follow_up_note: "Synthetic" });
    expect(databaseMocks.eq).toHaveBeenCalledWith("id", leadId);
    expect(databaseMocks.eq).toHaveBeenCalledWith("business_id", businessId);
    expect((await patch({ workflow_status: "booked", phone: "forbidden" })).status).toBe(400);
    expect(databaseMocks.update).toHaveBeenCalledTimes(1);
  });

  it("does not report success for foreign rows or database failures", async () => {
    databaseMocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await patch({ follow_up_note: "Synthetic" })).status).toBe(404);
    databaseMocks.maybeSingle.mockResolvedValue({ data: null, error: { message: "private database detail" } });
    const failed = await patch({ follow_up_note: "Synthetic" });
    expect(failed.status).toBe(503);
    expect(JSON.stringify(await failed.json())).not.toContain("private database detail");
    databaseMocks.rpc.mockResolvedValue({ data: null, error: { message: "private" } });
    expect((await GET(new Request("http://localhost/api/leads"))).status).toBe(503);
  });
});

describe("enquiry input boundaries", () => {
  it("bounds server-side paging and rejects unknown filters", () => {
    expect(leadListSchema.parse({})).toMatchObject({ limit: 50, sort: "newest", status: "all" });
    expect(leadListSchema.parse({ limit: "100", query: "  customer  " }).query).toBe("customer");
    for (const input of [{ limit: 101 }, { limit: 0 }, { business_id: "foreign" }, { status: "active" }]) {
      expect(leadListSchema.safeParse(input).success).toBe(false);
    }
  });

  it("accepts only bounded owner-managed follow-up fields", () => {
    expect(leadUpdateSchema.parse({ workflow_status: "booked", follow_up_note: "Call Friday" }))
      .toEqual({ workflow_status: "booked", follow_up_note: "Call Friday" });
    for (const input of [{}, { phone: "changed" }, { business_id: "foreign" }, { workflow_status: "active" }, { follow_up_note: "x".repeat(2001) }]) {
      expect(leadUpdateSchema.safeParse(input).success).toBe(false);
    }
  });
});

describe("parseLeadFields", () => {
  it("extracts common fields regardless of exact field names", () => {
    const parsed = parseLeadFields([
      { name: "full_name", values: ["Rahul Sharma"] },
      { name: "phone_number", values: ["+91 98765 43210"] },
      { name: "email", values: ["Rahul@Example.COM"] },
      { name: "city", values: ["Jaipur"] },
    ]);
    expect(parsed.fullName).toBe("Rahul Sharma");
    expect(parsed.phone).toBe("+919876543210");
    expect(parsed.email).toBe("rahul@example.com");
    expect(parsed.city).toBe("Jaipur");
  });

  it("falls back to first + last name", () => {
    const parsed = parseLeadFields([
      { name: "first_name", values: ["Asha"] },
      { name: "last_name", values: ["Verma"] },
    ]);
    expect(parsed.fullName).toBe("Asha Verma");
  });

  it("keeps the raw normalized field map and handles empties", () => {
    const parsed = parseLeadFields([
      { name: "What is your budget?", values: ["₹2,00,000"] },
      { name: "", values: ["ignored"] },
    ]);
    expect(parsed.fields["what is your budget?"]).toBe("₹2,00,000");
    expect(parsed.fullName).toBeNull();
    expect(parsed.phone).toBeNull();
  });

  it("tolerates null/undefined input", () => {
    expect(parseLeadFields(null).fullName).toBeNull();
    expect(parseLeadFields(undefined).fields).toEqual({});
  });
});

describe("relativeAge", () => {
  const now = new Date("2026-08-12T12:00:00Z");
  it("formats compact ages", () => {
    expect(relativeAge("2026-08-12T11:59:40Z", now)).toBe("just now");
    expect(relativeAge("2026-08-12T11:30:00Z", now)).toBe("30m ago");
    expect(relativeAge("2026-08-12T09:00:00Z", now)).toBe("3h ago");
    expect(relativeAge("2026-08-10T12:00:00Z", now)).toBe("2d ago");
  });
  it("returns empty for missing/invalid", () => {
    expect(relativeAge(null, now)).toBe("");
    expect(relativeAge("not-a-date", now)).toBe("");
  });
});

describe("buildLeadDigest", () => {
  const now = new Date("2026-08-12T12:00:00Z");
  const businessName = "Solaride";

  it("summarizes recent leads with names, phones and ages", () => {
    const out = buildLeadDigest(
      [
        {
          fullName: "Rahul Sharma",
          phone: "+919876543210",
          city: "Jaipur",
          createdTime: "2026-08-12T10:00:00Z",
        },
        {
          fullName: "Asha Verma",
          phone: null,
          city: "Kota",
          createdTime: "2026-08-11T12:00:00Z",
        },
      ],
      { businessName, now, windowDays: 7 },
    );
    expect(out).toContain("Solaride: 2 new leads");
    expect(out).toContain("1. Rahul Sharma — +919876543210 — Jaipur (2h ago)");
    expect(out).toContain("2. Asha Verma — Kota (1d ago)");
    expect(out).toMatch(/go cold/i);
  });

  it("uses singular wording for a single lead", () => {
    const out = buildLeadDigest(
      [{ fullName: "Solo", phone: null, city: null, createdTime: "2026-08-12T11:00:00Z" }],
      { businessName, now },
    );
    expect(out).toContain("1 new lead in");
  });

  it("includes an email-only lead's contact details", () => {
    const out = buildLeadDigest([{ fullName: "Email contact", phone: null, email: "contact@example.com", city: null, createdTime: "2026-08-12T11:00:00Z" }], { businessName, now });
    expect(out).toContain("contact@example.com");
  });

  it("does not prescribe a budget increase from absent synced leads", () => {
    const out = buildLeadDigest([], { businessName, now });
    expect(out).toContain("Sync your lead forms");
    expect(out).not.toMatch(/budget|fresh creative/i);
  });

  it("excludes leads outside the window", () => {
    const out = buildLeadDigest(
      [{ fullName: "Old", phone: null, city: null, createdTime: "2026-07-01T12:00:00Z" }],
      { businessName, now, windowDays: 7 },
    );
    expect(out).toMatch(/no new leads/i);
  });

  it("caps the list and reports overflow", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      fullName: `Lead ${i}`,
      phone: null,
      city: null,
      createdTime: "2026-08-12T11:00:00Z",
    }));
    const out = buildLeadDigest(many, { businessName, now, maxList: 10 });
    expect(out).toContain("…and 2 more.");
  });
});
