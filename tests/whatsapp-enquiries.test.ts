import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  user: { id: "owner" } as { id: string } | null,
  campaigns: [] as Record<string, unknown>[],
  leads: [] as Record<string, unknown>[],
  insertError: null as unknown,
  limited: false,
}));

// RLS stand-in: the owner sees only their own business's campaigns and leads.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: db.user } }) },
    from: (table: string) => {
      const visible = () => (table === "campaigns" ? db.campaigns : db.leads).filter((row) => row.business_id === "business");
      const filters: [string, unknown][] = [];
      const rows = () => visible().filter((row) => filters.every(([key, value]) => row[key] === value));
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => void) => resolve({ count: rows().length, error: null }),
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              if (db.insertError) return { data: null, error: db.insertError };
              const saved = { id: `lead-${db.leads.length + 1}`, ...row };
              db.leads.push(saved);
              return { data: { id: saved.id }, error: null };
            },
          }),
        }),
      };
      return query;
    },
  }),
}));
vi.mock("@/lib/security/rate-limit", () => ({
  rateLimitResponse: async () => (db.limited ? Response.json({ error: "Too many requests." }, { status: 429 }) : null),
}));
vi.mock("@/lib/observability/logger", () => ({ observeRoute: (_path: string, _method: string, handler: unknown) => handler }));

const WHATSAPP = "30000000-0000-4000-8000-000000000001";
const FORM = "30000000-0000-4000-8000-000000000002";
const OTHER = "30000000-0000-4000-8000-000000000003";

async function add(id: string, body: unknown = {}) {
  const { POST } = await import("@/app/api/campaigns/[id]/enquiries/route");
  const response = await POST(new Request(`http://localhost/api/campaigns/${id}/enquiries`, { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) });
  return { status: response.status, body: await response.json() as { enquiries?: number; error?: string } };
}

beforeEach(() => {
  db.user = { id: "owner" };
  db.insertError = null;
  db.limited = false;
  db.leads = [];
  db.campaigns = [
    { id: WHATSAPP, business_id: "business", destination: "whatsapp", objective: "engagement", raw: {} },
    { id: FORM, business_id: "business", destination: "instant_form", objective: "leads", raw: {} },
    { id: OTHER, business_id: "someone-else", destination: "whatsapp", objective: "engagement", raw: {} },
  ];
});

describe("POST /api/campaigns/[id]/enquiries (#335)", () => {
  it("saves a real WhatsApp enquiry to Enquiries with its campaign and returns the campaign's count", async () => {
    expect(await add(WHATSAPP, { name: " Ravi Kumar ", phone: "+91 98140 12345", note: "Wants 50 kW for his factory" }))
      .toEqual({ status: 201, body: { enquiries: 1 } });
    expect(db.leads).toEqual([expect.objectContaining({
      business_id: "business", campaign_id: WHATSAPP, source: "whatsapp_manual",
      full_name: "Ravi Kumar", phone: "+91 98140 12345", follow_up_note: "Wants 50 kW for his factory",
      created_time: expect.any(String),
    })]);
    expect(db.leads[0]).not.toHaveProperty("meta_lead_id");
  });

  it("counts a bare +1 with no details", async () => {
    await add(WHATSAPP);
    expect(await add(WHATSAPP, {})).toEqual({ status: 201, body: { enquiries: 2 } });
    expect(db.leads[1]).toMatchObject({ full_name: null, phone: null, follow_up_note: "" });
  });

  it("refuses another owner's campaign, a form campaign, bad input and signed-out requests without saving", async () => {
    expect((await add(OTHER)).status).toBe(404);
    expect(await add(FORM)).toEqual({ status: 400, body: { error: "Real enquiries can be logged on WhatsApp campaigns only." } });
    expect((await add(WHATSAPP, { name: "x".repeat(201) })).status).toBe(400);
    expect((await add(WHATSAPP, { email: "not allowed" })).status).toBe(400);
    expect((await add("not-a-uuid")).status).toBe(400);
    db.user = null;
    expect((await add(WHATSAPP)).status).toBe(401);
    expect(db.leads).toEqual([]);
  });

  it("is rate limited and reports a failed save plainly", async () => {
    db.limited = true;
    expect((await add(WHATSAPP)).status).toBe(429);
    db.limited = false;
    db.insertError = { message: "column source does not exist" };
    expect(await add(WHATSAPP)).toEqual({ status: 503, body: { error: "The enquiry could not be saved. Try again." } });
  });
});
