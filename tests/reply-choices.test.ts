import { describe, expect, it } from "vitest";
import { firstReplyText } from "@/lib/leads/first-reply";
import { replyChoices } from "@/lib/leads/reply-choices";

describe("segment first replies and follow-ups (#1945, CPO brief #1938)", () => {
  const solar = { leadName: "Ravi Kumar", businessName: "Solaride", offer: "Free solar site survey", vertical: "Rooftop solar" };

  it("offers a solar business 3 first replies in English, each opening with the name, business and offer", () => {
    const choices = replyChoices({ ...solar, language: "en", contacted: false });
    expect(choices.kind).toBe("first");
    expect(choices.texts).toEqual([
      "Hi Ravi, this is Solaride. Thanks for asking about free solar site survey! Which area is your home in, and roughly what's your monthly electricity bill?",
      "Hi Ravi, this is Solaride. Thanks for asking about free solar site survey! Can we book your free site survey? Is tomorrow or the day after better?",
      "Hi Ravi, this is Solaride. Thanks for asking about free solar site survey! Is your roof flat (RCC) or sloped, and about how big? That decides the system size.",
    ]);
  });

  it("switches to the 2 follow-ups once the enquiry has had a first contact", () => {
    const choices = replyChoices({ ...solar, language: "en", contacted: true });
    expect(choices.kind).toBe("follow-up");
    expect(choices.texts).toEqual([
      "Hi Ravi, just checking: shall we book the free site survey this week?",
      "Hi Ravi, if the price is the question, I can send a rough estimate from your bill. Want it?",
    ]);
  });

  it("writes Hinglish and Hindi (Devanagari) in the business's reply language", () => {
    expect(replyChoices({ ...solar, language: "hinglish", contacted: false }).texts[0]).toBe(
      "Hi Ravi, Solaride se. Free solar site survey ke baare mein poochne ke liye thanks! Aapka ghar kis area mein hai, aur bijli ka bill mahine ka lagbhag kitna aata hai?",
    );
    expect(replyChoices({ ...solar, language: "hi", contacted: false }).texts[1]).toBe(
      "नमस्ते Ravi, Solaride से। Free solar site survey के बारे में पूछने के लिए धन्यवाद! फ़्री साइट सर्वे बुक कर दें? कल या परसों, कब ठीक रहेगा?",
    );
    expect(replyChoices({ ...solar, language: "hi", contacted: true }).texts).toEqual([
      "नमस्ते Ravi, फ़्री साइट सर्वे इस हफ़्ते बुक कर दें?",
      "नमस्ते Ravi, अगर सवाल कीमत का है तो आपके बिल से रफ़ एस्टिमेट भेज दूँ?",
    ]);
  });

  it("finds the segment from the business type and keeps every line free of gendered first person", () => {
    const ielts = replyChoices({ leadName: "Simran", businessName: "Global Study", vertical: "IELTS coaching", language: "hinglish", contacted: false });
    expect(ielts.texts[0]).toBe("Hi Simran, Global Study se. Message ke liye thanks! Kaunse test ki taiyari hai, aur kab dena chahte ho?");
    const interiors = replyChoices({ leadName: "Asha", businessName: "Nest Interiors", offer: "Modular kitchen", vertical: "Interior designer", language: "en", contacted: false });
    expect(interiors.texts[2]).toBe("Hi Asha, this is Nest Interiors. Thanks for asking about modular kitchen! Can we set up your free design consultation? A site visit takes about 30 minutes.");
    for (const vertical of ["solar", "ielts", "interiors"]) {
      for (const language of ["hi", "hinglish"] as const) {
        for (const contacted of [false, true]) {
          const texts = replyChoices({ leadName: "A", businessName: "B", offer: "C", vertical, language, contacted, batchDate: "3 Nov", ownPhotos: true }).texts;
          expect(texts.join(" ")).not.toMatch(/\bmain\b|(?:unga|ungi)\b|मैं|ूँगा|ूँगी/i);
        }
      }
    }
  });

  it("drops the batch-date sentence without a date, and hides the follow-up that is only the date", () => {
    const base = { leadName: "Simran", businessName: "Global Study", vertical: "Study abroad", language: "en" as const };
    expect(replyChoices({ ...base, contacted: false }).texts[1]).toBe("Hi Simran, this is Global Study. Thanks for your message! Would you like a free demo class first?");
    expect(replyChoices({ ...base, contacted: false, batchDate: "3 Nov" }).texts[1]).toBe(
      "Hi Simran, this is Global Study. Thanks for your message! Our next batch starts 3 Nov. Would you like a free demo class first?",
    );
    expect(replyChoices({ ...base, contacted: true }).texts).toEqual(["Hi Simran, would a free demo class help you decide? When suits you?"]);
    expect(replyChoices({ ...base, contacted: true, batchDate: "3 Nov" }).texts[0]).toBe("Hi Simran, a seat in the 3 Nov batch is still open. Shall I hold one for you?");
  });

  it("offers the interiors photo follow-up only when the owner has their own photos (#1617)", () => {
    const base = { leadName: "Asha", businessName: "Nest Interiors", vertical: "Modular kitchens", language: "en" as const, contacted: true };
    expect(replyChoices(base).texts).toEqual(["Hi Asha, just checking: shall we fix the free design consultation this week?"]);
    expect(replyChoices({ ...base, ownPhotos: true }).texts[1]).toBe("Hi Asha, if it helps, I can share photos of kitchens we've finished nearby.");
  });

  it("reads well without a name or an offer", () => {
    expect(replyChoices({ businessName: "Solaride", vertical: "solar", language: "en", contacted: false }).texts[0]).toBe(
      "Hi, this is Solaride. Thanks for your enquiry! Which area is your home in, and roughly what's your monthly electricity bill?",
    );
    expect(replyChoices({ businessName: "Solaride", vertical: "solar", language: "hinglish", contacted: true }).texts[0]).toBe("Hi, free site survey is hafte book kar dein?");
    expect(replyChoices({ businessName: "Solaride", vertical: "solar", language: "hi", contacted: false }).texts[0]).toMatch(/^नमस्ते, Solaride से। पूछने के लिए धन्यवाद! /);
  });

  it("keeps today's single generic reply for every other business, before and after first contact", () => {
    const other = { leadName: "Ravi Kumar", businessName: "Dental Care", offer: "Free check-up", vertical: "Dentist", language: "hi" as const };
    for (const contacted of [false, true]) {
      expect(replyChoices({ ...other, contacted })).toEqual({ kind: "generic", texts: [firstReplyText(other)] });
    }
    expect(replyChoices({ ...other, vertical: null, contacted: false }).kind).toBe("generic");
  });
});
