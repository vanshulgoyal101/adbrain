import { describe, expect, it } from "vitest";
import { firstReplyText, formatReplyTime, medianReplyMinutes, replyLanguage, whatsappDigits, whatsappReplyLink } from "@/lib/leads/first-reply";

describe("first reply to an enquiry (#1049)", () => {
  const base = { leadName: "Ravi Kumar", businessName: "Solaride", offer: "Free solar site survey" };

  it("writes the first reply in English, Hindi and Hinglish with the name, business and offer", () => {
    expect(firstReplyText({ ...base, language: "en" })).toBe("Hi Ravi, this is Solaride. Thanks for your enquiry about the free solar site survey. When is a good time to talk?");
    expect(firstReplyText({ ...base, language: "hi" })).toBe("नमस्ते Ravi जी, Solaride की ओर से धन्यवाद! आपने free solar site survey के बारे में पूछा था। आपसे बात करने का सही समय कब है?");
    expect(firstReplyText({ ...base, language: "hinglish" })).toBe("Namaste Ravi ji, Solaride ki taraf se dhanyavaad! Aapne free solar site survey ke baare mein poocha tha. Aapse baat karne ka sahi time kab hai?");
  });

  it("reads well without a name or an offer, and keeps an offer's words after its label", () => {
    expect(firstReplyText({ businessName: "Solaride", language: "en" })).toBe("Hi, this is Solaride. Thanks for your enquiry. When is a good time to talk?");
    expect(firstReplyText({ businessName: "Solaride", language: "hi" })).toBe("नमस्ते, Solaride की ओर से धन्यवाद! आपने हमसे पूछा था। आपसे बात करने का सही समय कब है?");
    expect(firstReplyText({ businessName: "Solaride", offer: "Diwali offer: 10% off rooftop solar", language: "en" })).toContain("about the 10% off rooftop solar.");
    expect(firstReplyText({ businessName: "Solaride", offer: "PM Surya Ghar subsidy help", language: "en" })).toContain("about the PM Surya Ghar subsidy help.");
  });

  it("picks the reply language from the business's first language", () => {
    expect(replyLanguage(["Hindi", "English"])).toBe("hi");
    expect(replyLanguage(["Hinglish"])).toBe("hinglish");
    expect(replyLanguage(["English", "Hindi"])).toBe("en");
    expect(replyLanguage(["Punjabi"])).toBe("en");
    expect(replyLanguage(null)).toBe("en");
  });

  it("turns the lead's phone into a WhatsApp number, or none", () => {
    expect(whatsappDigits("+91 98000 00009")).toBe("919800000009");
    expect(whatsappDigits("9800000009")).toBe("919800000009");
    expect(whatsappDigits("09800000009")).toBe("919800000009");
    expect(whatsappDigits("919800000009")).toBe("919800000009");
    expect(whatsappDigits("+1 512 555 0199")).toBe("15125550199");
    expect(whatsappDigits("12345")).toBeNull();
    expect(whatsappDigits(null)).toBeNull();
    expect(whatsappReplyLink("9800000009", "Hi Ravi & co?")).toBe("https://wa.me/919800000009?text=Hi%20Ravi%20%26%20co%3F");
  });

  it("takes the median minutes from enquiry to first reply and words it plainly", () => {
    const row = (created: string, contacted: string | null) => ({ created_time: created, created_at: created, first_contacted_at: contacted });
    expect(medianReplyMinutes([row("2026-10-27T10:00:00Z", "2026-10-27T10:10:00Z"), row("2026-10-27T10:00:00Z", "2026-10-27T10:30:00Z"), row("2026-10-27T10:00:00Z", null)])).toBe(20);
    expect(medianReplyMinutes([row("2026-10-27T10:00:00Z", "2026-10-27T10:05:00Z"), row("2026-10-27T10:00:00Z", "2026-10-27T11:00:00Z"), row("2026-10-27T10:00:00Z", "2026-10-27T10:20:00Z")])).toBe(20);
    expect(medianReplyMinutes([row("2026-10-27T10:00:00Z", "2026-10-27T09:00:00Z")])).toBeNull();
    expect([0.4, 12.4, 185, 3 * 24 * 60].map(formatReplyTime)).toEqual(["under a minute", "12 min", "3 h 5 min", "3 days"]);
  });
});
