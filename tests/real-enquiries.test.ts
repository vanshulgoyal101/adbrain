import { describe, expect, it } from "vitest";
import { attachRealEnquiries, bookedLabel, costPerCustomer, costPerRealEnquiry } from "@/lib/campaign/real-enquiries";
import type { CampaignResult } from "@/lib/types";

const result = (spend: number) => ({ id: "r", campaign_id: "c", spend, impressions: 3, clicks: 0, leads: 0, cpl: null, fetched_at: "2026-10-24T00:00:00Z" }) as unknown as CampaignResult;

describe("real WhatsApp enquiries on campaign results (#335)", () => {
  it("adds each campaign's logged enquiries to its latest result, and zero to the rest", () => {
    const results = { a: result(140), b: result(30) };
    const rows = [{ campaign_id: "a" }, { campaign_id: "a" }, { campaign_id: "x" }, { campaign_id: null }];
    expect(attachRealEnquiries(results, rows)).toEqual({ a: { ...results.a, real_enquiries: 2, customers: 0, booked: 0 }, b: { ...results.b, real_enquiries: 0, customers: 0, booked: 0 } });
    expect(results.a).not.toHaveProperty("real_enquiries");
  });

  it("divides spend by real enquiries, and has no cost before the first one", () => {
    expect(costPerRealEnquiry(140, 2)).toBe(70);
    expect(costPerRealEnquiry(1.37, 1)).toBe(1.37);
    expect(costPerRealEnquiry(140, 0)).toBeNull();
    expect(costPerRealEnquiry(0, 3)).toBe(0);
  });

  // #798: an enquiry from any source that the owner marked "Became a customer" counts toward ₹ per customer.
  it("counts customers from any source, and logged enquiries only from WhatsApp chats", () => {
    const results = { a: result(900), b: result(30) };
    const rows = [
      { campaign_id: "a", source: "whatsapp_manual", workflow_status: "new" },
      { campaign_id: "a", source: "whatsapp_manual", workflow_status: "customer" },
      { campaign_id: "a", source: "meta_form", workflow_status: "customer" },
      { campaign_id: "b", source: "meta_form", workflow_status: "booked" },
    ];
    expect(attachRealEnquiries(results, rows)).toEqual({
      a: { ...results.a, real_enquiries: 2, customers: 2, booked: 2 },
      b: { ...results.b, real_enquiries: 0, customers: 0, booked: 1 },
    });
  });

  it("divides spend by customers, and has no cost before the first one", () => {
    expect(costPerCustomer(900, 2)).toBe(450);
    expect(costPerCustomer(900, 0)).toBeNull();
  });

  // #1994: a booking is the step before a customer; status is one value, so a customer counts as booked too.
  it("counts Booked or Customer enquiries as booked, from any source", () => {
    const results = { a: result(900), b: result(30) };
    const rows = [
      { campaign_id: "a", source: "meta_form", workflow_status: "booked" },
      { campaign_id: "a", source: "meta_form", workflow_status: "customer" },
      { campaign_id: "a", source: "whatsapp_manual", workflow_status: "contacted" },
      { campaign_id: "b", source: "meta_form", workflow_status: "new" },
    ];
    const out = attachRealEnquiries(results, rows);
    expect([out.a.booked, out.a.customers, out.b.booked]).toEqual([2, 1, 0]);
  });

  it("names a booking by the business's segment, in English and Hindi", () => {
    expect(bookedLabel("Interior designer", 2)).toBe("consultations booked");
    expect(bookedLabel("Interior designer", 1)).toBe("consultation booked");
    expect(bookedLabel("Rooftop solar", 3)).toBe("site visits booked");
    expect(bookedLabel("IELTS coaching", 1)).toBe("demo class booked");
    expect(bookedLabel("Dentist", 2)).toBe("booked");
    expect(bookedLabel(null, 1)).toBe("booked");
    expect(["interiors", "solar", "ielts", "dentist"].map((vertical) => bookedLabel(vertical, 2, "hi"))).toEqual(["कंसल्टेशन बुक हुए", "साइट विज़िट बुक हुईं", "डेमो क्लास बुक हुईं", "बुक हुए"]);
  });
});
