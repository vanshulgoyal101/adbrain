import { describe, expect, it } from "vitest";
import { displayPhone, leadAlertParams, leadAnswers, type AlertLead } from "@/lib/alerts/lead-alerts";

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
