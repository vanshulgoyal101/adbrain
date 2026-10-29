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
      const filters: [string, (value: unknown) => boolean][] = [];
      let deleting = false;
      const rows = () => visible().filter((row) => filters.every(([key, matches]) => matches(row[key])));
      const query = {
        select: () => query,
        delete: () => { deleting = true; return query; },
        eq: (key: string, value: unknown) => { filters.push([key, (field) => field === value]); return query; },
        in: (key: string, values: unknown[]) => { filters.push([key, (field) => values.includes(field)]); return query; },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => void) => {
          if (!deleting) return resolve({ count: rows().length, error: null });
          const removed = rows();
          db.leads = db.leads.filter((row) => !removed.includes(row));
          return resolve({ data: removed.map((row) => ({ id: row.id })), error: null });
        },
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
vi.mock("@/lib/observability/logger", () => ({ observeRoute: (_path: string, _method: string, handler: unknown) => handler, recordProductEvent: () => {} }));

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
      .toEqual({ status: 201, body: { id: "lead-1", enquiries: 1, customers: 0, booked: 0 } });
    expect(db.leads).toEqual([expect.objectContaining({
      business_id: "business", campaign_id: WHATSAPP, source: "whatsapp_manual",
      full_name: "Ravi Kumar", phone: "+91 98140 12345", follow_up_note: "Wants 50 kW for his factory",
      created_time: expect.any(String),
    })]);
    expect(db.leads[0]).not.toHaveProperty("meta_lead_id");
    expect(db.leads[0]).not.toHaveProperty("workflow_status");
  });

  it("counts a bare +1 with no details", async () => {
    await add(WHATSAPP);
    expect(await add(WHATSAPP, {})).toEqual({ status: 201, body: { id: "lead-2", enquiries: 2, customers: 0, booked: 0 } });
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

  // #798: one tap logs a chat that became a customer; Undo removes only that logged enquiry.
  it("logs a customer in one tap and undoes it, never deleting a Meta form enquiry", async () => {
    const { status, body } = await add(WHATSAPP, { customer: true });
    expect(status).toBe(201);
    expect(body).toMatchObject({ id: "lead-1", enquiries: 1, customers: 1, booked: 1 });
    expect(db.leads[0]).toMatchObject({ source: "whatsapp_manual", workflow_status: "customer", full_name: null, campaign_id: WHATSAPP });
    const { DELETE } = await import("@/app/api/campaigns/[id]/enquiries/route");
    const undo = (lead: string) => DELETE(new Request(`http://localhost/api/campaigns/${WHATSAPP}/enquiries?lead=${lead}`, { method: "DELETE" }), { params: Promise.resolve({ id: WHATSAPP }) });
    db.leads.push({ id: "40000000-0000-4000-8000-000000000009", business_id: "business", campaign_id: WHATSAPP, source: "meta_form", workflow_status: "customer" });
    // #1994: a booking from a form counts as booked, not as a customer.
    db.leads.push({ id: "40000000-0000-4000-8000-000000000008", business_id: "business", campaign_id: WHATSAPP, source: "meta_form", workflow_status: "booked" });
    expect((await undo("40000000-0000-4000-8000-000000000009")).status).toBe(404);
    expect((await undo("not-a-uuid")).status).toBe(400);
    db.leads[0].id = "40000000-0000-4000-8000-000000000001";
    const removed = await undo("40000000-0000-4000-8000-000000000001");
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ enquiries: 0, customers: 1, booked: 2 });
    expect(db.leads.map((row) => row.source)).toEqual(["meta_form", "meta_form"]);
    expect((await add(WHATSAPP, { customer: false })).status).toBe(400);
  });
});
