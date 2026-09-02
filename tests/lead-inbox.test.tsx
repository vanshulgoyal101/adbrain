// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LeadInbox } from "@/components/lead-inbox";
import type { Lead } from "@/lib/types";

const lead = (over: Partial<Lead> = {}): Lead =>
  ({
    id: "l1",
    business_id: "b1",
    campaign_id: null,
    meta_lead_id: "m1",
    form_id: "f1",
    form_name: "Rooftop solar enquiry",
    full_name: "Asha Verma",
    phone: "+919876543210",
    email: "asha@example.com",
    city: "Jaipur",
    field_data: {},
    created_time: "2026-08-20T10:00:00.000Z",
    created_at: "2026-08-20T10:00:00.000Z",
    ...over,
  }) as unknown as Lead;

const setFetch = (impl: unknown) => {
  global.fetch = vi.fn().mockResolvedValue(impl) as unknown as typeof fetch;
};

beforeEach(() => {
  vi.clearAllMocks();
  setFetch({ ok: true, json: async () => ({ leads: [], imported: 0 }) });
});

describe("<LeadInbox> empty state", () => {
  it("explains what will appear and how", () => {
    render(<LeadInbox businessName="Solaride" initialLeads={[]} metaReady />);
    expect(screen.getByText("No leads yet")).toBeInTheDocument();
    expect(screen.getByText(/they’ll show up here/i)).toBeInTheDocument();
  });

  it("hides the digest card when there is nothing to share", () => {
    render(<LeadInbox businessName="Solaride" initialLeads={[]} metaReady />);
    expect(screen.queryByText("WhatsApp digest")).toBeNull();
  });
});

describe("<LeadInbox> Meta readiness", () => {
  it("warns and hides syncing when Meta isn't connected", () => {
    render(
      <LeadInbox businessName="Solaride" initialLeads={[]} metaReady={false} />,
    );
    expect(screen.getByText(/meta isn’t configured/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sync leads/i })).toBeNull();
  });

  it("offers syncing once Meta is connected", () => {
    render(<LeadInbox businessName="Solaride" initialLeads={[]} metaReady />);
    expect(screen.getByRole("button", { name: /sync leads/i })).toBeInTheDocument();
  });
});

describe("<LeadInbox> table", () => {
  it("lists each lead's contact details", () => {
    render(
      <LeadInbox businessName="Solaride" initialLeads={[lead()]} metaReady />,
    );
    expect(screen.getByText("Asha Verma")).toBeInTheDocument();
    expect(screen.getByText("+919876543210")).toBeInTheDocument();
    expect(screen.getByText("Jaipur")).toBeInTheDocument();
    expect(screen.getByText("Rooftop solar enquiry")).toBeInTheDocument();
  });

  it("counts the leads in the heading", () => {
    render(
      <LeadInbox
        businessName="Solaride"
        initialLeads={[lead(), lead({ id: "l2", meta_lead_id: "m2" })]}
        metaReady
      />,
    );
    expect(screen.getByText("(2)")).toBeInTheDocument();
  });

  it("renders a stable date for a lead with no timestamp", () => {
    render(
      <LeadInbox
        businessName="Solaride"
        initialLeads={[lead({ created_time: null })]}
        metaReady
      />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("<LeadInbox> syncing", () => {
  it("pulls new leads and reports how many arrived", async () => {
    setFetch({
      ok: true,
      json: async () => ({ leads: [lead(), lead({ id: "l2", meta_lead_id: "m2", full_name: "Ravi K" })], imported: 2 }),
    });
    render(<LeadInbox businessName="Solaride" initialLeads={[]} metaReady />);

    fireEvent.click(screen.getByRole("button", { name: /sync leads/i }));

    expect(await screen.findByText("Synced 2 leads from Meta.")).toBeInTheDocument();
    expect(screen.getByText("Ravi K")).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith("/api/leads/sync", { method: "POST" });
  });

  it("says you're up to date when nothing new came back", async () => {
    render(<LeadInbox businessName="Solaride" initialLeads={[lead()]} metaReady />);
    fireEvent.click(screen.getByRole("button", { name: /sync leads/i }));
    expect(
      await screen.findByText("You're up to date — no new leads."),
    ).toBeInTheDocument();
  });

  it("surfaces a server error instead of silently failing", async () => {
    setFetch({ ok: false, json: async () => ({ error: "Meta is not configured" }) });
    render(<LeadInbox businessName="Solaride" initialLeads={[]} metaReady />);
    fireEvent.click(screen.getByRole("button", { name: /sync leads/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Meta is not configured",
    );
  });

  it("handles a dropped connection", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
    render(<LeadInbox businessName="Solaride" initialLeads={[]} metaReady />);
    fireEvent.click(screen.getByRole("button", { name: /sync leads/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /check your connection/i,
    );
  });

  it("disables the button while a sync is in flight", async () => {
    let release!: (v: unknown) => void;
    global.fetch = vi.fn(
      () => new Promise((r) => (release = r)),
    ) as unknown as typeof fetch;

    render(<LeadInbox businessName="Solaride" initialLeads={[]} metaReady />);
    const btn = screen.getByRole("button", { name: /sync leads/i });
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toBeDisabled());

    release({ ok: true, json: async () => ({ leads: [], imported: 0 }) });
    await waitFor(() => expect(btn).not.toBeDisabled());
  });
});

describe("<LeadInbox> WhatsApp digest", () => {
  it("shows a shareable digest and a WhatsApp link", () => {
    render(<LeadInbox businessName="Solaride" initialLeads={[lead()]} metaReady />);
    expect(screen.getByText("WhatsApp digest")).toBeInTheDocument();
    const share = screen.getByRole("link", { name: /share on whatsapp/i });
    expect(share).toHaveAttribute("target", "_blank");
    expect(share.getAttribute("href")).toContain("https://wa.me/?text=");
    // Never open a new tab without severing the opener reference.
    expect(share).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("copies the digest to the clipboard and confirms", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<LeadInbox businessName="Solaride" initialLeads={[lead()]} metaReady />);
    fireEvent.click(screen.getByRole("button", { name: /^copy$/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(writeText.mock.calls[0][0]).toContain("Solaride");
    expect(await screen.findByRole("button", { name: /copied/i })).toBeInTheDocument();
  });
});
