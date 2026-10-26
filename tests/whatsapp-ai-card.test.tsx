// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { WhatsAppAiCard } from "@/components/whatsapp-ai-card";

// #794: after a WhatsApp launch, point owners to WhatsApp's own AI reply; their answer is logged per business.
const BUSINESS = "11111111-1111-4111-8111-111111111111";

beforeEach(() => localStorage.clear());

describe("WhatsAppAiCard", () => {
  it("offers the guide with 44 px actions that log the answer, and never says free", () => {
    render(<WhatsAppAiCard businessId={BUSINESS} />);
    const card = screen.getByRole("region", { name: "Reply faster with WhatsApp's AI?" });
    for (const [name, event] of [["Show me how", "whatsapp_ai.guide"], ["Already on", "whatsapp_ai.done"], ["Not available for me", "whatsapp_ai.unavailable"], ["Not now", "whatsapp_ai.later"]]) {
      const button = within(card).getByRole("button", { name });
      expect(button).toHaveAttribute("data-product-event", event);
      expect(button.className).toMatch(/\bh-11\b/);
    }
    expect(card.textContent).not.toMatch(/free/i);
  });

  it("shows the three steps in English and Hinglish", () => {
    render(<WhatsAppAiCard businessId={BUSINESS} />);
    fireEvent.click(screen.getByRole("button", { name: "Show me how" }));
    const dialog = screen.getByRole("dialog", { name: "Turn on WhatsApp's AI reply" });
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(3);
    expect(dialog).toHaveTextContent("Customers coming from your ads");
    expect(dialog).toHaveTextContent("Using normal WhatsApp? This is only in the free WhatsApp Business app.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Hinglish" }));
    expect(within(dialog).getByRole("button", { name: "Hinglish" })).toHaveAttribute("aria-pressed", "true");
    expect(dialog).toHaveTextContent("Kisko jawab de");
    expect(dialog).toHaveTextContent("Normal WhatsApp hai? Ye sirf free WhatsApp Business app mein hai.");
    // "Free" describes only the WhatsApp Business app, never the AI reply (unverified, #794).
    expect(dialog.textContent!.replace(/free WhatsApp Business app/g, "")).not.toMatch(/free/i);
  });

  it("an answer hides it for that business and stays hidden", () => {
    const { unmount } = render(<WhatsAppAiCard businessId={BUSINESS} />);
    fireEvent.click(screen.getByRole("button", { name: "Not available for me" }));
    expect(screen.queryByRole("region")).toBeNull();
    expect(localStorage.getItem(`whatsapp-ai:${BUSINESS}`)).toBe("unavailable");
    unmount();
    render(<WhatsAppAiCard businessId={BUSINESS} />);
    expect(screen.queryByRole("region")).toBeNull();
    render(<WhatsAppAiCard businessId="22222222-2222-4222-8222-222222222222" />);
    expect(screen.getByRole("region")).toBeInTheDocument();
  });

  // CPO on #794: "Not now" isn't an answer about the AI; it hides the card for 7 days only.
  it("Not now hides the card for 7 days, then it comes back", () => {
    const { unmount } = render(<WhatsAppAiCard businessId={BUSINESS} />);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("region")).toBeNull();
    unmount();
    const { unmount: again } = render(<WhatsAppAiCard businessId={BUSINESS} />);
    expect(screen.queryByRole("region")).toBeNull();
    again();
    localStorage.setItem(`whatsapp-ai:${BUSINESS}`, `later:${Date.now() - 8 * 86_400_000}`);
    render(<WhatsAppAiCard businessId={BUSINESS} />);
    expect(screen.getByRole("region")).toBeInTheDocument();
  });
});
