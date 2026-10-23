import { describe, expect, it } from "vitest";
import { whatsappGreeting } from "@/lib/campaign/whatsapp-greeting";

// Solaride's Brand offers and Create run 21's saved Special offer ad (8df360e7, Oct 23).
const solaride = {
  name: "Solaride",
  offers: ["Free site survey", "PM Surya Ghar subsidy help", "Diwali offer: 10% off rooftop solar installation"],
};
const run21Offer = [
  "Your Roof, Diwali Offer: 10% Off",
  "Celebrate Diwali with 10% off rooftop solar installation for homes in Chandigarh, Panchkula and Mohali.\nStart with a free site survey, and Solaride helps with PM Surya Ghar subsidy paperwork.\nMessage Solaride on WhatsApp to book a free site survey.",
];

describe("whatsappGreeting (#209)", () => {
  it("asks in Hinglish about the Brand offers the ads mention, the numbered offer first", () => {
    expect(whatsappGreeting(solaride, run21Offer)).toEqual({
      autofill: "Namaste! Mujhe Solaride ke Diwali offer: 10% off rooftop solar installation aur Free site survey ke baare mein jaankari chahiye.",
      greeting: "Namaste! Solaride mein aapka swagat hai. Apna sawaal yahan likhiye.",
    });
  });

  it("names only the business when the ads cite no Brand offer", () => {
    expect(whatsappGreeting(solaride, ["Clean energy for your home."]).autofill)
      .toBe("Namaste! Mujhe Solaride ke baare mein jaankari chahiye.");
    expect(whatsappGreeting({ name: "Acme", offers: null }, []).autofill).toBe("Namaste! Mujhe Acme ke baare mein jaankari chahiye.");
  });

  it("matches offers as whole words and handles an offer that ends in a colon (QA, PR #218)", () => {
    const brand = { name: "Acme", offers: ["EMI", "Diwali offer:", "10% off"] };
    // "EMI" is inside "Premium"; "Diwali offer:" has nothing after its colon.
    expect(whatsappGreeting(brand, ["Premium panels with a Diwali offer."]).autofill)
      .toBe("Namaste! Mujhe Acme ke Diwali offer ke baare mein jaankari chahiye.");
    expect(whatsappGreeting(brand, ["Easy EMI and 10% off."]).autofill)
      .toBe("Namaste! Mujhe Acme ke 10% off aur EMI ke baare mein jaankari chahiye.");
    expect(whatsappGreeting({ name: "Acme", offers: [":"] }, ["Any copy: here"]).autofill)
      .toBe("Namaste! Mujhe Acme ke baare mein jaankari chahiye.");
  });
});
