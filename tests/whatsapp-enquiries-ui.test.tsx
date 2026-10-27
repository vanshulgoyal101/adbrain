// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { WhatsAppEnquiries } from "@/components/whatsapp-enquiries";
import { Campaigns } from "@/components/campaigns";
import type { Business, Campaign, CampaignResult } from "@/lib/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const CAMPAIGN = "30000000-0000-4000-8000-000000000001";

function Harness({ initial = 1 }: { initial?: number }) {
  const [count, setCount] = useState(initial);
  return <WhatsAppEnquiries campaignId={CAMPAIGN} spend={140} enquiries={count} onLogged={setCount} />;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("<WhatsAppEnquiries> (#335)", () => {
  it("explains what counts as a real enquiry only until the first one (#847)", () => {
    const { unmount } = render(<WhatsAppEnquiries campaignId={CAMPAIGN} spend={140} enquiries={0} onLogged={() => {}} />);
    expect(screen.getByText(/Not every chat is a customer/)).toBeInTheDocument();
    unmount();
    render(<WhatsAppEnquiries campaignId={CAMPAIGN} spend={140} enquiries={2} onLogged={() => {}} />);
    expect(screen.queryByText(/Not every chat is a customer/)).toBeNull();
  });

  it("logs a real enquiry with optional details and shows cost per real enquiry", async () => {
    const fetch = vi.fn(async () => Response.json({ enquiries: 2 }, { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    render(<Harness />);
    const panel = screen.getByRole("region", { name: "Real enquiries" });
    expect(within(panel).getByText("₹140")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add enquiry" }));
    fireEvent.change(screen.getByLabelText("Name (optional)"), { target: { value: "Ravi Kumar" } });
    fireEvent.change(screen.getByLabelText("Phone (optional)"), { target: { value: "+91 98140 12345" } });
    fireEvent.change(screen.getByLabelText("Note (optional)"), { target: { value: "Wants 50 kW" } });
    fireEvent.click(screen.getByRole("button", { name: "Save enquiry" }));
    await waitFor(() => expect(within(panel).getByText("₹70")).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith(`/api/campaigns/${CAMPAIGN}/enquiries`, expect.objectContaining({
      method: "POST", body: JSON.stringify({ name: "Ravi Kumar", phone: "+91 98140 12345", note: "Wants 50 kW" }),
    }));
    expect(within(panel).getByText("2")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Saved to Enquiries.");
    expect(screen.queryByLabelText("Name (optional)")).not.toBeInTheDocument();
  });

  it("shows no cost before the first real enquiry and keeps the form open on a failed save", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "The enquiry could not be saved. Try again." }, { status: 503 })));
    render(<Harness initial={0} />);
    const panel = screen.getByRole("region", { name: "Real enquiries" });
    expect(within(panel).getByText("—")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add enquiry" }));
    fireEvent.click(screen.getByRole("button", { name: "Save enquiry" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The enquiry could not be saved. Try again.");
    expect(screen.getByLabelText("Name (optional)")).toBeInTheDocument();
    expect(within(panel).getByText("0")).toBeInTheDocument();
  });
});

describe("<WhatsAppEnquiries> one-tap customer (#798)", () => {
  it("adds a customer in one tap and Undo removes it", async () => {
    const onCustomers = vi.fn();
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "DELETE"
      ? Response.json({ enquiries: 1, customers: 0 })
      : Response.json({ id: "40000000-0000-4000-8000-000000000001", enquiries: 2, customers: 1 }, { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    render(<WhatsAppEnquiries campaignId={CAMPAIGN} spend={140} enquiries={1} onLogged={vi.fn()} onCustomers={onCustomers} />);
    fireEvent.click(screen.getByRole("button", { name: "Got a customer? +1 (adds 1 customer from this ad)" }));
    expect(await screen.findByText("Added 1 customer.")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(`/api/campaigns/${CAMPAIGN}/enquiries`, expect.objectContaining({ method: "POST", body: JSON.stringify({ customer: true }) }));
    expect(onCustomers).toHaveBeenLastCalledWith(1, 2);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Removed that customer.")).toBeInTheDocument();
    expect(fetch).toHaveBeenLastCalledWith(`/api/campaigns/${CAMPAIGN}/enquiries?lead=40000000-0000-4000-8000-000000000001`, { method: "DELETE" });
    expect(onCustomers).toHaveBeenLastCalledWith(0, 1);
  });
});

describe("<Campaigns> real enquiries on results (#335)", () => {
  const business = { id: "11111111-1111-4111-8111-111111111111", owner_id: "owner-1", name: "Solaride", locations: ["Mohali"] } as Business;
  const campaign = (id: string, destination: string) => ({ id, business_id: business.id, name: `${destination} run`, status: "active", objective: "engagement", destination, daily_budget: 280, created_at: "2026-10-23T00:00:00Z", meta_campaign_id: `meta-${id}`, creative_ids: [], raw: {} }) as unknown as Campaign;
  const result = (id: string, extra: Partial<CampaignResult>) => ({ id: `r-${id}`, campaign_id: id, spend: 140, impressions: 300, clicks: 4, leads: 0, cpl: null, fetched_at: "2026-10-24T08:00:00Z", ...extra }) as CampaignResult;

  it("shows real enquiries only on WhatsApp results", () => {
    localStorage.setItem(`campaign-sync:${business.owner_id}:${business.id}:act_1`, String(Date.now()));
    const whatsapp = campaign("40000000-0000-4000-8000-000000000001", "whatsapp");
    const form = campaign("40000000-0000-4000-8000-000000000002", "instant_form");
    render(<Campaigns business={business} approved={[]} initialCampaigns={[whatsapp, form]}
      initialResults={{ [whatsapp.id]: result(whatsapp.id, { conversations: 2, cost_per_conversation: 70, real_enquiries: 1, destination: "whatsapp" }), [form.id]: result(form.id, { leads: 3, cpl: 46.67 }) }}
      leadForms={[]} leadFormError={null} metaReady adAccountId="act_1" />);
    const panels = screen.getAllByRole("region", { name: "Real enquiries" });
    expect(panels).toHaveLength(1);
    expect(within(panels[0]).getByText("₹140")).toBeInTheDocument();
  });

  // #847: a WhatsApp card with no chats, enquiries or customers has nothing to log, so the block waits for the first chat.
  it("hides the real-enquiry block until there's a chat, an enquiry or a customer", () => {
    localStorage.setItem(`campaign-sync:${business.owner_id}:${business.id}:act_1`, String(Date.now()));
    const quiet = campaign("40000000-0000-4000-8000-000000000005", "whatsapp");
    const unknown = campaign("40000000-0000-4000-8000-000000000006", "whatsapp");
    render(<Campaigns business={business} approved={[]} initialCampaigns={[quiet, unknown]}
      initialResults={{ [quiet.id]: result(quiet.id, { conversations: 0, real_enquiries: 0, destination: "whatsapp" }), [unknown.id]: result(unknown.id, { conversations: null, destination: "whatsapp" }) }}
      leadForms={[]} leadFormError={null} metaReady adAccountId="act_1" />);
    expect(screen.getAllByRole("region", { name: "Real enquiries" })).toHaveLength(1);
  });

  // #798: ₹ per customer shows once an enquiry became a customer, on any destination.
  it("shows customers and the cost per customer only after the first one", () => {
    localStorage.setItem(`campaign-sync:${business.owner_id}:${business.id}:act_1`, String(Date.now()));
    const form = campaign("40000000-0000-4000-8000-000000000003", "instant_form");
    const none = campaign("40000000-0000-4000-8000-000000000004", "instant_form");
    render(<Campaigns business={business} approved={[]} initialCampaigns={[form, none]}
      initialResults={{ [form.id]: result(form.id, { spend: 900, leads: 3, cpl: 300, customers: 2 }), [none.id]: result(none.id, { leads: 1, cpl: 140, customers: 0 }) }}
      leadForms={[]} leadFormError={null} metaReady adAccountId="act_1" />);
    const panels = screen.getAllByLabelText("Customers");
    expect(panels).toHaveLength(1);
    expect(within(panels[0]).getByText("Per customer")).toBeInTheDocument();
    expect(within(panels[0]).getByText("From customers you marked in Enquiries.")).toBeInTheDocument();
    expect(within(panels[0]).getByText("₹450")).toBeInTheDocument();
    expect(within(panels[0]).getByText("2")).toBeInTheDocument();
  });
});
