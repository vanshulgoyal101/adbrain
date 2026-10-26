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
    for (const [name, event] of [["Show me how", "whatsapp_ai.guide"], ["Done", "whatsapp_ai.done"], ["Not available for me", "whatsapp_ai.unavailable"]]) {
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
    fireEvent.click(within(dialog).getByRole("button", { name: "Hinglish" }));
    expect(within(dialog).getByRole("button", { name: "Hinglish" })).toHaveAttribute("aria-pressed", "true");
    expect(dialog).toHaveTextContent("Kisko jawab de");
    expect(dialog.textContent).not.toMatch(/free/i);
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
});
