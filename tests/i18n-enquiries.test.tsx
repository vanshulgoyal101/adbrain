// @vitest-environment jsdom
// #1438 slice 2: Enquiries in the owner's language; English stays the default.
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import hi from "../messages/hi.json";
import { LeadInbox } from "@/components/lead-inbox";
import { WhatsAppChats } from "@/components/whatsapp-chats";
import type { Lead } from "@/lib/types";

const words = { locale: "hi" as const, messages: hi.enquiries };
const asha = {
  id: "l1", business_id: "b1", campaign_id: null, meta_lead_id: "m1", form_id: "f1", form_name: "Rooftop solar enquiry",
  full_name: "Asha Verma", phone: "+919876543210", email: null, city: "Jaipur", field_data: {},
  created_time: "2026-08-20T10:00:00.000Z", created_at: "2026-08-20T10:00:00.000Z", workflow_status: "qualified",
} as unknown as Lead;

beforeEach(() => {
  localStorage.clear();
  global.fetch = vi.fn(async (url: string) => ({
    ok: true,
    json: async () => url === "/api/leads/sync"
      ? { leads: [], imported: 3, sync: { id: "s1", state: "partial", hasMore: true } }
      : { leads: [asha], total: 1, nextCursor: null },
  })) as unknown as typeof fetch;
});

describe("Enquiries in Hindi", () => {
  it("shows the inbox's headings, buttons and counts in Hindi", async () => {
    render(<LeadInbox businessName="Solaride" initialLeads={[asha]} metaReady syncScope="o:b" allTotal={1} summary={{ waiting: 2, replyMinutes: null }} words={words} />);
    expect(screen.getByRole("heading", { name: "पूछताछ (1)" })).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "दिखाएँ" })).getByRole("button", { name: "सभी" })).toBeInTheDocument();
    expect(screen.getByText("2 लोग आपका इंतज़ार कर रहे हैं।")).toBeInTheDocument();
    expect(await screen.findByText("Meta पर अभी भी देखा जा रहा है। अब तक 3 नई पूछताछ; पूरा करने के लिए \"देखते रहें\" दबाएँ।")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "देखते रहें" })).toBeInTheDocument();
  });

  it("says one WhatsApp chat in Hindi, and stays in English without words", () => {
    const row = { id: "c-wa", name: "Solaride | WhatsApp", chats: 1, spend: 0, realEnquiries: 0 };
    const { unmount } = render(<WhatsAppChats rows={[row]} words={words} />);
    expect(screen.getByRole("article")).toHaveTextContent("WhatsApp पर “Solaride | WhatsApp” से 1 चैट शुरू हुई।");
    expect(screen.getByRole("button", { name: "एक पूछताछ जोड़ें" })).toBeInTheDocument();
    unmount();
    render(<WhatsAppChats rows={[row]} />);
    expect(screen.getByRole("article")).toHaveTextContent("1 chat started from “Solaride | WhatsApp” on WhatsApp.");
  });
});
