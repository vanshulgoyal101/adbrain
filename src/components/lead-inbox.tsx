"use client";

import { checkLaterLine, enquiriesWaitLine, throttleActive } from "@/lib/meta/throttle-words";
import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Inbox, Loader2, MessageCircle, Phone, RefreshCw, Search, X, Save, Pencil, ChevronDown, SlidersHorizontal, UserCheck, MoreHorizontal } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Status } from "@/components/ui/status";
import { relativeAge } from "@/lib/leads/digest";
import { formatDate } from "@/lib/format";
import { useMounted } from "@/lib/use-mounted";
import type { Lead } from "@/lib/types";
import { useLeadList } from "@/lib/leads/use-lead-list";
import { workflowStatuses, type WorkflowStatus } from "@/lib/leads/filters";
import { firstReplyText, formatReplyTime, whatsappReplyLink, type ReplyLanguage } from "@/lib/leads/first-reply";
import { isMetaTestLead } from "@/lib/leads/test-lead";
import { isWaiting } from "@/lib/leads/waiting";
import { leadAnswers } from "@/lib/leads/answers";
import styles from "./lead-inbox.module.css";
import { WhatsAppEnquiries } from "@/components/whatsapp-enquiries";

const LEADS_FRESH_MS = 15 * 60_000;

function readLeadSyncTime(key: string): number {
  try { return Number(localStorage.getItem(key)); } catch { return 0; }
}

function saveLeadSyncTime(key: string, completedAt: number) {
  try { localStorage.setItem(key, String(completedAt)); } catch { return; }
}


/** #798: follow-up statuses in owners' words; "customer" is an enquiry that became a customer. */
const STATUS_LABEL: Record<WorkflowStatus, string> = {
  new: "New", contacted: "Contacted", qualified: "Qualified", booked: "Booked", customer: "Customer", closed: "Closed",
};

function leadName(lead: Pick<Lead, "full_name">): string | null {
  return isMetaTestLead(lead) ? "Test enquiry from Meta" : lead.full_name;
}

type InboxView = "waiting" | "all" | "customers";

/** #1260 slice 4: two panes (list + the selected person) from 1280 px; server and first paint are one pane. */
const WIDE = "(min-width: 1280px)";
function useWide(): boolean {
  return useSyncExternalStore(
    (change) => {
      const query = typeof window !== "undefined" ? window.matchMedia?.(WIDE) : undefined;
      query?.addEventListener("change", change);
      return () => query?.removeEventListener("change", change);
    },
    () => Boolean(window.matchMedia?.(WIDE).matches),
    () => false,
  );
}
const VIEW_LABEL: Record<InboxView, string> = { waiting: "Waiting", all: "All", customers: "Customers" };

function initials(name: string | null): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return words.length ? (words[0][0] + (words.length > 1 ? words.at(-1)![0] : "")).toUpperCase() : "?";
}

/** #1260 (CPO words): 'Contacted' is the owner's first tap on WhatsApp them/Call, not a confirmed reply. */
function contactedLabel(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return "Contacted";
  if (minutes < 24 * 60) return `Contacted in ${formatReplyTime(minutes)}`;
  const days = Math.floor(minutes / (24 * 60));
  return `Contacted after ${days} ${days === 1 ? "day" : "days"}`;
}

export function LeadInbox({
  businessName,
  offer = null,
  language = "en",
  initialLeads,
  initialTotal = initialLeads.filter((lead) => !isMetaTestLead(lead)).length,
  initialNextCursor = null,
  metaReady,
  syncScope,
  title = "Enquiries",
  summary = null,
  allTotal,
  offerAlerts = false,
  chatsEmpty = false,
  addEnquiryFor = null,
  metaWaitUntil = null,
}: {
  businessName: string;
  /** #1049: the business's first offer and language, for the pre-filled first WhatsApp reply. */
  offer?: string | null;
  language?: ReplyLanguage;
  initialLeads: Lead[];
  initialTotal?: number;
  initialNextCursor?: string | null;
  metaReady: boolean;
  syncScope?: string;
  /** #1223/#1835: "Form enquiries" when WhatsApp chats are shown above and none is logged here. */
  title?: string;
  /** #1260: people waiting for a first contact, and the 30-day median minutes to contact (null under 3). */
  summary?: { waiting: number | null; replyMinutes: number | null } | null;
  /** #1260: every enquiry, for the heading while Waiting or Customers is shown (the first page may be New only). */
  allTotal?: number;
  /** #1260: WhatsApp alerts (#701) can be turned on here and aren't yet, so the empty state offers them. */
  offerAlerts?: boolean;
  /** #1597: the page found no WhatsApp chat or logged enquiry either; with no form enquiry, one block replaces the inbox. */
  chatsEmpty?: boolean;
  /** #1597: a WhatsApp campaign the empty block's 'Add an enquiry' logs to. */
  addEnquiryFor?: { campaignId: string; spend: number; enquiries: number } | null;
  /** #1838: until when Meta asked us to wait; checks (on open and Check now) don't call Meta until then. */
  metaWaitUntil?: string | null;
}) {
  const [adding, setAdding] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  // #1260: when this Page's last complete check finished, for the quiet 'Updated' line (null = read storage).
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [contactFilter, setContactFilter] = useState("all");
  const [sort, setSort] = useState("newest");
  const [status, setStatus] = useState("all");
  // On a phone the three selects sit behind one Filter button (#376).
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilters = [contactFilter !== "all", status !== "all", sort !== "newest"].filter(Boolean).length;
  const [selected, setSelected] = useState<Lead | null>(null);
  const [draftStatus, setDraftStatus] = useState<WorkflowStatus>("new");
  const [draftNote, setDraftNote] = useState("");
  const [drafts, setDrafts] = useState<Record<string, { status: WorkflowStatus; note: string }>>({});
  const [confirmed, setConfirmed] = useState<Record<string, { status: WorkflowStatus; note: string }>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [syncId, setSyncId] = useState<string | null>(null);
  const [marking, setMarking] = useState<string | null>(null);
  const [customerNotice, setCustomerNotice] = useState<{ lead: Lead; previous: WorkflowStatus; status: WorkflowStatus; undone?: boolean } | null>(null);
  const syncStorageKey = syncScope ? `lead-sync:${syncScope}` : null;
  const editorField = useRef<HTMLSelectElement>(null);
  const editorTrigger = useRef<HTMLElement>(null);
  const searchField = useRef<HTMLInputElement>(null);
  useEffect(() => { editorField.current?.focus(); }, [selected?.id]);
  // #1260: Waiting (default when anyone waits) · All (search and filters) · Customers.
  const [view, setView] = useState<InboxView>(summary?.waiting ? "waiting" : "all");
  const [openedAt] = useState(() => Date.now());
  const [emptyOnArrival] = useState(() => chatsEmpty && initialLeads.length === 0 && (allTotal ?? 0) === 0);
  const wide = useWide();
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [contactedAt, setContactedAt] = useState<Record<string, string>>({});
  const page = useLeadList({ leads: initialLeads, total: initialTotal, nextCursor: initialNextCursor }, view === "all"
    ? { query, status, contact: contactFilter, sort }
    : { query: "", status: view === "waiting" ? "new" : "customer", contact: "all", sort: "newest" });
  // A row the owner just contacted stays in Waiting this visit, showing 'Contacted in …'.
  const leads = view === "waiting" ? page.leads.filter((lead) => isWaiting(lead, openedAt) || contactedAt[`${lead.business_id}:${lead.id}`]) : page.leads;
  const contactedNow = page.leads.filter((lead) => isWaiting(lead, openedAt) && contactedAt[`${lead.business_id}:${lead.id}`]).length;
  const waiting = summary?.waiting == null ? null : Math.max(0, summary.waiting - (view === "waiting" ? contactedNow : 0));
  // #1149: Meta's test leads are listed (labelled) but not counted; the server's total leaves them out too.
  const realShown = leads.filter((lead) => !isMetaTestLead(lead)).length;
  const mounted = useMounted();
  const dirty = selected && (draftStatus !== (selected.workflow_status ?? "new") || draftNote !== (selected.follow_up_note ?? ""));

  const hasFilters = view === "all" && Boolean(query || contactFilter !== "all" || status !== "all");
  function clearFilters() {
    setQuery("");
    setContactFilter("all");
    setStatus("all");
  }

  const draftKey = (lead: Lead) => `${lead.business_id}:${lead.id}`;
  function rememberDraft() {
    if (!selected) return;
    const key = draftKey(selected);
    if (draftStatus !== (selected.workflow_status ?? "new") || draftNote !== (selected.follow_up_note ?? "")) {
      setDrafts(current => ({ ...current, [key]: { status: draftStatus, note: draftNote } }));
    } else if (drafts[key]) {
      setDrafts(current => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }

  function editLead(lead: Lead, trigger: HTMLElement) {
    if (selected?.id === lead.id) { editorField.current?.focus(); return; }
    rememberDraft();
    editorTrigger.current = trigger;
    const key = draftKey(lead);
    const existing = drafts[key];
    const savedRow = confirmed[key];
    const current = savedRow ? { ...lead, workflow_status: savedRow.status, follow_up_note: savedRow.note } : lead;
    setSelected(current);
    setDraftStatus(existing?.status ?? current.workflow_status ?? "new");
    setDraftNote(existing?.note ?? current.follow_up_note ?? "");
    setSaveError(null);
    setSaved(false);
  }

  function closeEditor() {
    rememberDraft();
    setSelected(null);
    if (editorTrigger.current?.isConnected) editorTrigger.current.focus();
    else searchField.current?.focus();
  }

  async function saveFollowUp(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || saving) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const response = await fetch(`/api/leads/${selected.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflow_status: draftStatus, follow_up_note: draftNote }),
      });
      const data = await response.json() as { lead?: Lead };
      if (!response.ok || data.lead?.id !== selected.id || data.lead.business_id !== selected.business_id) throw new Error("Save failed");
      const savedRow = { status: data.lead.workflow_status ?? "new", note: data.lead.follow_up_note ?? "" };
      setSelected(data.lead);
      setDraftStatus(savedRow.status);
      setDraftNote(savedRow.note);
      setConfirmed(current => ({ ...current, [draftKey(selected)]: savedRow }));
      setDrafts(current => {
        const next = { ...current };
        delete next[draftKey(selected)];
        return next;
      });
      setSaved(true);
      page.refresh();
    } catch {
      setSaveError("Follow-up could not be saved. Your edits are still here; retry to save them.");
    } finally {
      setSaving(false);
    }
  }

  const statusOf = (lead: Lead): WorkflowStatus => confirmed[draftKey(lead)]?.status ?? lead.workflow_status ?? "new";

  // #1049: the first time the owner reached out from the card (this session's tap, else the saved one).
  const firstContact = (lead: Lead) => lead.first_contacted_at ?? contactedAt[draftKey(lead)] ?? null;
  function markContacted(lead: Lead) {
    // #1140: only a still-new enquiry gets a first reply time (the server does the same).
    if (firstContact(lead) || statusOf(lead) !== "new") return;
    setContactedAt(current => ({ ...current, [draftKey(lead)]: new Date().toISOString() }));
    // keepalive: the tap leaves for WhatsApp or the dialer, and the record still has to land.
    void fetch(`/api/leads/${lead.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contacted: true }), keepalive: true,
    }).catch(() => undefined);
  }

  /** #798: one tap marks an enquiry as a customer, or (#1260) not interested; Undo puts the old status back; notes are kept. */
  async function setCustomer(lead: Lead, status: WorkflowStatus, previous: WorkflowStatus, undo = false) {
    if (marking) return;
    setMarking(lead.id);
    try {
      const response = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workflow_status: status }),
      });
      const data = await response.json() as { lead?: Lead };
      if (!response.ok || data.lead?.id !== lead.id || data.lead.business_id !== lead.business_id) throw new Error("Save failed");
      const savedRow = { status: data.lead.workflow_status ?? status, note: data.lead.follow_up_note ?? "" };
      setConfirmed(current => ({ ...current, [draftKey(lead)]: savedRow }));
      if (selected?.id === lead.id) { setSelected(data.lead); setDraftStatus(savedRow.status); }
      setCustomerNotice({ lead, previous, status, undone: undo });
      page.refresh();
    } catch {
      setError("Couldn't save that. Check your connection and try again.");
    } finally {
      setMarking(null);
    }
  }

  async function sync(tapped = false) {
    if (syncing) return;
    // #1838 (CPO #1870): Meta asked us to wait, so nothing is sent; a tap says when we'll check again.
    if (throttleActive(metaWaitUntil)) {
      if (tapped) setNotice(checkLaterLine(metaWaitUntil!));
      return;
    }
    setSyncing(true);
    setError(null);
    setNotice(null);
    setWarning(null);
    try {
      const res = await fetch("/api/leads/sync", syncId ? {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ syncId }),
      } : { method: "POST" });
      const data = (await res.json()) as {
        leads?: Lead[];
        imported?: number;
        failedForms?: { id: string; name: string }[];
        sync?: { id: string; state: "complete" | "partial"; hasMore: boolean };
        error?: string;
      };
      if ((!res.ok && !(res.status === 502 && data.sync?.hasMore)) || !Array.isArray(data.leads)) {
        setError(data.error ?? "Couldn't check Meta for enquiries. The ones below are still here.");
        return;
      }
      page.refresh();
      setSyncId(data.sync?.hasMore ? data.sync.id : null);
      if (data.failedForms?.length || data.sync?.state === "partial" || data.sync?.hasMore) {
        const imported = data.imported ?? 0;
        const soFar = `${imported} new ${imported === 1 ? "enquiry" : "enquiries"} so far`;
        setWarning(data.failedForms?.length ? `Couldn't read: ${data.failedForms.map(form => form.name).join(", ")}. ${soFar}.` :
          !res.ok ? `Some forms didn't answer. ${soFar}; Keep checking to try again.` : `Still checking Meta. ${soFar}; Keep checking to finish.`);
        return;
      }
      if (data.sync?.state === "complete") {
        const at = Date.now();
        if (syncStorageKey) saveLeadSyncTime(syncStorageKey, at);
        setSyncedAt(at);
      }
      // #1260: 'Updated just now' says a quiet check found nothing; only news gets a sentence.
      setNotice(
        data.imported
          ? `${data.imported} new ${data.imported === 1 ? "enquiry" : "enquiries"} from Meta.`
          : data.sync?.state === "complete" ? null : "Some enquiries on Meta couldn't be checked. The ones below are saved; tap Check now to try again.",
      );
    } catch {
      setError("Couldn't check Meta for enquiries. Check your connection.");
    } finally {
      setSyncing(false);
    }
  }

  const syncStaleLeads = useEffectEvent(() => { void sync(); });
  useEffect(() => {
    if (!metaReady || !syncStorageKey) return;
    const completedAt = readLeadSyncTime(syncStorageKey);
    const age = Date.now() - completedAt;
    if (completedAt > 0 && age >= 0 && age < LEADS_FRESH_MS) return;
    const timer = window.setTimeout(syncStaleLeads, 0);
    return () => window.clearTimeout(timer);
  }, [metaReady, syncStorageKey]);

  const now = new Date();
  const lastSync = syncedAt ?? (mounted && syncStorageKey ? readLeadSyncTime(syncStorageKey) : 0);

  // Render a deterministic absolute date on the server and first client render
  // (same string on both sides = no hydration mismatch), then upgrade to the
  // friendlier relative "2h ago" once mounted on the client.
  function whenLabel(createdTime: string | null): string {
    if (!createdTime) return "—";
    if (mounted) return relativeAge(createdTime, now) || formatDate(createdTime);
    return formatDate(createdTime) || "—";
  }

  function rowInfo(l: Lead) {
    const first = firstContact(l);
    const contactMinutes = first ? (Date.parse(first) - Date.parse(l.created_time ?? l.created_at)) / 60_000 : NaN;
    const current = statusOf(l);
    // #1260: one state word per row: New → Contacted in {m} → Customer.
    // #1819: Meta's test lead isn't someone waiting (the counts leave it out), so it says what it is.
    const state = isMetaTestLead(l) ? "test" : current === "customer" ? "customer" : current === "closed" ? "closed" : first ? "contacted" : current === "new" ? "new" : "other";
    const stateLabel = state === "test" ? "Test lead" : state === "new" ? "New" : state === "contacted" ? contactedLabel(contactMinutes) : state === "closed" ? "Not interested" : STATUS_LABEL[current];
    // #1819: no WhatsApp/Call line and no Became a customer, so ⋯ sits on the name row instead of alone on a line.
    const noActions = state === "test" || state === "customer" || (state === "new" && !l.phone);
    const city = isMetaTestLead(l) ? null : l.city;
    const meta = [l.created_time ? whenLabel(l.created_time) : null, l.source === "whatsapp_manual" ? "WhatsApp chat" : null, city].filter(Boolean).join(" · ");
    const replyText = firstReplyText({ leadName: leadName(l), businessName, offer, language });
    const whatsapp = isMetaTestLead(l) ? null : whatsappReplyLink(l.phone, replyText);
    return { first, contactMinutes, current, state, stateLabel, meta, name: leadName(l) ?? "this enquiry", replyText, whatsapp, noActions };
  }
  const selectedLead = wide ? leads.find((lead) => lead.id === pickedId) ?? leads[0] ?? null : null;
  const detail = selectedLead ? rowInfo(selectedLead) : null;
  const answers = selectedLead && !isMetaTestLead(selectedLead) ? leadAnswers(selectedLead.field_data) : [];

  // #1597 (Designer, #1463): no enquiries anywhere: one block (title, line, one action) instead of banner, count, tabs,
  // search and a card that repeats it. The checking above keeps running, so the first enquiry brings the inbox back.
  // #1810: decided from the unfiltered first load (test leads included), never from a tab's filtered result.
  if (emptyOnArrival && page.total === 0 && leads.length === 0 && !page.loading && !page.error) {
    const solid = !metaReady || offerAlerts;
    return (
      <section aria-labelledby="enquiries-empty-title" className="mt-4 flex max-w-xl flex-col items-start gap-2">
        <h2 id="enquiries-empty-title" className="text-[17px] font-semibold leading-6 text-slate-900">No enquiries yet</h2>
        <p className="text-[15px] leading-[22px] text-slate-600">
          {metaReady
            ? "Enquiries from your ads show up here: form enquiries on their own, WhatsApp chats when you add them. Reply fast: people often pick the first business that answers."
            : "Connect your Facebook Page to run ads. Enquiries from them show up here."}
        </p>
        <Link href={!metaReady ? "/settings" : offerAlerts ? "/settings#whatsapp-alerts-title" : "/campaigns"}
          className={`mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md px-4 text-sm font-medium sm:w-auto ${solid
            ? "bg-[var(--primary)] text-white"
            : "border border-slate-300 text-slate-800 hover:bg-slate-50"}`}>
          {!metaReady ? "Connect Facebook Page" : offerAlerts ? "Get a WhatsApp alert for form enquiries" : "See your campaigns"}
        </Link>
        {metaReady && addEnquiryFor && (adding
          ? <WhatsAppEnquiries compact campaignId={addEnquiryFor.campaignId} spend={addEnquiryFor.spend} enquiries={addEnquiryFor.enquiries}
            onLogged={() => window.location.reload()} />
          : <button type="button" className="inline-flex min-h-11 items-center text-sm font-medium text-blue-700 hover:underline" onClick={() => setAdding(true)}>Add an enquiry</button>)}
      </section>
    );
  }

  return (
    <div className={styles.inbox}>
      {!metaReady && (
        <Alert variant="warning">
          Meta isn’t connected, so new enquiries can’t come in yet. <Link href="/settings" className="inline-flex min-h-11 items-center font-semibold underline">Connect your account in Settings</Link>.
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">
          {title}{" "}
          <span className="font-normal text-slate-400">({view === "all" || allTotal === undefined ? page.total : allTotal})</span>
        </h2>
      </div>
      {metaReady && <p className="-mt-2 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
        {/* #1260: checking runs on open; the time sits quietly here, with a small Check now for impatient owners and retries. */}
        <span aria-live="polite">{syncing ? "Checking Meta for new enquiries…" : lastSync ? `Updated ${relativeAge(new Date(lastSync).toISOString(), now)}` : null}</span>
        <button type="button" className="inline-flex min-h-11 items-center gap-1 font-medium text-blue-700 disabled:text-slate-400" onClick={() => void sync(true)} disabled={syncing}>
          {syncing ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={12} aria-hidden="true" />}
          {syncId ? "Keep checking" : "Check now"}
        </button>
      </p>}
      {metaReady && mounted && throttleActive(metaWaitUntil, now) && (
        <p className="-mt-2 text-xs text-slate-600">
          {enquiriesWaitLine(lastSync ? now.getTime() - lastSync : Date.parse(metaWaitUntil!) - now.getTime())}
        </p>
      )}

      {waiting !== null && <p className={styles.summary}>
        {waiting === 0 ? "Nobody is waiting." : `${waiting} ${waiting === 1 ? "person is" : "people are"} waiting for you.`}
        {summary?.replyMinutes != null && ` You usually contact people within ${formatReplyTime(summary.replyMinutes)}.`}
      </p>}
      <div className={styles.views} role="group" aria-label="Show">
        {(["waiting", "all", "customers"] as const).map((option) => (
          <button key={option} type="button" aria-pressed={view === option} onClick={() => { setView(option); setFiltersOpen(false); }}>{VIEW_LABEL[option]}</button>
        ))}
      </div>
      {error && <Alert variant="error">{error}</Alert>}
      {customerNotice && (
        <p role="status" className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
          {customerNotice.undone
            ? `${leadName(customerNotice.lead) ?? "This enquiry"} is back to ${STATUS_LABEL[customerNotice.previous].toLowerCase()}.`
            : customerNotice.status === "closed" ? `${leadName(customerNotice.lead) ?? "This enquiry"} is marked not interested.`
              : `${leadName(customerNotice.lead) ?? "This enquiry"} became a customer.`}
          {!customerNotice.undone && (
            <button type="button" className="min-h-11 font-medium text-blue-700" disabled={!!marking}
              onClick={() => void setCustomer(customerNotice.lead, customerNotice.previous, customerNotice.previous, true)}>Undo</button>
          )}
        </p>
      )}
      {/* #847: sync results are news, not alarms; the list below stays usable either way. */}
      <p aria-live="polite" className={warning || notice ? "text-sm text-slate-600" : "sr-only"}>{warning ?? notice}</p>
      {page.error && <Alert variant="error">{page.error} <button type="button" onClick={page.refresh}>Retry list</button></Alert>}

      {view === "all" && <div>
        <div className={styles.toolbar}>
          <div className={styles.search}>
            <Search size={17} aria-hidden="true" />
            <input ref={searchField} type="search" aria-label="Search enquiries" placeholder="Search name, contact, city, or form" value={query} onChange={event => setQuery(event.target.value)} />
            {query && <button type="button" title="Clear search" aria-label="Clear search" onClick={() => setQuery("")}><X size={16} aria-hidden="true" /></button>}
          </div>
          <button type="button" className={styles.filterToggle} aria-label={activeFilters ? `Filter, ${activeFilters} set` : "Filter"} aria-expanded={filtersOpen} aria-controls="enquiry-filters" onClick={() => setFiltersOpen(open => !open)}>
            <SlidersHorizontal size={16} aria-hidden="true" />Filter{activeFilters > 0 && <span className={styles.filterCount}>{activeFilters}</span>}
          </button>
          <div id="enquiry-filters" className={styles.filters} data-open={filtersOpen || undefined}>
          <select aria-label="Contact availability" value={contactFilter} onChange={event => setContactFilter(event.target.value)}>
            <option value="all">All contacts</option><option value="ready">Has contact details</option><option value="missing">Missing contact details</option>
          </select>
          <select aria-label="Workflow status" value={status} onChange={event => setStatus(event.target.value)}>
            <option value="all">All follow-up statuses</option>
            {workflowStatuses.map(value => <option key={value} value={value}>{STATUS_LABEL[value]}</option>)}
          </select>
          <select aria-label="Sort enquiries" value={sort} onChange={event => setSort(event.target.value)}>
            <option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="name">Name A–Z</option>
          </select>
          </div>
        </div>
        <div className={styles.resultCount}><span role="status">{page.loading ? "Loading enquiries..." : hasFilters || realShown < page.total ? `${realShown} of ${page.total} enquiries` : ""}</span>{hasFilters && leads.length > 0 && <button type="button" onClick={clearFilters}>Clear filters</button>}</div>
      </div>}

      {selected && <form className={styles.editor} aria-label="Enquiry follow-up" onSubmit={saveFollowUp}>
        <div className={styles.editorHeading}><div><h3>Follow up: {leadName(selected) ?? "Unnamed enquiry"}</h3>{dirty && <p role="status" className="text-xs text-amber-800">Unsaved changes</p>}</div><button type="button" aria-label="Close follow-up" title="Close follow-up" disabled={saving} onClick={closeEditor}><X size={18} /></button></div>
        <label>Follow-up status<select ref={editorField} value={draftStatus} disabled={saving} onChange={event => { setDraftStatus(event.target.value as WorkflowStatus); setSaved(false); }}>
          {workflowStatuses.map(value => <option key={value} value={value}>{STATUS_LABEL[value]}</option>)}
        </select></label>
        <label>Follow-up note<textarea rows={4} maxLength={2000} value={draftNote} disabled={saving} onChange={event => { setDraftNote(event.target.value); setSaved(false); }} /></label>
        <div className={styles.editorActions}><span>{draftNote.length}/2000</span><Button type="submit" data-product-event="lead.follow_up" size="sm" disabled={saving}>{saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}Save follow-up</Button></div>
        {saveError && <Alert variant="error">{saveError}</Alert>}
        {saved && <Alert variant="success">Follow-up saved.</Alert>}
      </form>}

      {page.error && leads.length === 0 ? null : page.loading && leads.length === 0 ? <div className={styles.empty}><Loader2 className="animate-spin" aria-label="Loading enquiries" /></div> : leads.length === 0 && view === "waiting" ? (
        <div className={styles.empty}><h3>Nobody is waiting.</h3><Button variant="outline" onClick={() => setView("all")}>See all enquiries</Button></div>
      ) : leads.length === 0 && view === "customers" ? (
        <div className={styles.empty}><h3>No customers yet.</h3><p className="text-sm text-slate-500">Tap Became a customer on an enquiry when they buy.</p></div>
      ) : leads.length === 0 && !hasFilters ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Inbox className="h-6 w-6 text-slate-300" aria-hidden="true" />
            <p className="max-w-sm font-medium text-slate-700">
              No enquiries yet. When someone fills your form or messages you on WhatsApp from an ad, they&apos;ll show up here.
            </p>
            <p className="max-w-sm text-sm text-slate-500">Reply fast: people often go with the first business that answers.</p>
            {/* #1260 (Designer): one action, and never one the owner can't take. */}
            <Link href={offerAlerts ? "/settings#whatsapp-alerts-title" : "/campaigns"}
              className={offerAlerts
                ? "mt-2 inline-flex min-h-11 items-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-medium text-white"
                : "mt-2 inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-800 hover:bg-slate-50"}>
              {offerAlerts ? <><MessageCircle size={16} aria-hidden="true" />Get a WhatsApp alert for each enquiry</> : "See your campaigns"}
            </Link>
          </CardContent>
        </Card>
      ) : leads.length === 0 ? (
        <div className={styles.empty}><h3>No matching enquiries</h3><Button variant="outline" onClick={clearFilters}>Clear filters</Button></div>
      ) : (
        <div className={detail ? styles.panes : undefined}>
        <div className={styles.listPane}>
          <table role="table" aria-label="Customer enquiries" className={styles.table}>
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Contact</th>
                <th className="px-4 py-2 font-medium">City</th>
                <th className="px-4 py-2 font-medium">Form</th>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Follow-up</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {leads.map((l) => {
                const { first, contactMinutes, current, state, stateLabel, meta, name, whatsapp, noActions } = rowInfo(l);
                return (
                <tr role="row" key={l.id} className="hover:bg-slate-50" data-lead={l.id} data-state={state} data-actions={noActions ? "none" : undefined} data-selected={selectedLead?.id === l.id || undefined}>
                  <td role="cell" className={styles.person}>
                    <span className={styles.avatar} aria-hidden="true">{initials(leadName(l))}</span>
                    {wide ? <button type="button" className={styles.name} aria-pressed={selectedLead?.id === l.id} onClick={() => setPickedId(l.id)}>{leadName(l) ?? "—"}</button>
                      : <span className={styles.name}>{leadName(l) ?? "—"}</span>}
                    <span className={styles.rowState} data-state={state}>{stateLabel}</span>
                    {meta && <span className={styles.rowMeta}>{meta}</span>}
                  </td>
                  <td role="cell" className={styles.contact}>
                    {!isMetaTestLead(l) && l.phone && (
                      <a
                        href={`tel:${l.phone}`}
                        className={`${styles.phoneNumber} block text-blue-700 hover:underline`}
                      >
                        {l.phone}
                      </a>
                    )}
                    {!isMetaTestLead(l) && l.phone && (() => {
                      const replied = contactMinutes * 60_000;
                      return <div className={`${styles.replyActions} mt-1 flex flex-wrap items-center gap-2`}>
                        {whatsapp && <a href={whatsapp} target="_blank" rel="noopener noreferrer" onClick={() => markContacted(l)}
                          className="inline-flex min-h-11 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-white hover:bg-primary-hover">
                          <MessageCircle size={14} aria-hidden="true" />WhatsApp them</a>}
                        <a href={`tel:${l.phone}`} onClick={() => markContacted(l)}
                          className="inline-flex min-h-11 items-center gap-1 rounded-md border border-slate-300 px-3 text-xs font-medium text-slate-800 hover:bg-slate-50">
                          <Phone size={14} aria-hidden="true" />Call</a>
                        {first && <span className={`${styles.repliedLine} block w-full text-xs text-slate-500`}>
                          {Number.isFinite(replied) && replied >= 0 ? `Replied ${formatReplyTime(replied / 60_000)} after the enquiry` : "Replied"}
                        </span>}
                      </div>;
                    })()}
                    {!isMetaTestLead(l) && l.email && (
                      <a href={`mailto:${l.email}`} className="block max-w-64 break-all text-blue-700 hover:underline">
                        {l.email}
                      </a>
                    )}
                    {(isMetaTestLead(l) || (!l.phone && !l.email)) && <span className={styles.blank}>—</span>}
                  </td>
                  <td role="cell" className={styles.desktopOnly}><span className={styles.mobileLabel} aria-hidden="true">City</span>{(isMetaTestLead(l) ? null : l.city) ?? <span className={styles.blank}>—</span>}</td>
                  <td role="cell" className={styles.desktopOnly}><span className={styles.mobileLabel} aria-hidden="true">Form</span>{leadSource(l)}</td>
                  <td role="cell" className={`${styles.desktopOnly} text-slate-500`}>
                    <span className={styles.mobileLabel} aria-hidden="true">Received</span>
                    {whenLabel(l.created_time) || <span className={styles.blank}>—</span>}
                  </td>
                  <td role="cell" className={styles.followUp}><span className={styles.mobileLabel} aria-hidden="true">Follow-up</span>
                    <div className={styles.followUpCell}>
                      <button type="button" className={styles.followUpButton} title={`Follow up ${leadName(l) ?? "enquiry"}`} aria-label={`Follow up ${leadName(l) ?? "enquiry"}, status ${STATUS_LABEL[statusOf(l)]}`} disabled={saving} onClick={event => editLead(l, event.currentTarget)}>
                        <Pencil size={14} aria-hidden="true" />{statusOf(l) === "customer" ? <Status tone="live">Customer</Status> : STATUS_LABEL[statusOf(l)]}
                      </button>
                      {statusOf(l) !== "customer" && !isMetaTestLead(l) && (
                        <Button type="button" size="sm" variant="outline" className="h-auto min-h-11 max-w-full shrink whitespace-normal py-1.5 text-left" data-product-event="lead.customer" disabled={!!marking || saving}
                          aria-label={`${leadName(l) ?? "This enquiry"} became a customer`} onClick={() => void setCustomer(l, "customer", statusOf(l))}>
                          {marking === l.id ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <UserCheck size={14} aria-hidden="true" />}Became a customer
                        </Button>
                      )}
                      {/* #1260: on phones the status editor moves into ⋯ (Not interested, Edit). */}
                      <details className={styles.more}>
                        <summary aria-label={`More for ${name}`} title="More"><MoreHorizontal size={18} aria-hidden="true" /></summary>
                        <div className={styles.moreMenu}>
                          {/* #1260: once someone isn't waiting, their row shows only Became a customer · ⋯, so the replies live here. */}
                          {state !== "new" && !isMetaTestLead(l) && <>
                            {whatsapp && l.phone && <a href={whatsapp} target="_blank" rel="noopener noreferrer" onClick={() => markContacted(l)}>WhatsApp them</a>}
                            {l.phone && <a href={`tel:${l.phone}`} onClick={() => markContacted(l)}>Call</a>}
                            {l.email && <a href={`mailto:${l.email}`}>Email</a>}
                          </>}
                          {current !== "closed" && current !== "customer" && !isMetaTestLead(l) && <button type="button" disabled={!!marking || saving}
                            onClick={event => { event.currentTarget.closest("details")?.removeAttribute("open"); void setCustomer(l, "closed", current); }}>Not interested</button>}
                          <button type="button" disabled={saving} onClick={event => { const menu = event.currentTarget.closest("details"); menu?.removeAttribute("open"); editLead(l, menu?.querySelector("summary") ?? event.currentTarget); }}>Edit</button>
                        </div>
                      </details>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {selectedLead && detail && (
          <aside className={styles.detail} aria-label={`Enquiry from ${detail.name}`}>
            <div className={styles.detailHead}>
              <span className={styles.detailAvatar} aria-hidden="true">{initials(leadName(selectedLead))}</span>
              <div className="min-w-0">
                <h3>{leadName(selectedLead) ?? "Unnamed enquiry"}</h3>
                <p><span className={styles.detailState} data-state={detail.state}>{detail.stateLabel}</span>{detail.meta && ` · ${detail.meta}`}</p>
              </div>
            </div>
            {!isMetaTestLead(selectedLead) && detail.state !== "customer" && <div className="flex flex-wrap gap-2">
              {detail.whatsapp && <a href={detail.whatsapp} target="_blank" rel="noopener noreferrer" onClick={() => markContacted(selectedLead)}
                className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover">
                <MessageCircle size={16} aria-hidden="true" />WhatsApp them</a>}
              {selectedLead.phone && <a href={`tel:${selectedLead.phone}`} onClick={() => markContacted(selectedLead)}
                className="inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-800 hover:bg-slate-50">
                <Phone size={16} aria-hidden="true" />Call</a>}
              {detail.first && <Button type="button" variant="outline" className="min-h-11" data-product-event="lead.customer" disabled={!!marking || saving}
                onClick={() => void setCustomer(selectedLead, "customer", detail.current)}><UserCheck size={16} aria-hidden="true" />Became a customer</Button>}
            </div>}
            {detail.whatsapp && detail.state !== "customer" && <section>
              <h4>Opens WhatsApp with:</h4>
              <p className={styles.detailMessage}>{detail.replyText}</p>
            </section>}
            {answers.length > 0 && <section>
              <h4>Their answers</h4>
              <dl className={styles.answers}>{answers.map(({ question, answer }) => <div key={question}><dt>{question}</dt><dd>{answer}</dd></div>)}</dl>
            </section>}
          </aside>
        )}
        </div>
      )}
      {page.nextCursor && <Button variant="outline" disabled={page.loading} onClick={page.loadMore}>{page.loading ? <Loader2 size={16} className="animate-spin" /> : <ChevronDown size={16} />}Load more enquiries</Button>}
    </div>
  );
}

/** Where an enquiry came from: its Meta form, or a WhatsApp chat the owner logged (#335). */
function leadSource(lead: Lead): string {
  if (lead.form_name) return lead.form_name;
  return lead.source === "whatsapp_manual" ? "WhatsApp chat (added by you)" : "—";
}
