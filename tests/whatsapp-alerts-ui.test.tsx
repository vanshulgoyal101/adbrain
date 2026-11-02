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
    fireEvent.click(screen.getByLabelText(/New form enquiry/));
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Save alerts" }));
    await waitFor(() => expect(actions.saveAlertSettings).toHaveBeenCalledWith({ businessId: "b1", leadAlerts: true, dailyResults: false, language: "hi" }));
    expect(await screen.findByText("Saved. Confirm your WhatsApp number above to start getting them.")).toBeInTheDocument();
  });

  it("puts the number step first until it's confirmed, then last (#847)", () => {
    const { unmount } = render(<WhatsAppAlerts businessId="b1" initial={off} />);
    const confirm = screen.getByRole("button", { name: "Confirm my WhatsApp number" });
    expect(confirm.compareDocumentPosition(screen.getByLabelText(/New form enquiry/)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    unmount();
    render(<WhatsAppAlerts businessId="b1" initial={{ ...off, leadAlerts: true, number: "+91 ••••• 2222" }} />);
    expect(screen.getByRole("button", { name: "Use another number" }).compareDocumentPosition(screen.getByLabelText(/New form enquiry/)) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
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

  // #1720 (CPO, #1689): say what pilots actually get. The daily line comes first; form alerts are form-only.
  it("describes the alerts honestly, daily line first", () => {
    render(<WhatsAppAlerts businessId="b1" initial={off} />);
    expect(screen.getByText("A short WhatsApp message from AdBrain when something needs you. Customer chats from your ads already arrive in your WhatsApp Business app.")).toBeInTheDocument();
    const daily = screen.getByLabelText(/Yesterday's results, 9 am/);
    const form = screen.getByLabelText(/New form enquiry/);
    expect(daily.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("One line: what you spent, how many people messaged you or filled a form, and the cost of each.")).toBeInTheDocument();
    expect(screen.getByText("Only for ads with a form: name, phone and which ad, with a tap to call.")).toBeInTheDocument();
  });

  it("before the first save offers both on, in the app's language; saving sends those", async () => {
    actions.saveAlertSettings.mockResolvedValue({ ok: true, settings: { ...off, leadAlerts: true, dailyResults: true, language: "hi", saved: true } });
    render(<WhatsAppAlerts businessId="b1" initial={{ ...off, saved: false }} locale="hi" />);
    expect(screen.getByLabelText(/कल के नतीजे, सुबह 9 बजे/)).toBeChecked();
    expect(screen.getByLabelText(/फ़ॉर्म से नई पूछताछ/)).toBeChecked();
    expect(screen.getByLabelText("भाषा")).toHaveValue("hi");
    fireEvent.click(screen.getByRole("button", { name: "अलर्ट सेव करें" }));
    await waitFor(() => expect(actions.saveAlertSettings).toHaveBeenCalledWith({ businessId: "b1", leadAlerts: true, dailyResults: true, language: "hi" }));
  });

  it("keeps a saved choice (both off) as saved", () => {
    render(<WhatsAppAlerts businessId="b1" initial={{ ...off, saved: true }} locale="hi" />);
    expect(screen.getByLabelText(/कल के नतीजे/)).not.toBeChecked();
    expect(screen.getByLabelText("भाषा")).toHaveValue("en");
  });

  // #1720 (CPO): no fixed English under Hindi rows.
  it("shows the whole panel in Hindi, number step and messages included", async () => {
    actions.startAlertVerification.mockResolvedValue({ ok: true, link: "https://wa.me/919800000000?text=START%20A1B2C3D4E5" });
    const { unmount } = render(<WhatsAppAlerts businessId="b1" initial={off} locale="hi" />);
    expect(screen.getByRole("heading", { name: "WhatsApp अलर्ट" })).toBeInTheDocument();
    expect(screen.getByText("पहले वह WhatsApp नंबर पक्का करें जिस पर अलर्ट आने चाहिए: उसी नंबर से एक मैसेज भेजें।")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "मेरा WhatsApp नंबर पक्का करें" }));
    expect(await screen.findByRole("link", { name: "WhatsApp खोलें और START भेजें" })).toBeInTheDocument();
    expect(screen.getByText("मैसेज भेजने के लिए तैयार है। लिंक 15 मिनट तक चलेगा।")).toBeInTheDocument();
    unmount();
    render(<WhatsAppAlerts businessId="b1" initial={{ ...off, leadAlerts: true, number: "+91 ••••• 2222" }} locale="hi" />);
    expect(screen.getByText(/कभी भी WhatsApp पर STOP भेजें/)).toHaveTextContent("+91 ••••• 2222");
    expect(screen.getByRole("button", { name: "दूसरा नंबर इस्तेमाल करें" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "WhatsApp अलर्ट" }).textContent).not.toMatch(/Save alerts|Confirm my|Alerts go to|Language/);
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
