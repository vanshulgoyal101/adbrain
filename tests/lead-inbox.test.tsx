// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  localStorage.clear();
  setFetch({ ok: true, json: async () => ({ leads: [], imported: 0, sync: { id: "sync-1", state: "complete", hasMore: false } }) });
});

// #1597 (Designer, #1463): with no enquiries anywhere, one block replaces banner, count, tabs, search and card.
describe("<LeadInbox> nothing yet (#1597)", () => {
  it("not connected: one line and a solid Connect Meta, no banner, count, tabs or search", () => {
    render(<LeadInbox businessName="Solaride" initialLeads={[]} metaReady={false} chatsEmpty allTotal={0} />);
    expect(screen.getByRole("heading", { name: "No enquiries yet" })).toBeInTheDocument();
    expect(screen.getByText("Connect your Facebook Page to run ads. Enquiries from them show up here.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect Facebook Page" })).toHaveAttribute("href", "/settings");
    expect(screen.queryByText(/Meta isn’t connected/)).toBeNull();
    expect(screen.queryByRole("group", { name: "Show" })).toBeNull();
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByText(/\(0\)/)).toBeNull();
  });

  it("connected: offers the WhatsApp alert, else See your campaigns (outline)", () => {
    const { unmount } = render(<LeadInbox businessName="Solaride" initialLeads={[]} metaReady offerAlerts chatsEmpty allTotal={0} />);
    expect(screen.getByText("Enquiries from your ads show up here: form enquiries on their own, WhatsApp chats when you add them. Reply fast: people often pick the first business that answers.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Get a WhatsApp alert for form enquiries" })).toHaveAttribute("href", "/settings#whatsapp-alerts-title");
    unmount();
    render(<LeadInbox businessName="Solaride" initialLeads={[]} metaReady chatsEmpty allTotal={0} />);
    expect(screen.getByRole("link", { name: "See your campaigns" })).toHaveClass("border");
  });

  it("'Add an enquiry' is a text link that opens the WhatsApp campaign's form", () => {
    render(<LeadInbox businessName="Solaride" initialLeads={[]} metaReady chatsEmpty allTotal={0} addEnquiryFor={{ campaignId: "c1", spend: 0, enquiries: 0 }} />);
    expect(screen.queryByRole("button", { name: /Got a customer/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add an enquiry" }));
    expect(screen.getByRole("button", { name: /Got a customer/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No enquiries yet" })).toBeInTheDocument();
  });

  it("#1810: with only Meta's test lead, Waiting keeps the tabs and says nobody is waiting", async () => {
    const test = lead({ full_name: "<test lead: dummy data for full_name>", phone: null, email: null });
    render(<LeadInbox businessName="Solaride" initialLeads={[test]} initialTotal={0} metaReady chatsEmpty allTotal={0} summary={{ waiting: 0, replyMinutes: null }} />);
    expect(screen.getByText("Test enquiry from Meta")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Waiting" }));
    expect(await screen.findByRole("heading", { name: "Nobody is waiting." })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "No enquiries yet" })).toBeNull();
    expect(screen.getByRole("group", { name: "Show" })).toBeInTheDocument();
  });

  it("keeps the full inbox when WhatsApp chats exist", () => {
    render(<LeadInbox businessName="Solaride" initialLeads={[]} metaReady allTotal={0} />);
    expect(screen.queryByRole("heading", { name: "No enquiries yet" })).toBeNull();
    expect(screen.getByRole("group", { name: "Show" })).toBeInTheDocument();
  });
});

describe("<LeadInbox> empty state", () => {
  // #1260 (CPO words, Designer): one action, and never one the owner can't take.
  it("explains what will appear and offers See your campaigns while alerts can't be turned on", () => {
    render(<LeadInbox businessName="Solaride" initialLeads={[]} metaReady />);
    expect(screen.getByText("No enquiries yet. When someone fills your form or messages you on WhatsApp from an ad, they'll show up here.")).toBeInTheDocument();
    expect(screen.getByText("Reply fast: people often go with the first business that answers.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See your campaigns" })).toHaveAttribute("href", "/campaigns");
    expect(screen.queryByRole("link", { name: /WhatsApp alert/ })).toBeNull();
  });

  it("offers a WhatsApp alert for each enquiry when alerts can be turned on", () => {
    render(<LeadInbox businessName="Solaride" initialLeads={[]} metaReady offerAlerts />);
    expect(screen.getByRole("link", { name: "Get a WhatsApp alert for each enquiry" })).toHaveAttribute("href", "/settings#whatsapp-alerts-title");
    expect(screen.queryByRole("link", { name: "See your campaigns" })).toBeNull();
  });

  it("has no WhatsApp digest, with or without enquiries (#1260: alerts are #701)", () => {
    const view = render(<LeadInbox businessName="Solaride" initialLeads={[]} metaReady />);
    expect(screen.queryByText("WhatsApp digest")).toBeNull();
    view.rerender(<LeadInbox businessName="Solaride" initialLeads={[lead()]} metaReady />);
    expect(screen.queryByText("WhatsApp digest")).toBeNull();
    expect(screen.queryByRole("link", { name: /share on whatsapp/i })).toBeNull();
  });
});

describe("<LeadInbox> Meta readiness", () => {
  it("warns and hides syncing when Meta isn't connected", () => {
    render(
      <LeadInbox businessName="Solaride" initialLeads={[]} metaReady={false} />,
    );
    expect(screen.getByText(/meta isn’t connected/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /check now/i })).toBeNull();
  });

  it("offers a quiet Check now and the last update time once Meta is connected (#1260)", () => {
    localStorage.setItem("lead-sync:owner:b1", String(Date.now() - 5 * 60_000));
    render(<LeadInbox businessName="Solaride" initialLeads={[]} metaReady syncScope="owner:b1" />);
    expect(screen.getByRole("button", { name: "Check now" })).toBeInTheDocument();
    expect(screen.getByText("Updated 5m ago")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /check for enquiries/i })).toBeNull();
  });
});

describe("<LeadInbox> table", () => {
  it("keeps Clear search in the keyboard order and clears the query", async () => {
    render(<LeadInbox businessName="Form Studio" initialLeads={[]} metaReady={false} />);
    const search = screen.getByRole("searchbox", { name: "Search enquiries" });
    await userEvent.type(search, "Asha");
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Clear search" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(search).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();
  });

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
    expect(screen.getByRole("status")).toHaveTextContent("1 of 1 enquiries");
  });

  it("shows Meta's test lead as a test, not as placeholder text (#403)", () => {
    render(<LeadInbox businessName="Solaride" initialLeads={[lead({ full_name: "<test lead: dummy data for full_name>", city: "<test lead: dummy data for city>", phone: "<test lead: dummy data for phone_number>", email: null })]} metaReady />);
    expect(screen.getByText("Test enquiry from Meta")).toBeInTheDocument();
    expect(screen.queryByText(/dummy data/)).toBeNull();
    expect(screen.getByRole("button", { name: /^Follow up Test enquiry from Meta,/ })).toBeInTheDocument();
  });

  it("#1149: Meta's test lead is listed but not counted, so the title matches Home's 0", () => {
    render(<LeadInbox businessName="Solaride" initialLeads={[lead({ full_name: "<test lead: dummy data for full_name>", phone: "<test lead: dummy data for phone_number>", email: null })]} metaReady />);
    expect(screen.getByRole("heading", { name: "Enquiries (0)" })).toBeInTheDocument();
    expect(screen.getByText("Test enquiry from Meta")).toBeInTheDocument();
    expect(screen.queryByText(/of 0 enquiries/)).toBeNull();
  });

  it("has no internal 'Loaded …' stats (#403)", () => {
    render(<LeadInbox businessName="Solaride" initialLeads={[lead(), lead({ id: "l2", meta_lead_id: "m2" })]} metaReady />);
    expect(screen.queryByText("Loaded with contact")).toBeNull();
    expect(screen.queryByText("Loaded areas")).toBeNull();
    expect(screen.queryByText("Total responses")).toBeNull();
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

  it("labels an enquiry the owner added from WhatsApp chats (#335)", () => {
    render(<LeadInbox businessName="Solaride" initialLeads={[lead({ source: "whatsapp_manual", meta_lead_id: null, form_id: null, form_name: null })]} metaReady />);
    expect(screen.getByText("WhatsApp chat (added by you)")).toBeInTheDocument();
  });

  it("makes an email-only enquiry actionable", () => {
    render(<LeadInbox businessName="Form Studio" initialLeads={[lead({ phone: null })]} metaReady />);
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
  it("renders saved enquiries while syncing a stale connected Page in the background", async () => {
    const key = "lead-sync:owner:b1";
    const previous = String(Date.now() - 16 * 60_000);
    localStorage.setItem(key, previous);
    let complete!: (response: Response) => void;
    const fetcher = vi.fn((url: string) => url === "/api/leads/sync"
      ? new Promise<Response>(resolve => { complete = resolve; })
      : Promise.resolve(Response.json({ leads: [lead()], total: 1, nextCursor: null })));
    vi.stubGlobal("fetch", fetcher);
    render(<LeadInbox businessName="Solaride" initialLeads={[lead()]} metaReady syncScope="owner:b1" />);
    expect(screen.getByText("Asha Verma")).toBeInTheDocument();
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/leads/sync", { method: "POST" }));
    expect(localStorage.getItem(key)).toBe(previous);
    await act(async () => complete(Response.json({ leads: [lead()], imported: 0, sync: { id: "run-1", state: "complete", hasMore: false } })));
    expect(await screen.findByText("Updated just now")).toBeInTheDocument();
    expect(screen.queryByText(/Up to date/)).toBeNull();
    expect(Number(localStorage.getItem(key))).toBeGreaterThan(Date.now() - 60_000);
  });

  it("skips recent syncs but checks a newly bound Meta Page", async () => {
    localStorage.setItem("lead-sync:owner:b1:act:page-a", String(Date.now() - 60_000));
    const fetcher = vi.fn(async () => Response.json({ leads: [], imported: 0, sync: { id: "run-2", state: "complete", hasMore: false } }));
    vi.stubGlobal("fetch", fetcher);
    const recent = render(<LeadInbox businessName="Solaride" initialLeads={[]} metaReady syncScope="owner:b1:act:page-a" />);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(fetcher).not.toHaveBeenCalled();
    recent.unmount();
    render(<LeadInbox businessName="Solaride" initialLeads={[]} metaReady syncScope="owner:b1:act:page-b" />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/leads/sync", { method: "POST" }));
  });

  it.each([
    [502, { error: "Could not read all forms", leads: [], imported: 0, sync: { id: "run-3", state: "partial", hasMore: true } }],
    [200, { leads: [], imported: 1, sync: { id: "run-4", state: "partial", hasMore: true } }],
  ])("does not mark a failed or partial background sync as fresh (HTTP %s)", async (statusCode, body) => {
    const key = "lead-sync:owner:b1";
    localStorage.setItem(key, String(Date.now() - 16 * 60_000));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "/api/leads/sync"
      ? Response.json(body, { status: statusCode })
      : Response.json({ leads: [], total: 0, nextCursor: null })));
    render(<LeadInbox businessName="Solaride" initialLeads={[]} metaReady syncScope="owner:b1" />);
    expect(await screen.findByText(/so far/)).toBeInTheDocument();
    expect(Number(localStorage.getItem(key))).toBeLessThan(Date.now() - 15 * 60_000);
    expect(screen.getByRole("button", { name: "Keep checking" })).toBeInTheDocument();
  });

  it("warns about a partial sync instead of claiming all leads are up to date", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "/api/leads/sync"
      ? { ok: false, status: 502, json: async () => ({ leads: [lead()], imported: 1, failedForms: [{ id: "f2", name: "Restricted form" }],
        sync: { id: "sync-1", state: "partial", hasMore: true } }) }
      : { ok: true, json: async () => ({ leads: [lead()], total: 1, nextCursor: null }) }));
    render(<LeadInbox businessName="Solaride" initialLeads={[lead()]} metaReady />);
    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    expect(await screen.findByText(/Couldn't read: Restricted form/)).toBeInTheDocument();
    expect(screen.queryByText(/You're up to date/)).toBeNull();
    expect(screen.getByText("Asha Verma")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep checking" })).toBeInTheDocument();
    expect(screen.queryByText(/Enquiries could not be loaded/)).toBeNull();
  });

  it("retains the inbox when the server cannot reload saved leads", async () => {
    setFetch({ ok: false, json: async () => ({ error: "Could not reload saved leads." }) });
    render(<LeadInbox businessName="Solaride" initialLeads={[lead()]} metaReady />);
    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reload saved leads.");
    expect(screen.getByText("Asha Verma")).toBeInTheDocument();
  });

  it("pulls new leads and reports how many arrived", async () => {
    setFetch({
      ok: true,
      json: async () => ({ leads: [lead(), lead({ id: "l2", meta_lead_id: "m2", full_name: "Ravi K" })], imported: 2 }),
    });
    render(<LeadInbox businessName="Solaride" initialLeads={[]} metaReady />);

    fireEvent.click(screen.getByRole("button", { name: "Check now" }));

    expect(await screen.findByText("2 new enquiries from Meta.")).toBeInTheDocument();
    expect(await screen.findByText("Ravi K")).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith("/api/leads/sync", { method: "POST" });
  });

  it("says only 'Updated just now' when a complete check found nothing new (#1260)", async () => {
    setFetch({ ok: true, json: async () => ({ leads: [lead()], imported: 0, sync: { id: "run-5", state: "complete", hasMore: false } }) });
    render(<LeadInbox businessName="Solaride" initialLeads={[lead()]} metaReady />);
    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    expect(await screen.findByText("Updated just now")).toBeInTheDocument();
    expect(screen.queryByText(/Up to date|No new enquiries/)).toBeNull();
  });

  it("surfaces a server error instead of silently failing", async () => {
    setFetch({ ok: false, json: async () => ({ error: "Meta is not configured" }) });
    render(<LeadInbox businessName="Solaride" initialLeads={[]} metaReady />);
    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Meta is not configured",
    );
  });

  it("handles a dropped connection", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
    render(<LeadInbox businessName="Solaride" initialLeads={[]} metaReady />);
    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
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
    const btn = screen.getByRole("button", { name: "Check now" });
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toBeDisabled());

    release({ ok: true, json: async () => ({ leads: [], imported: 0 }) });
    await waitFor(() => expect(btn).not.toBeDisabled());
  });
});

describe("<LeadInbox> saved enquiry workflow", () => {
  it("keeps two unsaved drafts separate and returns focus after closing", () => {
    const second = lead({ id: "l2", meta_lead_id: "m2", full_name: "Ravi Shah", follow_up_note: "Other" });
    render(<LeadInbox businessName="Fixture" initialLeads={[lead(), second]} metaReady={false} />);
    fireEvent.click(screen.getByRole("button", { name: /^Follow up Asha Verma,/ }));
    expect(screen.getByLabelText("Follow-up status")).toHaveFocus();
    fireEvent.change(screen.getByLabelText("Follow-up note"), { target: { value: "Call Asha" } });
    fireEvent.click(screen.getByRole("button", { name: /^Follow up Ravi Shah,/ }));
    expect(screen.getByLabelText("Follow-up note")).toHaveValue("Other");
    expect(screen.getByLabelText("Follow-up status")).toHaveFocus();
    fireEvent.change(screen.getByLabelText("Follow-up note"), { target: { value: "Call Ravi" } });
    fireEvent.click(screen.getByRole("button", { name: "Close follow-up" }));
    expect(screen.getByRole("button", { name: /^Follow up Ravi Shah,/ })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: /^Follow up Asha Verma,/ }));
    expect(screen.getByLabelText("Follow-up note")).toHaveValue("Call Asha");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Follow up Ravi Shah,/ }));
    expect(screen.getByLabelText("Follow-up note")).toHaveValue("Call Ravi");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("keeps a failed-save draft with its enquiry across switching and closing", async () => {
    const first = lead({ workflow_status: "new", follow_up_note: "Original" });
    const second = lead({ id: "l2", meta_lead_id: "m2", full_name: "Ravi Shah", follow_up_note: "Other" });
    const fetcher = vi.fn(async (_url: string, options?: RequestInit) => options?.method === "PATCH"
      ? { ok: false, json: async () => ({ error: "Unavailable" }) }
      : { ok: true, json: async () => ({ leads: [first, second], total: 2, nextCursor: null }) });
    vi.stubGlobal("fetch", fetcher);
    render(<LeadInbox businessName="Fixture" initialLeads={[first, second]} metaReady={false} />);
    fireEvent.click(screen.getByRole("button", { name: /^Follow up Asha Verma,/ }));
    fireEvent.change(screen.getByLabelText("Follow-up status"), { target: { value: "booked" } });
    fireEvent.change(screen.getByLabelText("Follow-up note"), { target: { value: "Friday appointment" } });
    fireEvent.click(screen.getByRole("button", { name: "Save follow-up" }));
    expect(await screen.findByText(/Your edits are still here/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Follow up Ravi Shah,/ }));
    expect(screen.getByLabelText("Follow-up note")).toHaveValue("Other");
    fireEvent.click(screen.getByRole("button", { name: "Close follow-up" }));
    fireEvent.click(screen.getByRole("button", { name: /^Follow up Asha Verma,/ }));
    expect(screen.getByLabelText("Follow-up status")).toHaveValue("booked");
    expect(screen.getByLabelText("Follow-up note")).toHaveValue("Friday appointment");
    expect(fetcher.mock.calls.filter(([, options]) => options?.method === "PATCH")).toHaveLength(1);
  });

  it("forgets a cached draft after reverting to the saved values", () => {
    const first = lead({ follow_up_note: "Original" });
    const second = lead({ id: "l2", meta_lead_id: "m2", full_name: "Ravi Shah" });
    render(<LeadInbox businessName="Fixture" initialLeads={[first, second]} metaReady={false} />);
    fireEvent.click(screen.getByRole("button", { name: /^Follow up Asha Verma,/ }));
    fireEvent.change(screen.getByLabelText("Follow-up note"), { target: { value: "Temporary" } });
    fireEvent.click(screen.getByRole("button", { name: /^Follow up Ravi Shah,/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Follow up Asha Verma,/ }));
    expect(screen.getByLabelText("Follow-up note")).toHaveValue("Temporary");
    fireEvent.change(screen.getByLabelText("Follow-up note"), { target: { value: "Original" } });
    fireEvent.click(screen.getByRole("button", { name: "Close follow-up" }));
    fireEvent.click(screen.getByRole("button", { name: /^Follow up Asha Verma,/ }));
    expect(screen.getByLabelText("Follow-up note")).toHaveValue("Original");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("holds the current editor while a save is in flight, then clears the saved draft", async () => {
    const first = lead({ workflow_status: "new", follow_up_note: "Original" });
    const second = lead({ id: "l2", meta_lead_id: "m2", full_name: "Ravi Shah" });
    let resolveSave!: (value: unknown) => void;
    const fetcher = vi.fn((_url: string, options?: RequestInit) => options?.method === "PATCH"
      ? new Promise(resolve => { resolveSave = resolve; })
      : Promise.resolve({ ok: true, json: async () => ({ leads: [first, second], total: 2, nextCursor: null }) }));
    vi.stubGlobal("fetch", fetcher);
    render(<LeadInbox businessName="Fixture" initialLeads={[first, second]} metaReady={false} />);
    fireEvent.click(screen.getByRole("button", { name: /^Follow up Asha Verma,/ }));
    fireEvent.change(screen.getByLabelText("Follow-up note"), { target: { value: "Saved after delay" } });
    fireEvent.click(screen.getByRole("button", { name: "Save follow-up" }));
    expect(screen.getByRole("button", { name: /^Follow up Ravi Shah,/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close follow-up" })).toBeDisabled();
    expect(screen.getByLabelText("Follow-up note")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /^Follow up Ravi Shah,/ }));
    expect(screen.getByRole("heading", { name: "Follow up: Asha Verma" })).toBeInTheDocument();
    await act(async () => resolveSave({ ok: true, json: async () => ({ lead: { ...first, follow_up_note: "Saved after delay" } }) }));
    expect(await screen.findByText("Follow-up saved.")).toBeInTheDocument();
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Follow up Ravi Shah,/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Follow up Asha Verma,/ }));
    expect(screen.getByLabelText("Follow-up note")).toHaveValue("Saved after delay");
    expect(fetcher.mock.calls.filter(([, options]) => options?.method === "PATCH")).toHaveLength(1);
  });

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
    fireEvent.click(screen.getByRole("button", { name: /^Follow up Asha Verma,/ }));
    fireEvent.change(screen.getByLabelText("Follow-up status"), { target: { value: "booked" } });
    fireEvent.change(screen.getByLabelText("Follow-up note"), { target: { value: "Friday appointment" } });
    fireEvent.click(screen.getByRole("button", { name: "Save follow-up" }));
    expect(await screen.findByText(/Your edits are still here/)).toBeInTheDocument();
    expect(screen.getByLabelText("Follow-up note")).toHaveValue("Friday appointment");
    expect(stored.follow_up_note).toBe("Confirmed note");
    failSave = false;
    fireEvent.click(screen.getByRole("button", { name: "Save follow-up" }));
    expect(await screen.findByText("Follow-up saved.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /^Follow up Asha Verma,/ })).toHaveTextContent("Booked"));
    view.unmount();
    render(<LeadInbox businessName="Fixture" initialLeads={[stored]} metaReady />);
    fireEvent.click(screen.getByRole("button", { name: /^Follow up Asha Verma,/ }));
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
    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    expect(await screen.findByText(/so far/)).toBeInTheDocument();
    expect(screen.queryByText(/You're up to date/)).toBeNull();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 of 1"));
    expect(screen.queryByText("Partial response only")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Keep checking" }));
    expect(await screen.findByText("Updated just now")).toBeInTheDocument();
    expect(fetcher.mock.calls.filter(([url]) => url.startsWith("/api/leads?")).every(([url]) => url.includes("status=booked"))).toBe(true);
  });

  it("QA discovers committed rows through explicit retry after a 503 without false completion", async () => {
    const confirmed = lead({ workflow_status: "qualified", follow_up_note: "Synthetic saved follow-up" });
    const committed = lead({ id: "committed", meta_lead_id: "m2", full_name: "Committed enquiry" });
    let syncCalls = 0;
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (url === "/api/leads/sync") {
        syncCalls++;
        expect(options?.body).toBeUndefined();
        return {
          ok: syncCalls > 1, status: syncCalls === 1 ? 503 : 200,
          json: async () => ({
            leads: [lead({ id: "snapshot-only", full_name: "Not the filtered list" })],
            imported: syncCalls === 1 ? 1 : 0,
            error: syncCalls === 1 ? "Could not save the next page. Retry to resume." : undefined,
            sync: { id: "11111111-1111-4111-8111-111111111111", state: syncCalls === 1 ? "partial" : "complete", hasMore: syncCalls === 1 },
          }),
        };
      }
      expect(url).toContain("contact=ready");
      const rows = syncCalls ? [confirmed, committed] : [confirmed];
      return { ok: true, json: async () => ({ leads: rows, total: rows.length, nextCursor: null }) };
    });
    vi.stubGlobal("fetch", fetcher);
    render(<LeadInbox businessName="Fixture" initialLeads={[confirmed]} metaReady />);
    fireEvent.change(screen.getByLabelText("Contact availability"), { target: { value: "ready" } });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 of 1"));
    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    expect(await screen.findByText("Could not save the next page. Retry to resume.")).toBeInTheDocument();
    expect(screen.getByText("Asha Verma")).toBeInTheDocument();
    expect(screen.queryByText(/You're up to date/)).toBeNull();
    expect(syncCalls).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    expect(await screen.findByText("Committed enquiry")).toBeInTheDocument();
    expect(screen.queryByText("Not the filtered list")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("2 of 2");
    expect(screen.getAllByText("Asha Verma")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /^Follow up Asha Verma,/ }));
    expect(screen.getByLabelText("Follow-up note")).toHaveValue("Synthetic saved follow-up");
    expect(screen.getByLabelText("Follow-up status")).toHaveValue("qualified");
    expect(syncCalls).toBe(2);
  });

  it("ignores a stale inbox read completed after a sync refresh", async () => {
    let resolveOld!: (value: unknown) => void;
    let oldSignal: AbortSignal | undefined;
    let reads = 0;
    const late = lead({ id: "late", meta_lead_id: "meta-late", full_name: "Late arrival", workflow_status: "contacted" });
    vi.stubGlobal("fetch", vi.fn((url: string, options: RequestInit) => {
      if (url === "/api/leads/sync") return Promise.resolve({ ok: true, json: async () => ({ leads: [late], imported: 1,
        sync: { id: "completed", state: "complete", hasMore: false } }) });
      if (++reads === 1) {
        oldSignal = options.signal as AbortSignal;
        return new Promise(resolve => { resolveOld = resolve; });
      }
      return Promise.resolve({ ok: true, json: async () => ({ leads: [late], total: 1, nextCursor: null }) });
    }));
    render(<LeadInbox businessName="Fixture" initialLeads={[lead()]} metaReady />);
    fireEvent.change(screen.getByLabelText("Search enquiries"), { target: { value: "Late" } });
    await waitFor(() => expect(oldSignal).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    expect(await screen.findByText("Late arrival")).toBeInTheDocument();
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => resolveOld({ ok: true, json: async () => ({ leads: [lead()], total: 1, nextCursor: null }) }));
    expect(screen.getByText("Late arrival")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Follow up Late arrival,/ })).toHaveTextContent("Contacted");
    expect(screen.queryByText("Asha Verma")).toBeNull();
  });

  it("does not infer complete sync from a legacy response", async () => {
    setFetch({ ok: true, json: async () => ({ leads: [], imported: 0 }) });
    render(<LeadInbox businessName="Fixture" initialLeads={[]} metaReady />);
    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    expect(await screen.findByText("Some enquiries on Meta couldn't be checked. The ones below are saved; tap Check now to try again.")).toBeInTheDocument();
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

describe("<LeadInbox> on a phone (#376)", () => {
  it("puts the three selects behind one Filter button that shows how many are set", async () => {
    const user = userEvent.setup();
    render(<LeadInbox businessName="Solaride" initialLeads={[lead()]} metaReady />);
    const toggle = screen.getByRole("button", { name: "Filter" });
    const filters = document.getElementById("enquiry-filters")!;
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(filters).not.toHaveAttribute("data-open");
    expect(filters).toContainElement(screen.getByLabelText("Sort enquiries"));
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(filters).toHaveAttribute("data-open");
    await user.selectOptions(screen.getByLabelText("Sort enquiries"), "oldest");
    expect(screen.getByRole("button", { name: "Filter, 1 set" })).toBeInTheDocument();
  });

  it("marks empty fields so the phone layout can hide them instead of showing a lone dash", () => {
    render(<LeadInbox businessName="Solaride" initialLeads={[lead({ phone: null, email: null, city: null })]} metaReady />);
    const row = screen.getAllByRole("row").at(-1)!;
    const blanks = row.querySelectorAll("td:not(:first-child) > span:not([aria-hidden])");
    expect([...blanks].map((el) => el.textContent)).toEqual(["—", "—"]);
  });

  // #798: one tap marks an enquiry "Became a customer"; Undo puts its old status back.
  it("marks an enquiry as a customer in one tap and undoes it", async () => {
    const asha = lead({ workflow_status: "contacted", follow_up_note: "Called" });
    const sent: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
      if (options?.method === "PATCH") {
        const body = JSON.parse(String(options.body)) as { workflow_status: string };
        sent.push({ url, body });
        return Response.json({ lead: { ...asha, workflow_status: body.workflow_status } });
      }
      return Response.json({ leads: [asha], total: 1, nextCursor: null });
    }));
    render(<LeadInbox businessName="Fixture" initialLeads={[asha]} metaReady={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Asha Verma became a customer" }));
    expect(await screen.findByText("Asha Verma became a customer.")).toBeInTheDocument();
    expect(sent).toEqual([{ url: "/api/leads/l1", body: { workflow_status: "customer" } }]);
    expect(screen.getByRole("button", { name: /^Follow up Asha Verma, status Customer$/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Asha Verma became a customer" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Asha Verma is back to contacted.")).toBeInTheDocument();
    expect(sent.at(-1)).toEqual({ url: "/api/leads/l1", body: { workflow_status: "contacted" } });
    expect(screen.getByRole("button", { name: /^Follow up Asha Verma, status Contacted$/ })).toBeInTheDocument();
  });

  // #1260: on phones each row says one state word and keeps when · city on one line; ⋯ holds Not interested and Edit.
  it("gives each row one state word and a when · city line", () => {
    render(<LeadInbox businessName="Fixture" initialLeads={[
      lead({ id: "a", meta_lead_id: "ma", full_name: "Asha Verma", city: "Jaipur" }),
      lead({ id: "b", meta_lead_id: "mb", full_name: "Ravi Kumar", created_time: "2026-08-20T10:00:00.000Z", first_contacted_at: "2026-08-20T10:04:00.000Z" }),
      lead({ id: "c", meta_lead_id: "mc", full_name: "Meena", created_time: "2026-08-20T10:00:00.000Z", first_contacted_at: "2026-08-22T11:00:00.000Z" }),
      lead({ id: "d", meta_lead_id: "md", full_name: "Kiran Shah", workflow_status: "customer" }),
    ]} metaReady={false} />);
    const rows = screen.getAllByRole("row").slice(1);
    const state = (index: number) => rows[index].querySelector("td:first-child > span:nth-child(3)")!.textContent;
    expect([state(0), state(1), state(2), state(3)]).toEqual(["New", "Contacted in 4 min", "Contacted after 2 days", "Customer"]);
    expect(rows[0].querySelector("td:first-child > span:first-child")).toHaveTextContent("AV");
    expect(rows[2].querySelector("td:first-child > span:first-child")).toHaveTextContent("M");
    expect(rows[0].querySelector("td:first-child > span:last-child")!.textContent).toMatch(/ · Jaipur$/);
  });

  it("marks an enquiry not interested from ⋯ and undoes it", async () => {
    const asha = lead({ workflow_status: "contacted" });
    const sent: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === "PATCH") {
        const body = JSON.parse(String(options.body)) as { workflow_status: string };
        sent.push(body);
        return Response.json({ lead: { ...asha, workflow_status: body.workflow_status } });
      }
      return Response.json({ leads: [asha], total: 1, nextCursor: null });
    }));
    render(<LeadInbox businessName="Fixture" initialLeads={[asha]} metaReady={false} />);
    fireEvent.click(screen.getByLabelText("More for Asha Verma"));
    fireEvent.click(screen.getByRole("button", { name: "Not interested" }));
    expect(await screen.findByText("Asha Verma is marked not interested.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Not interested" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Asha Verma is back to contacted.")).toBeInTheDocument();
    expect(sent).toEqual([{ workflow_status: "closed" }, { workflow_status: "contacted" }]);
  });

  it("opens the follow-up editor from ⋯ Edit", () => {
    render(<LeadInbox businessName="Fixture" initialLeads={[lead()]} metaReady={false} />);
    fireEvent.click(screen.getByLabelText("More for Asha Verma"));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("form", { name: "Enquiry follow-up" })).toBeInTheDocument();
  });

  it("offers no customer button for Meta's test lead", () => {
    render(<LeadInbox businessName="Fixture" initialLeads={[lead({ full_name: "<test lead: dummy data for full_name>" })]} metaReady={false} />);
    expect(screen.queryByRole("button", { name: /became a customer/ })).not.toBeInTheDocument();
  });
});

describe("<LeadInbox> Waiting · All · Customers (#1260)", () => {
  const fresh = new Date(Date.now() - 60 * 60_000).toISOString();
  const waitingRows = [
    lead({ id: "w1", meta_lead_id: "w1", full_name: "Asha Verma", created_time: fresh, created_at: fresh }),
    lead({ id: "w2", meta_lead_id: "w2", full_name: "Ravi Kumar", created_time: fresh, created_at: fresh }),
    lead({ id: "old", meta_lead_id: "old", full_name: "Old Lead", workflow_status: "new" }),
  ];

  it("opens on Waiting with the sentence, lists only people waiting, and hides search there", () => {
    render(<LeadInbox businessName="Fixture" initialLeads={waitingRows} allTotal={12} summary={{ waiting: 2, replyMinutes: 9 }} metaReady={false} />);
    expect(screen.getByText("2 people are waiting for you. You usually contact people within 9 min.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Waiting" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Asha Verma")).toBeInTheDocument();
    expect(screen.getByText("Ravi Kumar")).toBeInTheDocument();
    expect(screen.queryByText("Old Lead")).not.toBeInTheDocument();
    expect(screen.queryByRole("searchbox", { name: "Search enquiries" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("(12)");
  });

  it("says nobody is waiting, leaves out the median under 3 contacts, and opens on All", () => {
    render(<LeadInbox businessName="Fixture" initialLeads={[lead()]} summary={{ waiting: 0, replyMinutes: null }} metaReady={false} />);
    expect(screen.getByText("Nobody is waiting.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("searchbox", { name: "Search enquiries" })).toBeInTheDocument();
  });

  it("says one person, and loads All and Customers from the server", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { urls.push(url); return Response.json({ leads: [], total: 0, nextCursor: null }); }));
    render(<LeadInbox businessName="Fixture" initialLeads={waitingRows.slice(0, 1)} summary={{ waiting: 1, replyMinutes: 125 }} metaReady={false} />);
    expect(screen.getByText("1 person is waiting for you. You usually contact people within 2 h 5 min.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Customers" }));
    expect(await screen.findByText("No customers yet.")).toBeInTheDocument();
    expect(new URL(urls.at(-1)!, "http://x").searchParams.get("status")).toBe("customer");
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    await waitFor(() => expect(new URL(urls.at(-1)!, "http://x").searchParams.get("status")).toBe("all"));
    expect(screen.getByRole("searchbox", { name: "Search enquiries" })).toBeInTheDocument();
  });

  it("keeps a just-contacted person on Waiting with their contact time and counts one fewer", () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;
    render(<LeadInbox businessName="Fixture" initialLeads={waitingRows} summary={{ waiting: 2, replyMinutes: null }} metaReady={false} />);
    const call = screen.getAllByRole("link", { name: "Call" })[0];
    call.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(call);
    expect(screen.getByText("1 person is waiting for you.")).toBeInTheDocument();
    expect(screen.getByText("Asha Verma")).toBeInTheDocument();
    expect(screen.getByText(/^Contacted in /)).toBeInTheDocument();
  });

  it("offers All when nobody is left on Waiting", () => {
    render(<LeadInbox businessName="Fixture" initialLeads={[lead()]} summary={{ waiting: 1, replyMinutes: null }} metaReady={false} />);
    expect(screen.getByRole("heading", { name: "Nobody is waiting." })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "See all enquiries" }));
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("<LeadInbox> two panes from 1280 px (#1260)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const wide = () => vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(min-width: 1280px)", addEventListener: vi.fn(), removeEventListener: vi.fn() }));

  it("shows the first person beside the list with the exact WhatsApp text and their form answers", () => {
    wide();
    render(<LeadInbox businessName="Solaride" offer="Free solar site survey" initialLeads={[
      lead({ phone: "98765 43210", field_data: { full_name: "Asha Verma", phone_number: "98765 43210", "what_is_your_monthly_bill?": "₹3,000" } }),
      lead({ id: "l2", meta_lead_id: "m2", full_name: "Ravi Kumar", phone: "98111 22233", field_data: {} }),
    ]} metaReady={false} />);
    const pane = screen.getByRole("complementary", { name: "Enquiry from Asha Verma" });
    const message = within(pane).getByText("Opens WhatsApp with:").nextElementSibling!.textContent!;
    expect(message).toMatch(/free solar site survey/i);
    expect(within(pane).getByRole("link", { name: "WhatsApp them" })).toHaveAttribute("href", `https://wa.me/919876543210?text=${encodeURIComponent(message)}`);
    expect(within(pane).getByText("What is your monthly bill").nextElementSibling).toHaveTextContent("₹3,000");
    expect(within(pane).queryByText("Phone number")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ravi Kumar" }));
    const next = screen.getByRole("complementary", { name: "Enquiry from Ravi Kumar" });
    expect(within(next).queryByText("Their answers")).toBeNull();
    expect(screen.getByRole("button", { name: "Ravi Kumar" })).toHaveAttribute("aria-pressed", "true");
  });

  it("stays one pane below 1280 px", () => {
    render(<LeadInbox businessName="Solaride" initialLeads={[lead()]} metaReady={false} />);
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.queryByRole("button", { name: "Asha Verma" })).toBeNull();
  });
});

describe("<LeadInbox> reply in one tap (#1049)", () => {
  it("offers WhatsApp them with a pre-filled first reply and Call, records the first tap once, and shows the reply time", async () => {
    const calls: [string, RequestInit | undefined][] = [];
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => { calls.push([url, init]); return { ok: true, json: async () => ({}) }; }) as unknown as typeof fetch;
    render(<LeadInbox businessName="Solaride" offer="Free solar site survey" language="hinglish" initialLeads={[lead({ phone: "98765 43210" })]} metaReady />);
    const whatsapp = screen.getByRole("link", { name: "WhatsApp them" });
    expect(whatsapp).toHaveAttribute("href", `https://wa.me/919876543210?text=${encodeURIComponent("Namaste Asha ji, Solaride ki taraf se dhanyavaad! Aapne free solar site survey ke baare mein poocha tha. Aapse baat karne ka sahi time kab hai?")}`);
    expect(screen.getAllByRole("link", { name: "Call" })[0]).toHaveAttribute("href", "tel:98765 43210");
    whatsapp.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(whatsapp);
    fireEvent.click(screen.getAllByRole("link", { name: "Call" })[0]);
    const marks = calls.filter(([url]) => url === "/api/leads/l1");
    expect(marks).toHaveLength(1);
    expect(marks[0][1]).toMatchObject({ method: "PATCH", body: JSON.stringify({ contacted: true }), keepalive: true });
    expect(await screen.findByText(/^Replied .* after the enquiry$/)).toBeInTheDocument();
  });

  it("shows the saved reply time and no WhatsApp button for a number it can't use", () => {
    render(<LeadInbox businessName="Solaride" initialLeads={[lead({ id: "l2", meta_lead_id: "m2", phone: "12345", first_contacted_at: "2026-08-20T10:12:00.000Z" })]} metaReady />);
    expect(screen.queryByRole("link", { name: "WhatsApp them" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Call" })[0]).toBeInTheDocument();
    expect(screen.getByText("Replied 12 min after the enquiry")).toBeInTheDocument();
  });

  it("#1140: a tap on an older lead already contacted records no reply time", () => {
    const calls: string[] = [];
    global.fetch = vi.fn(async (url: string) => { calls.push(url); return { ok: true, json: async () => ({}) }; }) as unknown as typeof fetch;
    render(<LeadInbox businessName="Solaride" initialLeads={[lead({ phone: "98765 43210", workflow_status: "contacted" })]} metaReady />);
    fireEvent.click(screen.getAllByRole("link", { name: "Call" })[0]);
    expect(calls).not.toContain("/api/leads/l1");
    expect(screen.queryByText(/^Replied .* after the enquiry$/)).not.toBeInTheDocument();
  });

  it("#1260: once contacted, the row's ⋯ holds WhatsApp them and Call (the row shows Became a customer · ⋯)", () => {
    render(<LeadInbox businessName="Solaride" initialLeads={[lead({ phone: "98765 43210", first_contacted_at: "2026-08-20T10:12:00.000Z" })]} metaReady />);
    const menu = screen.getByLabelText("More for Asha Verma").closest("details")!;
    expect(within(menu).getByRole("link", { name: "WhatsApp them" })).toHaveAttribute("href", expect.stringContaining("https://wa.me/919876543210"));
    expect(within(menu).getByRole("link", { name: "Call" })).toHaveAttribute("href", "tel:98765 43210");
    expect(screen.getByRole("button", { name: "Asha Verma became a customer" })).toBeInTheDocument();
  });

  it("#1260: a waiting row's ⋯ doesn't repeat WhatsApp them or Call", () => {
    render(<LeadInbox businessName="Solaride" initialLeads={[lead({ phone: "98765 43210" })]} metaReady />);
    const menu = screen.getByLabelText("More for Asha Verma").closest("details")!;
    expect(within(menu).queryByRole("link")).toBeNull();
  });
});

// #1819 (Designer, 390): a Meta test lead isn't a waiting enquiry, so its row says so instead of 'New' (the counts
// already leave it out); and a row with no contact actions keeps its ⋯ on the name row, not alone on a second line.
describe("<LeadInbox> rows without actions (#1819)", () => {
  it("labels a Meta test lead 'Test lead', not New, and marks rows with no row actions", () => {
    const testLead = lead({ id: "t1", full_name: "<test lead: dummy data for full_name>", phone: "<test lead: dummy data for phone_number>", email: null, city: null });
    const noPhone = lead({ id: "n1", full_name: "Ravi", phone: null, email: "ravi@example.com" });
    const callable = lead({ id: "c1", full_name: "Asha Verma" });
    render(<LeadInbox businessName="Solaride" initialLeads={[testLead, noPhone, callable]} metaReady allTotal={3} />);
    const row = (id: string) => document.querySelector(`tr[data-lead="${id}"]`) as HTMLElement;
    // The state badge (the follow-up editor keeps its own status words).
    expect(row("t1").querySelector("span[data-state]")).toHaveTextContent(/^Test lead$/);
    expect(row("n1").querySelector("span[data-state]")).toHaveTextContent(/^New$/);
    expect(row("t1")).toHaveAttribute("data-actions", "none");
    expect(row("n1")).toHaveAttribute("data-actions", "none");
    expect(row("c1")).not.toHaveAttribute("data-actions");
  });
});
