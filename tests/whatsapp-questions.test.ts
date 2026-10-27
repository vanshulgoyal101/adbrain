import { describe, expect, it } from "vitest";
import { suggestedQuestions } from "@/lib/campaign/whatsapp-questions";

describe("suggestedQuestions (#905)", () => {
  it("keeps the part after an offer's label when the whole offer is too long, never cutting a claim mid-word", () => {
    expect(suggestedQuestions({ offers: ["Diwali offer: 10% off rooftop solar installation"] })[0]).toBe("10% off rooftop solar installation");
    const long = "Complimentary comprehensive dental check-up with digital X-ray";
    expect(suggestedQuestions({ offers: [long] })).toEqual(["What's the price?", "Call me back"]);
    expect(suggestedQuestions({ offers: [long, "Free whitening trial"] })[0]).toBe("Free whitening trial");
  });

  it("skips offers with a link or phone number, and works with no offers", () => {
    expect(suggestedQuestions({ offers: ["Call +91 98140 00000 for a free visit"] })).toEqual(["What's the price?", "Call me back"]);
    expect(suggestedQuestions({ offers: null }, "hi")).toEqual(["कीमत क्या है?", "मुझे कॉल करें"]);
  });

  it("returns at most 3 distinct questions of up to 40 characters", () => {
    for (const language of ["en", "hi", "hinglish", "pa"] as const) {
      const questions = suggestedQuestions({ offers: ["Free site survey."] }, language);
      expect(questions[0]).toBe("Free site survey");
      expect(new Set(questions).size).toBe(questions.length);
      expect(questions.length).toBeLessThanOrEqual(3);
      for (const question of questions) expect([...question].length).toBeLessThanOrEqual(40);
    }
  });
});
