// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WhatsAppChats } from "@/components/whatsapp-chats";
import { whatsappChatRows } from "@/lib/campaign/real-enquiries";
import type { Campaign, CampaignResult } from "@/lib/types";

// #764 (2/2): CPO's walk: Enquiries listed only form leads, while WhatsApp chats (the main result) lived
// on the campaign cards. Enquiries now shows each WhatsApp campaign's chats with its Add enquiry.
const chats = { id: "c-wa", name: "Solaride | WhatsApp", status: "active", destination: "whatsapp" } as unknown as Campaign;
const forms = { id: "c-form", name: "Solaride | Form", status: "paused", destination: "instant_form" } as unknown as Campaign;
const results = {
  "c-wa": { id: "r1", campaign_id: "c-wa", destination: "whatsapp", leads: 0, conversations: 5, spend: 840, real_enquiries: 2, fetched_at: "2026-10-26T09:50:00Z" },
  "c-form": { id: "r2", campaign_id: "c-form", destination: "instant_form", leads: 2, spend: 160, fetched_at: "2026-10-26T09:50:00Z" },
} as unknown as Record<string, CampaignResult>;

describe("WhatsApp chats on Enquiries (#764)", () => {
  it("lists only WhatsApp campaigns with results, counted like their cards", () => {
    expect(whatsappChatRows([chats, forms, { ...chats, id: "c-new" }], results)).toEqual([
      { id: "c-wa", name: "Solaride | WhatsApp", chats: 5, spend: 840, realEnquiries: 2 },
    ]);
  });

  it("shows each campaign's chats and lets the owner add a real enquiry from them", () => {
    render(<WhatsAppChats rows={whatsappChatRows([chats, forms], results)} />);
    const section = screen.getByRole("region", { name: "WhatsApp chats" });
    const row = within(section).getByRole("article", { name: "Solaride | WhatsApp" });
    expect(within(row).getByText("5 chats started")).toBeInTheDocument();
    expect(within(row).getByText("Real enquiries").previousElementSibling).toHaveTextContent("2");
    fireEvent.click(within(row).getByRole("button", { name: "Add enquiry" }));
    expect(within(row).getByLabelText("Name (optional)")).toBeInTheDocument();
    expect(within(section).queryByText("Solaride | Form")).not.toBeInTheDocument();
  });

  it("shows nothing when no WhatsApp campaign has results", () => {
    const { container } = render(<WhatsAppChats rows={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
