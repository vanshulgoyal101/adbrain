// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  const response = impl as { ok: boolean; json: () => Promise<{ leads?: Lead[] }> };
  global.fetch = vi.fn(async (url: string) => {
    if (!url.startsWith("/api/leads?")) return impl;
    const data = await response.json();
    const params = new URL(url, "http://localhost").searchParams;
    const query = params.get("query")?.toLowerCase() ?? "";
    const contact = params.get("contact");
    const leads = (data.leads ?? []).filter(row => {
      const ready = Boolean(row.phone?.trim() || row.email?.trim());
      return (!query || [row.full_name, row.email, row.phone, row.city, row.form_name].some(value => value?.toLowerCase().includes(query))) &&
        (contact === "all" || ready === (contact === "ready"));
    });
    return { ok: response.ok, json: async () => ({ leads, total: leads.length, nextCursor: null }) };
  }) as unknown as typeof fetch;
};

beforeEach(() => {
  vi.clearAllMocks();
  setFetch({ ok: true, json: async () => ({ leads: [], imported: 0, sync: { id: "sync-1", state: "complete", hasMore: false } }) });
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
  it("searches contact and source details on the server and clears an empty result", async () => {
    setFetch({ ok: true, json: async () => ({ leads: [lead(), lead({ id: "l2", full_name: "Ravi Shah", email: "ravi@example.com", city: "Pune" })] }) });
    render(<LeadInbox businessName="Form Studio" initialLeads={[lead(), lead({ id: "l2", full_name: "Ravi Shah", email: "ravi@example.com", city: "Pune" })]} metaReady />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search enquiries" }), { target: { value: "ravi@" } });
    expect(await screen.findByText("Ravi Shah")).toBeInTheDocument();
    expect(screen.queryByText("Asha Verma")).toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search enquiries" }), { target: { value: "no-match-123" } });
    expect(await screen.findByRole("heading", { name: "No matching enquiries" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(await screen.findByText("Asha Verma")).toBeInTheDocument();
    expect(screen.getByText("Ravi Shah")).toBeInTheDocument();
  });

  it("filters missing contact details using the matching saved-record count", async () => {
    setFetch({ ok: true, json: async () => ({ leads: [lead(), lead({ id: "l2", full_name: "Ravi Shah", phone: null, email: null })] }) });
    render(<LeadInbox businessName="Form Studio" initialLeads={[lead(), lead({ id: "l2", full_name: "Ravi Shah", phone: null, email: null })]} metaReady />);
    fireEvent.change(screen.getByRole("combobox", { name: "Contact availability" }), { target: { value: "missing" } });
    expect(screen.queryByText("Asha Verma")).toBeNull();
    expect(await screen.findByText("Ravi Shah")).toBeInTheDocument();
    expect(screen.getByText("Matching responses").nextSibling).toHaveTextContent("1");
    expect(screen.getByRole("status")).toHaveTextContent("1 of 1 enquiries");
  });

  it("keeps the full digest collapsed until requested", () => {
    const { container } = render(<LeadInbox businessName="Form Studio" initialLeads={[lead()]} metaReady />);
    expect(container.querySelector("details")).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("WhatsApp digest"));
    expect(container.querySelector("details")).toHaveAttribute("open");
  });

  it("summarises responses, contactability, and represented areas", () => {
    render(
      <LeadInbox
        businessName="Solaride"
        initialLeads={[
          lead(),
          lead({ id: "l2", meta_lead_id: "m2", phone: null, email: null }),
          lead({ id: "l3", meta_lead_id: "m3", city: "Ajmer" }),
        ]}
        metaReady
      />,
    );
    expect(screen.getByText("Total responses").nextSibling).toHaveTextContent("3");
    expect(screen.getByText("Loaded with contact").nextSibling).toHaveTextContent("2");
    expect(screen.getByText("Loaded areas").nextSibling).toHaveTextContent("2");
  });

  it("lists each lead's contact details", () => {
    render(
      <LeadInbox businessName="Solaride" initialLeads={[lead()]} metaReady />,
    );
    expect(screen.getByText("Asha Verma")).toBeInTheDocument();
    expect(screen.getByText("+919876543210")).toBeInTheDocument();
    expect(screen.getByText("Jaipur")).toBeInTheDocument();
    expect(screen.getByText("Rooftop solar enquiry")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "asha@example.com" })).toHaveAttribute("href", "mailto:asha@example.com");
  });

  it("makes an email-only enquiry actionable", () => {
    render(<LeadInbox businessName="Form Studio" initialLeads={[lead({ phone: null })]} metaReady />);
    expect(screen.getByText("Loaded with contact").nextSibling).toHaveTextContent("1");
    expect(screen.getByRole("link", { name: "asha@example.com" })).toHaveAttribute("href", "mailto:asha@example.com");
    expect(screen.getByRole("columnheader", { name: "Contact" })).toBeInTheDocument();
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
  it("warns about a partial sync instead of claiming all leads are up to date", async () => {
    setFetch({ ok: true, json: async () => ({ leads: [lead()], imported: 0, failedForms: [{ id: "f2", name: "Restricted form" }] }) });
    render(<LeadInbox businessName="Solaride" initialLeads={[lead()]} metaReady />);
    fireEvent.click(screen.getByRole("button", { name: /sync leads/i }));
    expect(await screen.findByText(/Sync incomplete\. Could not read: Restricted form/)).toBeInTheDocument();
    expect(screen.queryByText(/You're up to date/)).toBeNull();
    expect(screen.getByText("Asha Verma")).toBeInTheDocument();
  });

  it("retains the inbox when the server cannot reload saved leads", async () => {
    setFetch({ ok: false, json: async () => ({ error: "Could not reload saved leads." }) });
    render(<LeadInbox businessName="Solaride" initialLeads={[lead()]} metaReady />);
    fireEvent.click(screen.getByRole("button", { name: /sync leads/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reload saved leads.");
    expect(screen.getByText("Asha Verma")).toBeInTheDocument();
  });

  it("pulls new leads and reports how many arrived", async () => {
    setFetch({
      ok: true,
      json: async () => ({ leads: [lead(), lead({ id: "l2", meta_lead_id: "m2", full_name: "Ravi K" })], imported: 2 }),
    });
    render(<LeadInbox businessName="Solaride" initialLeads={[]} metaReady />);

    fireEvent.click(screen.getByRole("button", { name: /sync leads/i }));

    expect(await screen.findByText("Synced 2 leads from Meta.")).toBeInTheDocument();
    expect(await screen.findByText("Ravi K")).toBeInTheDocument();
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
    expect(screen.getByText("Loaded enquiries · Last 7 days · Up to 10 contacts")).toBeInTheDocument();
    fireEvent.click(screen.getByText("WhatsApp digest"));
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
    fireEvent.click(screen.getByText("WhatsApp digest"));
    fireEvent.click(screen.getByRole("button", { name: /^copy$/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(writeText.mock.calls[0][0]).toContain("Solaride");
    expect(await screen.findByRole("button", { name: /copied/i })).toBeInTheDocument();
  });
});

describe("<LeadInbox> saved enquiry workflow", () => {
  it("keeps SSR totals, pages beyond the first batch and deduplicates rows", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      leads: [lead(), lead({ id: "later", full_name: "Beyond two hundred" })], total: 225, nextCursor: null,
    }) });
    vi.stubGlobal("fetch", fetcher);
    render(<LeadInbox businessName="Fixture" initialLeads={[lead()]} initialTotal={225} initialNextCursor="page-2" metaReady={false} />);
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("1 of 225 enquiries");
    fireEvent.click(screen.getByRole("button", { name: "Load more enquiries" }));
    expect(await screen.findByText("Beyond two hundred")).toBeInTheDocument();
    expect(screen.getAllByText("Asha Verma")).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("cursor=page-2"), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(screen.getByRole("status")).toHaveTextContent("2 of 225 enquiries");
  });

  it("retains failed save edits, then persists status and note across reload", async () => {
    let stored = lead({ workflow_status: "new", follow_up_note: "Confirmed note" });
    let failSave = true;
    const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === "PATCH") {
        if (failSave) return { ok: false, json: async () => ({ error: "Unavailable" }) };
        stored = { ...stored, ...JSON.parse(String(options.body)) };
        return { ok: true, json: async () => ({ lead: stored }) };
      }
      return { ok: true, json: async () => ({ leads: [stored], total: 1, nextCursor: null }) };
    });
    vi.stubGlobal("fetch", fetcher);
    const view = render(<LeadInbox businessName="Fixture" initialLeads={[stored]} metaReady />);
    fireEvent.click(screen.getByRole("button", { name: "Follow up Asha Verma" }));
    fireEvent.change(screen.getByLabelText("Follow-up status"), { target: { value: "booked" } });
    fireEvent.change(screen.getByLabelText("Follow-up note"), { target: { value: "Friday appointment" } });
    fireEvent.click(screen.getByRole("button", { name: "Save follow-up" }));
    expect(await screen.findByText(/Your edits are still here/)).toBeInTheDocument();
    expect(screen.getByLabelText("Follow-up note")).toHaveValue("Friday appointment");
    expect(stored.follow_up_note).toBe("Confirmed note");
    failSave = false;
    fireEvent.click(screen.getByRole("button", { name: "Save follow-up" }));
    expect(await screen.findByText("Follow-up saved.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Follow up Asha Verma" })).toHaveTextContent("booked"));
    view.unmount();
    render(<LeadInbox businessName="Fixture" initialLeads={[stored]} metaReady />);
    fireEvent.click(screen.getByRole("button", { name: "Follow up Asha Verma" }));
    expect(screen.getByLabelText("Follow-up note")).toHaveValue("Friday appointment");
    expect(screen.getByLabelText("Follow-up status")).toHaveValue("booked");
    expect(fetcher.mock.calls.filter(([, options]) => options?.method === "PATCH")).toHaveLength(2);
  });

  it("refreshes the filtered list after partial sync and resumes without replacing it with sync rows", async () => {
    let syncCalls = 0;
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (url === "/api/leads/sync") {
        syncCalls++;
        if (syncCalls === 2) expect(JSON.parse(String(options?.body))).toEqual({ syncId: "continuation-1" });
        return { ok: true, json: async () => ({ leads: [lead({ id: "not-the-list", full_name: "Partial response only" })], imported: 0,
          sync: { id: "continuation-1", state: syncCalls === 1 ? "partial" : "complete", hasMore: syncCalls === 1 } }) };
      }
      return { ok: true, json: async () => ({ leads: [lead({ workflow_status: "booked" })], total: 1, nextCursor: null }) };
    });
    vi.stubGlobal("fetch", fetcher);
    render(<LeadInbox businessName="Fixture" initialLeads={[lead()]} metaReady />);
    fireEvent.change(screen.getByLabelText("Workflow status"), { target: { value: "booked" } });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 of 1"));
    fireEvent.click(screen.getByRole("button", { name: "Sync leads" }));
    expect(await screen.findByText(/Sync incomplete/)).toBeInTheDocument();
    expect(screen.queryByText(/You're up to date/)).toBeNull();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 of 1"));
    expect(screen.queryByText("Partial response only")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Resume sync" }));
    expect(await screen.findByText("You're up to date — no new leads.")).toBeInTheDocument();
    expect(fetcher.mock.calls.filter(([url]) => url.startsWith("/api/leads?")).every(([url]) => url.includes("status=booked"))).toBe(true);
  });

  it("does not infer complete sync from a legacy response", async () => {
    setFetch({ ok: true, json: async () => ({ leads: [], imported: 0 }) });
    render(<LeadInbox businessName="Fixture" initialLeads={[]} metaReady />);
    fireEvent.click(screen.getByRole("button", { name: "Sync leads" }));
    expect(await screen.findByText("Sync finished. Completion could not be verified.")).toBeInTheDocument();
    expect(screen.queryByText(/You're up to date/)).toBeNull();
  });

  it("aborts old searches and ignores responses that arrive after replacement", async () => {
    let resolveOld!: (value: unknown) => void;
    let oldSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((url: string, options: RequestInit) => {
      if (url.includes("query=old")) {
        oldSignal = options.signal as AbortSignal;
        return new Promise(resolve => { resolveOld = resolve; });
      }
      return Promise.resolve({ ok: true, json: async () => ({ leads: [lead({ full_name: "Current result" })], total: 1, nextCursor: null }) });
    }));
    render(<LeadInbox businessName="Fixture" initialLeads={[lead()]} metaReady={false} />);
    fireEvent.change(screen.getByLabelText("Search enquiries"), { target: { value: "old" } });
    await waitFor(() => expect(oldSignal).toBeDefined());
    fireEvent.change(screen.getByLabelText("Search enquiries"), { target: { value: "current" } });
    expect(oldSignal?.aborted).toBe(true);
    expect(await screen.findByText("Current result")).toBeInTheDocument();
    await act(async () => resolveOld({ ok: true, json: async () => ({ leads: [lead({ full_name: "Stale result" })], total: 1, nextCursor: null }) }));
    expect(screen.queryByText("Stale result")).toBeNull();
  });

  it("keeps loaded rows after a failed page and retries only on request", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetcher);
    render(<LeadInbox businessName="Fixture" initialLeads={[lead()]} initialTotal={225} initialNextCursor="next" metaReady />);
    fireEvent.click(screen.getByRole("button", { name: "Load more enquiries" }));
    expect(await screen.findByRole("button", { name: "Retry list" })).toBeInTheDocument();
    expect(screen.getByText("Asha Verma")).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValue({ ok: true, json: async () => ({ leads: [lead()], total: 225, nextCursor: "next" }) });
    fireEvent.click(screen.getByRole("button", { name: "Retry list" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Retry list" })).toBeNull());
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
