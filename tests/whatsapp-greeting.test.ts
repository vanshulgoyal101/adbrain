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

// #493: #157 had 7 people open WhatsApp and 1 send. The pre-typed message was 133 characters of
// mixed Hinglish naming two offers ("Mujhe Solaride ke Diwali offer: 10% off ... aur Free site survey
// ke baare mein jaankari chahiye."). Now: one short ask, one offer, the ad's own language.
describe("whatsappGreeting (#209, #493)", () => {
  it("creates three distinct ice breakers from Brand offers", () => {
    expect(whatsappGreeting(solaride, run21Offer, ["Mohali"], [], "ad", true).iceBreakers).toEqual([
      "What does Free site survey include?",
      "How much does Free site survey cost?",
      "How do I book Free site survey?",
    ]);
  });
  it("asks for one offer in the ad's language, a free offer first, naming the city when there is one", () => {
    expect(whatsappGreeting(solaride, run21Offer, ["Mohali"])).toEqual({
      autofill: "Hi! I'd like a free site survey in Mohali.",
      greeting: "Hi! Thanks for messaging Solaride. Send this message and we'll reply here.",
    });
  });

  it("leaves the city out when the campaign covers several, so nobody is sent the wrong one", () => {
    expect(whatsappGreeting(solaride, run21Offer, ["Chandigarh", "Panchkula", "Mohali"]).autofill)
      .toBe("Hi! I'd like a free site survey.");
    expect(whatsappGreeting(solaride, run21Offer).autofill).toBe("Hi! I'd like a free site survey.");
  });

  it("uses the offer after its label and keeps names capitalised", () => {
    expect(whatsappGreeting({ name: "Acme", offers: ["Diwali offer: 10% off", "EMI"] }, ["Easy EMI and 10% off."], ["Jaipur"]).autofill)
      .toBe("Hi! I'd like the 10% off in Jaipur.");
    expect(whatsappGreeting({ name: "Acme", offers: ["PM Surya Ghar subsidy help"] }, ["PM Surya Ghar subsidy help from Acme"]).autofill)
      .toBe("Hi! I'd like the PM Surya Ghar subsidy help.");
  });

  it("names only the business when the ads cite no Brand offer", () => {
    expect(whatsappGreeting(solaride, ["Clean energy for your home."]).autofill).toBe("Hi! I'd like to know more about Solaride.");
    expect(whatsappGreeting({ name: "Acme", offers: null }, [], ["Jaipur"]).autofill).toBe("Hi! I'd like to know more about Acme in Jaipur.");
  });

  it("writes Hindi for a Devanagari ad and Punjabi for a Gurmukhi ad", () => {
    expect(whatsappGreeting(solaride, ["घर की छत पर सोलर, Free site survey के साथ"], ["Mohali"])).toEqual({
      autofill: "नमस्ते, मुझे Mohali में Free site survey के बारे में जानकारी चाहिए।",
      greeting: "नमस्ते! Solaride को मैसेज करने के लिए धन्यवाद। यह मैसेज भेजिए, हम यहीं जवाब देंगे।",
    });
    expect(whatsappGreeting(solaride, ["ਘਰ ਦੀ ਛੱਤ 'ਤੇ ਸੋਲਰ"]).autofill).toBe("ਸਤ ਸ੍ਰੀ ਅਕਾਲ, ਮੈਨੂੰ Solaride ਬਾਰੇ ਜਾਣਕਾਰੀ ਚਾਹੀਦੀ ਹੈ।");
  });

  it("asks in Hinglish when the ads were made in Hinglish (their stored language)", () => {
    const hinglish = ["Bijli ka bill aadha karo", "Free site survey book karein"];
    expect(whatsappGreeting(solaride, hinglish, ["Mohali"], ['Hinglish — Hindi written in Roman/Latin script'])).toEqual({
      autofill: "Namaste, mujhe Mohali mein Free site survey ke baare mein jaankari chahiye.",
      greeting: "Namaste! Solaride ko message karne ke liye dhanyavaad. Yeh message bhejiye, hum yahin jawab denge.",
    });
    expect(whatsappGreeting(solaride, hinglish, [], ["English"]).autofill).toBe("Hi! I'd like a Free site survey.");
    expect(whatsappGreeting(solaride, ["छत पर सोलर"], [], ["English"]).autofill).toBe("Hi! I'd like to know more about Solaride.");
  });

  it("matches offers as whole words and ignores an empty label (QA, PR #218)", () => {
    const brand = { name: "Acme", offers: ["EMI", "Diwali offer:", ":"] };
    expect(whatsappGreeting(brand, ["Premium panels."]).autofill).toBe("Hi! I'd like to know more about Acme.");
    expect(whatsappGreeting(brand, ["Premium panels with a Diwali offer."]).autofill).toBe("Hi! I'd like the Diwali offer.");
  });

  it("stays within Meta's 300 characters", () => {
    const long = "x".repeat(400);
    const result = whatsappGreeting({ name: long, offers: [] }, []);
    expect(result.autofill.length).toBeLessThanOrEqual(300);
    expect(result.greeting.length).toBeLessThanOrEqual(300);
  });

  // #493 (owner, Oct 25): the language is a per-campaign choice; default is the ad's own.
  it("uses the campaign's chosen language over the ad's", () => {
    expect(whatsappGreeting(solaride, ["घर की छत पर सोलर, Free site survey के साथ"], ["Mohali"], [], "en").autofill).toBe("Hi! I'd like a Free site survey in Mohali.");
    expect(whatsappGreeting(solaride, run21Offer, [], ["English"], "hinglish").autofill).toBe("Namaste, mujhe free site survey ke baare mein jaankari chahiye.");
    expect(whatsappGreeting(solaride, run21Offer, [], [], "ad").autofill).toBe("Hi! I'd like a free site survey.");
  });
});
