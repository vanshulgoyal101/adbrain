import { describe, expect, it } from "vitest";
import { suggestedQuestions } from "@/lib/campaign/whatsapp-questions";

describe("suggestedQuestions (#905, #1114)", () => {
  it("asks up to two offers as a customer would, then one generic question", () => {
    const offers = ["Free site survey", "PM Surya Ghar subsidy help", "Diwali offer: 10% off rooftop solar installation"];
    expect(suggestedQuestions({ offers })).toEqual(["Can I book a free site survey?", "Can I get PM Surya Ghar subsidy help?", "What's the price?"]);
    expect(suggestedQuestions({ offers }, "hinglish")).toEqual(["Free site survey book ho sakta hai?", "PM Surya Ghar subsidy help kaise milega?", "Price kya hai?"]);
    expect(suggestedQuestions({ offers }, "hi")).toEqual(["Free site survey बुक हो सकता है?", "PM Surya Ghar subsidy help कैसे मिलेगा?", "कीमत क्या है?"]);
    expect(suggestedQuestions({ offers }, "pa")).toEqual(["Free site survey ਬੁੱਕ ਹੋ ਸਕਦਾ ਹੈ?", "PM Surya Ghar subsidy help ਕਿਵੇਂ ਮਿਲੇਗਾ?", "ਕੀਮਤ ਕੀ ਹੈ?"]);
  });

  it("keeps the part after an offer's label when the question is too long, else the offer's own words, never cutting a claim", () => {
    expect(suggestedQuestions({ offers: ["Diwali offer: 10% off solar"] })[0]).toBe("Can I get 10% off solar?");
    expect(suggestedQuestions({ offers: ["Diwali offer: 10% off rooftop solar installation"] })[0]).toBe("10% off rooftop solar installation");
    const long = "Complimentary comprehensive dental check-up with digital X-ray";
    expect(suggestedQuestions({ offers: [long] })).toEqual(["What's the price?", "Call me back"]);
    expect(suggestedQuestions({ offers: [long, "Free whitening trial"] })[0]).toBe("Can I book a free whitening trial?");
    // "Can I get check-up and cleaning for ₹499?" is 41 characters: the offer goes as the owner wrote it.
    expect(suggestedQuestions({ offers: ["Check-up and cleaning for ₹499"] })[0]).toBe("Check-up and cleaning for ₹499");
    expect(suggestedQuestions({ offers: ["Check-up for ₹499"] })[0]).toBe("Can I get check-up for ₹499?");
  });

  it("books a free offer and never asks what it costs", () => {
    for (const language of ["en", "hi", "hinglish", "pa"] as const) {
      const [first] = suggestedQuestions({ offers: ["Free demo class"] }, language);
      expect(first).toMatch(/book|बुक|ਬੁੱਕ/i);
      expect(first).not.toMatch(/cost|price|kitna|कितन|कीमत|ਕੀਮਤ/i);
    }
  });

  it("skips offers with a link or phone number, and works with no offers", () => {
    expect(suggestedQuestions({ offers: ["Call +91 98140 00000 for a free visit"] })).toEqual(["What's the price?", "Call me back"]);
    expect(suggestedQuestions({ offers: null }, "hi")).toEqual(["कीमत क्या है?", "मुझे कॉल करें"]);
  });

  it("returns at most 3 distinct questions of up to 40 characters", () => {
    for (const language of ["en", "hi", "hinglish", "pa"] as const) {
      const questions = suggestedQuestions({ offers: ["Free site survey.", "Free site survey", "Free site survey!"] }, language);
      expect(new Set(questions).size).toBe(questions.length);
      expect(questions.length).toBeLessThanOrEqual(3);
      for (const question of questions) expect([...question].length).toBeLessThanOrEqual(40);
    }
  });
});
