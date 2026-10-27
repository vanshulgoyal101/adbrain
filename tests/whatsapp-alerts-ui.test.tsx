// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({ saveAlertSettings: vi.fn(), startAlertVerification: vi.fn() }));
vi.mock("@/app/(app)/settings/whatsapp-alerts-actions", () => actions);
import { WhatsAppAlerts } from "@/components/whatsapp-alerts";

const off = { leadAlerts: false, dailyResults: false, language: "en" as const, number: null, optedOut: false };
beforeEach(() => { actions.saveAlertSettings.mockReset(); actions.startAlertVerification.mockReset(); });

describe("Settings → WhatsApp alerts (#701)", () => {
  it("saves the switches and language, then asks to confirm the number", async () => {
    actions.saveAlertSettings.mockResolvedValue({ ok: true, settings: { ...off, leadAlerts: true, language: "hi" } });
    render(<WhatsAppAlerts businessId="b1" initial={off} />);
    expect(screen.getByRole("button", { name: "Save alerts" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Every new enquiry/));
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Save alerts" }));
    await waitFor(() => expect(actions.saveAlertSettings).toHaveBeenCalledWith({ businessId: "b1", leadAlerts: true, dailyResults: false, language: "hi" }));
    expect(await screen.findByText("Saved. Confirm your WhatsApp number below to start getting them.")).toBeInTheDocument();
  });

  it("opens WhatsApp with START ready to send, from the number that should get alerts", async () => {
    actions.startAlertVerification.mockResolvedValue({ ok: true, link: "https://wa.me/919800000000?text=START%20A1B2C3D4E5" });
    render(<WhatsAppAlerts businessId="b1" initial={{ ...off, leadAlerts: true }} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm my WhatsApp number" }));
    expect(await screen.findByRole("link", { name: "Open WhatsApp and send START" })).toHaveAttribute("href", "https://wa.me/919800000000?text=START%20A1B2C3D4E5");
  });

  it("names the confirmed number (masked) and how to stop, and says so after STOP", () => {
    const { unmount } = render(<WhatsAppAlerts businessId="b1" initial={{ ...off, leadAlerts: true, number: "+91 ••••• 2222" }} />);
    expect(screen.getByText(/Reply STOP on WhatsApp anytime/)).toHaveTextContent("+91 ••••• 2222");
    unmount();
    render(<WhatsAppAlerts businessId="b1" initial={{ ...off, number: "+91 ••••• 2222", optedOut: true }} />);
    expect(screen.getByText(/Send START from your WhatsApp to turn them back on/)).toBeInTheDocument();
  });

  it("a failed save stays on the card with 'Try again' (#920)", async () => {
    actions.saveAlertSettings.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<WhatsAppAlerts businessId="b1" initial={off} />);
    fireEvent.click(screen.getByLabelText(/Yesterday's results/));
    fireEvent.click(screen.getByRole("button", { name: "Save alerts" }));
    expect(await screen.findByText("Couldn't save your alert settings. Try again.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Yesterday's results/)).toBeChecked();
  });
});
