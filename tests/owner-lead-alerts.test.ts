import { describe, expect, it, vi } from "vitest";
import { displayPhone, leadAlertParams, leadAnswers, sendNewLeadAlerts, type AlertLead } from "@/lib/alerts/lead-alerts";

const lead: AlertLead = {
  id: "row-1", meta_lead_id: "100000000000001", full_name: "Ravi Kumar", phone: "+919800000009",
  field_data: { full_name: "Ravi Kumar", phone_number: "+919800000009", email: "r@example.com", "what_is_your_monthly_bill?": "₹3,000\nroughly", city: "Mohali" },
  form_name: "Solar form", campaignName: "Rooftop Mohali",
};

describe("#701: the lead alert's template parameters", () => {
  it("fills business, name, tap-to-call phone, one-line answers and the ad", () => {
    expect(leadAlertParams("Solaride", lead, "en")).toEqual([
      "Solaride", "Ravi Kumar", "+91 98000 00009", "What is your monthly bill: ₹3,000 roughly · City: Mohali", "Rooftop Mohali",
    ]);
  });

  it("never sends an empty value (Meta rejects it): missing fields say so in the owner's language", () => {
    const bare: AlertLead = { ...lead, full_name: null, phone: null, field_data: {}, campaignName: null, form_name: null };
    expect(leadAlertParams("", bare, "hi")).toEqual(["AdBrain", "नहीं दिया", "नहीं दिया", "नहीं दिया", "नहीं दिया"]);
    expect(leadAlertParams("Solaride", { ...bare, form_name: "Solar form" }, "en")[4]).toBe("Solar form");
  });

  it("leaves contact fields out of the answers and keeps other numbers as typed", () => {
    expect(leadAnswers({ first_name: "A", last_name: "B", mobile_number: "1", whatsapp_number: "2", budget: "₹1 lakh", company_name: "Acme", best_time_to_contact: "Evening" })).toEqual([
      { question: "Budget", answer: "₹1 lakh" }, { question: "Company name", answer: "Acme" }, { question: "Best time to contact", answer: "Evening" },
    ]);
    expect(leadAnswers(null)).toEqual([]);
    expect(leadAnswers(["x"])).toEqual([]);
    expect(displayPhone("+14155550100")).toBe("+14155550100");
    expect(displayPhone("919800000009")).toBe("+91 98000 00009");
  });

  it("cuts long answers to 300 characters on one line", () => {
    const long = leadAlertParams("S", { ...lead, field_data: { notes: "word ".repeat(200) } }, "en")[3];
    expect([...long].length).toBeLessThanOrEqual(300);
    expect(long).not.toMatch(/[\n\t]/);
  });
});

describe("#701: which leads get an alert", () => {
  it("reads the newest leads first (a busy day can't hold back fresh ones) and alerts them oldest first", async () => {
    const calls: { table: string; op: string; args: unknown[] }[] = [];
    const newestFirst = [3, 2, 1].map((n) => ({ id: `row-${n}`, meta_lead_id: `lead-${n}`, full_name: null, phone: null, field_data: {}, form_name: "Form", campaign_id: null }));
    const data: Record<string, unknown> = { owner_alert_prefs: { lead_alerts: true }, leads: newestFirst, owner_alert_sends: [{ dedupe_key: "lead-2" }], businesses: { name: "S" } };
    const db = {
      from: (table: string) => {
        const query: Record<string, unknown> = {
          then: (resolve: (value: unknown) => unknown) => resolve({ data: data[table], error: null }),
          maybeSingle: async () => ({ data: data[table], error: null }),
        };
        for (const op of ["select", "eq", "not", "is", "gte", "order", "limit", "neq", "in"]) query[op] = (...args: unknown[]) => { calls.push({ table, op, args }); return query; };
        return query;
      },
    };
    const keys: string[] = [];
    const store = { claim: vi.fn(async ({ key }: { key: string }) => { keys.push(key); return { claimed: false as const, reason: "duplicate" as const }; }), settle: vi.fn() };
    const config = { phoneNumberId: "1", token: "t", templates: { lead: "adbrain_lead_alert", daily: "adbrain_daily_results" } };
    expect(await sendNewLeadAlerts({ db: db as never, store, config, now: new Date("2026-10-27T12:00:00Z") }, "b1")).toEqual({ sent: 0, skipped: { duplicate: 2 } });
    expect(calls.find((c) => c.table === "leads" && c.op === "order")?.args).toEqual(["created_time", { ascending: false }]);
    expect(calls.find((c) => c.table === "leads" && c.op === "gte")?.args).toEqual(["created_time", "2026-10-26T12:00:00.000Z"]);
    expect(keys).toEqual(["lead-1", "lead-3"]);

    // #1149: a Meta test lead is not an enquiry and never costs an alert.
    keys.length = 0;
    newestFirst[0].full_name = "<test lead: dummy data for full_name>" as never;
    expect(await sendNewLeadAlerts({ db: db as never, store, config, now: new Date("2026-10-27T12:00:00Z") }, "b1")).toEqual({ sent: 0, skipped: { duplicate: 1 } });
    expect(keys).toEqual(["lead-1"]);
  });
});
