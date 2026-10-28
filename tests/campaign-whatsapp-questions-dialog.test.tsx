// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/brand/whatsapp-template-actions", () => ({ saveWhatsAppTemplate: vi.fn() }));
import { CampaignWhatsAppMessageDialog } from "@/components/campaign-whatsapp-message-dialog";
import { draftFromSuggestion } from "@/components/whatsapp-message-card";
import { suggestedQuestions } from "@/lib/campaign/whatsapp-questions";

// #1114: Review's "Edit for this campaign" fills Quick questions with the Brand's offers asked as a customer would.
const suggested = {
  en: { greeting: "Hi! Thanks for messaging Solaride. Send this message and we'll reply here.", prefill: "Hi! I'd like a free site survey." },
  hi: { greeting: "नमस्ते!", prefill: "नमस्ते" },
  hinglish: { greeting: "Namaste!", prefill: "Namaste" },
  pa: { greeting: "ਸਤ ਸ੍ਰੀ ਅਕਾਲ!", prefill: "ਸਤ ਸ੍ਰੀ ਅਕਾਲ" },
};
const brand = { offers: ["Free site survey", "PM Surya Ghar subsidy help"] };

describe("Edit for this campaign: quick questions (#1114)", () => {
  it("fills empty boxes with the Brand's suggested questions, in the message's language", () => {
    render(<CampaignWhatsAppMessageDialog businessId="b1" businessName="Solaride" initial={draftFromSuggestion(suggested, "hinglish")} suggested={suggested}
      suggestedQuestions={(language) => suggestedQuestions(brand, language === "auto" ? "en" : language)} followsSuggestion edited={false} onUse={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Quick questions"));
    expect(screen.getByLabelText("Question 1")).toHaveValue("Free site survey book ho sakta hai?");
    expect(screen.getByLabelText("Question 2")).toHaveValue("PM Surya Ghar subsidy help kaise milega?");
    expect(screen.getByLabelText("Question 3")).toHaveValue("Price kya hai?");
  });

  it("leaves the boxes empty without suggestions", () => {
    render(<CampaignWhatsAppMessageDialog businessId="b1" businessName="Solaride" initial={draftFromSuggestion(suggested, "en")} suggested={suggested}
      followsSuggestion edited={false} onUse={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Quick questions"));
    expect(screen.getByLabelText("Question 1")).toHaveValue("");
  });
});
