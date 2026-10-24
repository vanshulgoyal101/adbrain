// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WhatsAppStatusPanel } from "@/components/whatsapp-status";
import { maskWhatsAppNumber } from "@/lib/meta/whatsapp-status-shared";

const businessId = "11111111-1111-4111-8111-111111111111";

afterEach(() => vi.unstubAllGlobals());

describe("WhatsApp chat ads status (#235)", () => {
  it("masks with the real dialling code", () => {
    expect(maskWhatsAppNumber("+919999994842")).toBe("+91 ••••• 4842");
    expect(maskWhatsAppNumber("+15125550100")).toBe("+1 ••••• 0100");
    expect(maskWhatsAppNumber("+971501234567")).toBe("+971 ••••• 4567");
  });

  it("shows ready numbers masked, with where each one comes from", () => {
    render(<WhatsAppStatusPanel businessId={businessId} initialStatus={{ state: "ready", numbers: [{ masked: "+91 ••••• 4842", source: "business" }] }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Ready: +91 ••••• 4842 (your WhatsApp Business account)");
  });

  it("guides the link while no number is linked, then picks up the link on Check again", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ state: "ready", numbers: [{ masked: "+91 ••••• 0874", source: "page" }] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<WhatsAppStatusPanel businessId={businessId} initialStatus={{ state: "not_linked" }} />);
    expect(screen.getByText(/Settings → Linked accounts → WhatsApp/)).toBeInTheDocument();
    expect(screen.getByText(/Business tools → Facebook & Instagram/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /check again/i }));
    expect(await screen.findByText(/Ready: \+91 ••••• 0874 \(linked to your Page\)/)).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0][0])).toBe(`/api/meta/whatsapp?businessId=${businessId}`);
    expect(screen.queryByText(/Linked accounts/)).not.toBeInTheDocument();
  });

  it("says unavailable instead of guessing when Meta can't be read", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => Response.json({ error: "nope" }, { status: 500 })));
    render(<WhatsAppStatusPanel businessId={businessId} initialStatus={{ state: "ready", numbers: [{ masked: "+91 ••••• 0874", source: "page" }] }} />);
    fireEvent.click(screen.getByRole("button", { name: /check again/i }));
    expect(await screen.findByText(/WhatsApp status is unavailable/)).toBeInTheDocument();
  });
});
