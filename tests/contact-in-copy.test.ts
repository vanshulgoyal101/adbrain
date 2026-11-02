import { describe, expect, it } from "vitest";
import { contactsInCopy } from "@/lib/creative/contact-in-copy";

// #1822 (Reviewer, #1816): a pasted bio's third-party number or link must not ship in the ad's words.
const own = { website: "https://www.solaride.in/", phone: "+91 98290 12345" };

describe("contactsInCopy (#1822)", () => {
  it("finds third-party links, domains, wa.me and phone numbers", () => {
    expect(contactsInCopy("Book at otherclinic.in or https://www.example.com/book today", own)).toEqual(["otherclinic.in", "https://www.example.com/book"]);
    expect(contactsInCopy("Message wa.me/919800000000 now", own)).toEqual(["wa.me/919800000000"]);
    expect(contactsInCopy("Call 98765 43210 for a quote", own)).toEqual(["98765 43210"]);
    expect(contactsInCopy("Toll free 1800-123-4567", own)).toEqual(["1800-123-4567"]);
  });

  it("allows the business's own website and phone", () => {
    expect(contactsInCopy("Visit solaride.in or www.solaride.in/subsidy, call 98290 12345", own)).toEqual([]);
    expect(contactsInCopy("Call +919829012345", own)).toEqual([]);
  });

  it("leaves prices, years, sizes and abbreviations alone", () => {
    expect(contactsInCopy("₹30,000 subsidy for 3 kW in 2026. Rs.500 off, e.g. 1-2 days, 10% off, Ph.D team, 25 km", own)).toEqual([]);
  });

  it("with no website or phone saved, any link or number is refused", () => {
    expect(contactsInCopy("Call 98290 12345 or visit solaride.in", {})).toEqual(["solaride.in", "98290 12345"]);
  });
});
