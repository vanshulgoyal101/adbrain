import { beforeEach, describe, expect, it, vi } from "vitest";

const BUSINESS = "10000000-0000-4000-8000-000000000001";
const CAMPAIGN = "30000000-0000-4000-8000-000000000001";
const LEAD = "20000000-0000-4000-8000-000000000001";

const db = vi.hoisted(() => ({ campaigns: [] as Record<string, unknown>[], leads: [] as Record<string, unknown>[], events: [] as { name: string; businessId?: string; attributes?: Record<string, unknown> }[] }));

// In-memory leads/campaigns: enough of the query builder for the two routes that mark a customer.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
    from: (table: string) => {
      const rows = () => (table === "campaigns" ? db.campaigns : db.leads).filter((row) => filters.every(([key, value]) => row[key] === value || (Array.isArray(value) && value.includes(row[key]))));
      const filters: [string, unknown][] = [];
      let change: Record<string, unknown> | null = null;
      let deleting = false;
      const query = {
        select: () => query,
        update: (fields: Record<string, unknown>) => { change = fields; return query; },
        delete: () => { deleting = true; return query; },
        eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
        in: (key: string, values: unknown[]) => { filters.push([key, values]); return query; },
        is: (key: string, value: unknown) => { filters.push([key, value]); return query; },
        maybeSingle: async () => {
          const found = rows()[0] ?? null;
          if (found && change) Object.assign(found, change);
          return { data: found ? { ...found } : null, error: null };
        },
        then: (resolve: (value: unknown) => void) => {
          const found = rows();
          if (change) found.forEach((row) => Object.assign(row, change));
          if (deleting) db.leads = db.leads.filter((row) => !found.includes(row));
          return resolve({ data: found.map((row) => ({ ...row })), count: found.length, error: null });
        },
        insert: (row: Record<string, unknown>) => ({
          select: () => ({ single: async () => { const saved = { id: `40000000-0000-4000-8000-00000000000${db.leads.length + 1}`, workflow_status: "new", ...row }; db.leads.push(saved); return { data: { id: saved.id }, error: null }; } }),
        }),
      };
      return query;
    },
  }),
}));
vi.mock("@/lib/supabase/queries", () => ({ getPrimaryBusiness: async () => ({ id: BUSINESS }) }));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: async () => null }));
vi.mock("@/lib/observability/logger", () => ({
  observeRoute: (_path: string, _method: string, handler: unknown) => handler,
  recordProductEvent: (event: (typeof db.events)[number]) => db.events.push(event),
}));
import { PATCH } from "@/app/api/leads/[id]/route";
import { DELETE, POST } from "@/app/api/campaigns/[id]/enquiries/route";

const patch = (body: unknown) => PATCH(new Request(`http://localhost/api/leads/${LEAD}`, { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id: LEAD }) });
const marks = () => db.events.filter((event) => event.name === "lead.customer_marked").map((event) => ({ businessId: event.businessId, ...event.attributes }));

beforeEach(() => {
  db.events = [];
  db.campaigns = [{ id: CAMPAIGN, business_id: BUSINESS, destination: "whatsapp", objective: "engagement", raw: {} }];
  db.leads = [{ id: LEAD, business_id: BUSINESS, campaign_id: CAMPAIGN, source: "meta", workflow_status: "contacted" }];
});

describe("lead.customer_marked on save (#2026)", () => {
  it("inbox: mark then undo saves two rows, the second undone", async () => {
    expect((await patch({ workflow_status: "customer" })).status).toBe(200);
    expect((await patch({ workflow_status: "contacted" })).status).toBe(200);
    expect(marks()).toEqual([
      { businessId: BUSINESS, entityType: "lead", source: "inbox", campaignId: CAMPAIGN, undone: false },
      { businessId: BUSINESS, entityType: "lead", source: "inbox", campaignId: CAMPAIGN, undone: true },
    ]);
  });

  it("inbox: a change that doesn't touch 'customer', a re-save as customer, or a note saves no row", async () => {
    await patch({ workflow_status: "booked" });
    await patch({ follow_up_note: "Called back" });
    db.leads[0].workflow_status = "customer";
    await patch({ workflow_status: "customer" });
    expect(marks()).toEqual([]);
  });

  it("WhatsApp: +1 customer then Undo saves two rows; logging or removing a plain enquiry saves none", async () => {
    const context = { params: Promise.resolve({ id: CAMPAIGN }) };
    const added = await POST(new Request(`http://localhost/api/campaigns/${CAMPAIGN}/enquiries`, { method: "POST", body: JSON.stringify({ customer: true }) }), context);
    const { id } = await added.json() as { id: string };
    expect((await DELETE(new Request(`http://localhost/api/campaigns/${CAMPAIGN}/enquiries?lead=${id}`, { method: "DELETE" }), context)).status).toBe(200);
    const plain = await (await POST(new Request(`http://localhost/api/campaigns/${CAMPAIGN}/enquiries`, { method: "POST", body: JSON.stringify({ name: "Asha" }) }), context)).json() as { id: string };
    await DELETE(new Request(`http://localhost/api/campaigns/${CAMPAIGN}/enquiries?lead=${plain.id}`, { method: "DELETE" }), context);
    expect(marks()).toEqual([
      { businessId: BUSINESS, entityType: "lead", source: "whatsapp", campaignId: CAMPAIGN, undone: false },
      { businessId: BUSINESS, entityType: "lead", source: "whatsapp", campaignId: CAMPAIGN, undone: true },
    ]);
  });

  it("the event schema keeps the attributes (it drops unknown keys)", async () => {
    const { sanitizeProductEvent } = await import("@/lib/observability/events");
    const event = sanitizeProductEvent({ version: 1, eventId: LEAD, requestId: LEAD, occurredAt: new Date().toISOString(), kind: "action", name: "lead.customer_marked", outcome: "success", userId: null, businessId: BUSINESS, attributes: { source: "whatsapp", campaignId: CAMPAIGN, undone: true } });
    expect(event?.attributes).toEqual({ source: "whatsapp", campaignId: CAMPAIGN, undone: true });
  });
});
