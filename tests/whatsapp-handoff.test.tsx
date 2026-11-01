// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WhenTheyTap } from "@/components/when-they-tap";
import { handoffLine, handoffRate, isGenericAsk } from "@/lib/campaign/whatsapp-handoff";

const offers = ["Free site survey", "Diwali offer: 10% off rooftop solar installation"];

describe("#1081: past open → message rate", () => {
  it("sums the business's WhatsApp campaigns and hides below 10 opens", () => {
    // #157: 28 opened WhatsApp, 1 messaged.
    expect(handoffRate([{ whatsapp_opens: 21, conversations: 1 }, { whatsapp_opens: 7, conversations: null }])).toEqual({ opens: 28, messages: 1 });
    expect(handoffLine({ opens: 28, messages: 1 })).toBe("Your past WhatsApp ads: 28 taps on the WhatsApp button, 1 sent a message (4%).");
    expect(handoffRate([{ whatsapp_opens: 9, conversations: 2 }])).toBeNull();
    expect(handoffRate([])).toBeNull();
    expect(handoffRate([{ whatsapp_opens: 10, conversations: 40 }])).toEqual({ opens: 10, messages: 10 });
  });
});

describe("#1081: a general pre-typed ask", () => {
  it("flags greetings and info-only asks in every language", () => {
    for (const ask of ["Hi", "Hello!", "Hi, I want info", "Hi! I'd like to know more about Solaride.", "I am interested",
      "नमस्ते, मुझे Solaride के बारे में जानकारी चाहिए।", "Namaste, mujhe Solaride ke baare mein jaankari chahiye.", "ਸਤ ਸ੍ਰੀ ਅਕਾਲ, ਮੈਨੂੰ Solaride ਬਾਰੇ ਜਾਣਕਾਰੀ ਚਾਹੀਦੀ ਹੈ।"]) {
      expect(isGenericAsk(ask, offers), ask).toBe(true);
    }
  });

  it("accepts an ask naming an offer or a number", () => {
    for (const ask of ["Hi! I'd like a free site survey in Mohali.", "नमस्ते, मुझे Mohali में Free site survey के बारे में जानकारी चाहिए।",
      "I'd like the 10% off rooftop solar installation.", "Price for a 3 kW system?", "Can someone visit my roof this week to check it"]) {
      expect(isGenericAsk(ask, offers), ask).toBe(false);
    }
    expect(isGenericAsk("", offers)).toBe(false);
  });
});

describe("#1081: When they tap shows the rate and the note", () => {
  const message = { source: "suggested" as const, language: "en" as const, greeting: "Hi! Thanks for messaging Solaride.", autofill: "Hi! I'd like to know more about Solaride." };

  it("shows the past rate and a soft note with Edit for a general ask", () => {
    const onEdit = vi.fn();
    render(<WhenTheyTap message={message} businessName="Solaride" adsLanguage="en" onEdit={onEdit} handoff={{ opens: 28, messages: 1 }} offers={offers} />);
    expect(screen.getByText("Your past WhatsApp ads: 28 taps on the WhatsApp button, 1 sent a message (4%).")).toBeInTheDocument();
    expect(screen.getByText(/is general\. People send a concrete, local ask more often/)).toBeInTheDocument();
    screen.getByRole("button", { name: "Edit" }).click();
    expect(onEdit).toHaveBeenCalled();
  });

  it("says nothing extra for a concrete ask, ice breakers, or no history", () => {
    const { rerender } = render(<WhenTheyTap message={{ ...message, autofill: "Hi! I'd like a free site survey." }} businessName="Solaride" adsLanguage="en" onEdit={vi.fn()} offers={offers} />);
    expect(screen.queryByText(/is general/)).toBeNull();
    expect(screen.queryByText(/Your past WhatsApp ads/)).toBeNull();
    rerender(<WhenTheyTap message={{ ...message, iceBreakers: ["Price?"] }} businessName="Solaride" adsLanguage="en" onEdit={vi.fn()} offers={offers} />);
    expect(screen.queryByText(/is general/)).toBeNull();
  });
});
