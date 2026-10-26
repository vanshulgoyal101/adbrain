// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const save = vi.hoisted(() => vi.fn());
vi.mock("@/app/(app)/brand/whatsapp-template-actions", () => ({ saveWhatsAppTemplate: save }));
import { WhatsAppMessageCard } from "@/components/whatsapp-message-card";

const suggested = {
  en: { greeting: "Hi! Thanks for messaging Solaride. Send this message and we'll reply here.", prefill: "Hi! I'd like a free solar site survey." },
  hi: { greeting: "नमस्ते! Solaride को मैसेज करने के लिए धन्यवाद।", prefill: "नमस्ते, मुझे मुफ़्त सर्वे चाहिए।" },
  hinglish: { greeting: "Namaste! Solaride ko message karne ke liye dhanyavaad.", prefill: "Namaste, mujhe free survey chahiye." },
  pa: { greeting: "ਸਤ ਸ੍ਰੀ ਅਕਾਲ!", prefill: "ਮੈਨੂੰ ਜਾਣਕਾਰੀ ਚਾਹੀਦੀ ਹੈ।" },
};
const solaride = { greeting: "Hi! Thanks for messaging Solaride. This is your first step in getting free electricity.", opening: { kind: "prefill", prefill: "Can I get more info on this", callButton: true }, language: "en" };
const preview = () => screen.getByRole("figure", { name: "WhatsApp preview" });

beforeEach(() => { save.mockReset(); save.mockResolvedValue({ ok: true }); });

describe("WhatsApp message card (#840)", () => {
  it("starts from the suggested message and follows the language until the owner saves", () => {
    render(<WhatsAppMessageCard businessId="b1" businessName="Solaride" saved={null} suggested={suggested} />);
    expect(screen.getByText("Suggested")).toBeInTheDocument();
    expect(within(preview()).getByText(suggested.en.greeting)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "hi" } });
    expect(within(preview()).getByText(suggested.hi.greeting)).toBeInTheDocument();
  });

  it("shows Solaride's saved message with Call now, and saves exactly what the preview shows", async () => {
    render(<WhatsAppMessageCard businessId="b1" businessName="Solaride" saved={solaride} suggested={suggested} />);
    expect(screen.getByText("Your message")).toBeInTheDocument();
    expect(within(preview()).getByText("Call now")).toBeInTheDocument();
    expect(within(preview()).getByText("Can I get more info on this")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save WhatsApp message" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ businessId: "b1", template: solaride }));
    expect(await screen.findByText("Saved. New WhatsApp campaigns will use it.")).toBeInTheDocument();
  });

  it("turns quick questions into tappable bubbles and drops the pre-typed message", async () => {
    render(<WhatsAppMessageCard businessId="b1" businessName="Solaride" saved={null} suggested={suggested} />);
    fireEvent.click(screen.getByLabelText("Quick questions"));
    fireEvent.change(screen.getByLabelText("Question 1"), { target: { value: "Free site survey" } });
    fireEvent.change(screen.getByLabelText("Question 2"), { target: { value: "Price for my home" } });
    expect(within(preview()).getByText("Price for my home")).toBeInTheDocument();
    expect(screen.queryByLabelText("Pre-typed message")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save WhatsApp message" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ businessId: "b1", template: expect.objectContaining({ opening: { kind: "ice_breakers", questions: ["Free site survey", "Price for my home"] } }) }));
  });

  it("shows a refusal next to the field it's about, and Reset goes back to the suggestion", async () => {
    save.mockResolvedValueOnce({ ok: false, field: "greeting", error: "\"guaranteed\": Meta often rejects this." });
    render(<WhatsAppMessageCard businessId="b1" businessName="Solaride" saved={solaride} suggested={suggested} />);
    fireEvent.click(screen.getByRole("button", { name: "Save WhatsApp message" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("guaranteed");
    expect(screen.getByLabelText(/Welcome message/)).toHaveAttribute("aria-invalid", "true");
    fireEvent.click(screen.getByRole("button", { name: "Reset to suggested" }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ businessId: "b1", template: null }));
    expect(await screen.findByText("Suggested")).toBeInTheDocument();
    expect(within(preview()).getByText(suggested.en.greeting)).toBeInTheDocument();
  });
});
