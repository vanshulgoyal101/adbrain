// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WhatsAppNumberPicker } from "@/components/whatsapp-number-picker";
import type { WhatsAppNumberChoice } from "@/lib/types/campaign";

const page: WhatsAppNumberChoice = { masked: "+91 ••••• 0874", source: "page", choiceId: "a".repeat(64) };
const business: WhatsAppNumberChoice = { masked: "+91 ••••• 0874", source: "business", choiceId: "b".repeat(64) };

describe("WhatsApp number picker identity", () => {
  it("requires an explicit choice when nothing is selected, including equal Page and business masks", () => {
    const onChoose = vi.fn();
    render(<WhatsAppNumberPicker options={[page, business]} selected={undefined} wanted="" businessUnavailable={false} onChoose={onChoose} />);
    const picker = screen.getByLabelText("WhatsApp button number");
    expect(picker).toHaveDisplayValue("Choose your WhatsApp number");
    expect(onChoose).not.toHaveBeenCalled();
    fireEvent.change(picker, { target: { value: business.choiceId } });
    expect(onChoose).toHaveBeenCalledWith(business);
  });

  it("shows a previously selected mask until the Page is chosen explicitly", () => {
    const onChoose = vi.fn();
    render(<WhatsAppNumberPicker options={[page]} selected={undefined} wanted={business.masked} businessUnavailable onChoose={onChoose} />);
    expect(screen.getByLabelText("WhatsApp button number")).toHaveDisplayValue("+91 ••••• 0874 (previously selected; check this number)");
    fireEvent.click(screen.getByRole("button", { name: "Use Page number +91 ••••• 0874" }));
    expect(onChoose).toHaveBeenCalledWith(page);
  });
});
