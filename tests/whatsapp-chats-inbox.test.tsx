// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WhatsAppChats } from "@/components/whatsapp-chats";
import { enquiriesTitle, whatsappChatRows } from "@/lib/campaign/real-enquiries";
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

  // #1260 (CPO): one quiet strip per campaign; Meta counts chats started, not people, and AdBrain can't read them.
  it("says each campaign's chats in one strip and lets the owner add a real enquiry from them", () => {
    render(<WhatsAppChats rows={whatsappChatRows([chats, forms], results)} />);
    const section = screen.getByRole("region", { name: "WhatsApp chats" });
    const row = within(section).getByRole("article", { name: "WhatsApp chats from Solaride | WhatsApp" });
    expect(row).toHaveTextContent("5 chats started from “Solaride | WhatsApp” on WhatsApp. The messages are in your WhatsApp Business app. Add the real enquiries here to see which ad brings customers.");
    expect(within(row).queryByText("Real enquiries")).not.toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Got a customer? +1 (adds 1 customer from this ad)" })).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "Add an enquiry" }));
    expect(within(row).getByLabelText("Name (optional)")).toBeInTheDocument();
    expect(within(section).queryByText("Solaride | Form")).not.toBeInTheDocument();
  });

  it("says when a campaign has no chats yet", () => {
    render(<WhatsAppChats rows={[{ id: "c-wa", name: "Solaride | WhatsApp", chats: 0, spend: 0, realEnquiries: 0 }]} />);
    expect(screen.getByRole("article")).toHaveTextContent("No chats started yet from “Solaride | WhatsApp”.");
  });

  it.each([{ count: 1, noun: "enquiry" }, { count: 3, noun: "enquiries" }])("counts $count owner-added real enquiries separately when Meta counted no chats", ({ count, noun }) => {
    render(<WhatsAppChats rows={[{ id: "c-wa", name: "Solaride | WhatsApp", chats: 0, spend: 0, realEnquiries: count }]} />);
    expect(screen.getByRole("article")).toHaveTextContent(`You added ${count} real ${noun} from “Solaride | WhatsApp”.`);
    expect(screen.getByRole("article")).not.toHaveTextContent("No chats started yet");
  });

  it("calls the list plain Enquiries once a WhatsApp chat is logged in it", () => {
    expect(enquiriesTitle([])).toBe("Enquiries");
    expect(enquiriesTitle([{ id: "c-wa", name: "WA", chats: 3, spend: 0, realEnquiries: 0 }])).toBe("Form enquiries");
    expect(enquiriesTitle([{ id: "c-wa", name: "WA", chats: 0, spend: 0, realEnquiries: 1 }])).toBe("Enquiries");
  });

  it("shows nothing when no WhatsApp campaign has results", () => {
    const { container } = render(<WhatsAppChats rows={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

// #1223: a WhatsApp-first owner's results are the chats; the form table came first and filled the phone screen.
describe("Enquiries order (#1223)", () => {
  it("puts WhatsApp chats first and folds the form table away when it has no form enquiries", async () => {
    const { EnquiriesSections } = await import("@/components/enquiries-sections");
    const rows = whatsappChatRows([chats], results);
    const { container } = render(<EnquiriesSections chatRows={rows} formTotal={0}><p>form table</p></EnquiriesSections>);
    const chatsSection = screen.getByRole("region", { name: "WhatsApp chats" });
    const fold = container.querySelector("details")!;
    expect(chatsSection.compareDocumentPosition(fold) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(fold).not.toHaveAttribute("open");
    expect(within(fold).getByText("Form enquiries (0)")).toBeInTheDocument();
    expect(within(fold).getByText("form table")).toBeInTheDocument();
  });

  it("shows the form table open, after the chats, when there are form enquiries", async () => {
    const { EnquiriesSections } = await import("@/components/enquiries-sections");
    const { container } = render(<EnquiriesSections chatRows={whatsappChatRows([chats], results)} formTotal={3}><p>form table</p></EnquiriesSections>);
    expect(container.querySelector("details")).toBeNull();
    expect(screen.getByRole("region", { name: "WhatsApp chats" }).compareDocumentPosition(screen.getByText("form table")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // #1597: nothing has come in anywhere: no chat strip and no "(0)" fold, only the inbox's one empty block.
  it("with no enquiries at all, shows only the inbox (no chat strips, no fold)", async () => {
    const { EnquiriesSections } = await import("@/components/enquiries-sections");
    const { container } = render(<EnquiriesSections chatRows={whatsappChatRows([chats], results)} formTotal={0} empty><p>form table</p></EnquiriesSections>);
    expect(container.querySelector("details")).toBeNull();
    expect(screen.queryByRole("region", { name: "WhatsApp chats" })).toBeNull();
    expect(screen.getByText("form table")).toBeVisible();
  });

  it("with no WhatsApp chats, the form table is the page, as before", async () => {
    const { EnquiriesSections } = await import("@/components/enquiries-sections");
    const { container } = render(<EnquiriesSections chatRows={[]} formTotal={0}><p>form table</p></EnquiriesSections>);
    expect(container.querySelector("details")).toBeNull();
    expect(screen.queryByRole("region", { name: "WhatsApp chats" })).toBeNull();
    expect(screen.getByText("form table")).toBeVisible();
  });
});
