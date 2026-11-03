"use client";

import { checkLaterLine, enquiriesWaitLine, throttleActive } from "@/lib/campaign/meta-wait";
import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { Inbox, Loader2, MessageCircle, Phone, RefreshCw, Search, X, Save, Pencil, ChevronDown, SlidersHorizontal, UserCheck, MoreHorizontal } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EnquiryStatusNotice, leadName, useLeadErasure } from "@/components/enquiry-erasure";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Status } from "@/components/ui/status";
import { useNotices } from "@/i18n/notices";
import { enquiriesTranslator, enquiryAge, type Words } from "@/i18n/words";
import { formatDate } from "@/lib/format";
import { useMounted } from "@/lib/use-mounted";
import type { Lead } from "@/lib/types";
import { useLeadList } from "@/lib/leads/use-lead-list";
import { workflowStatuses, type WorkflowStatus } from "@/lib/leads/filters";
import { contactedLabel, formatReplyTime, whatsappReplyLink, type ReplyLanguage } from "@/lib/leads/first-reply";
import { replyChoices } from "@/lib/leads/reply-choices";
import { isMetaTestLead } from "@/lib/leads/test-lead";
import { isWaiting } from "@/lib/leads/waiting";
import { leadAnswers } from "@/lib/leads/answers";
import styles from "./lead-inbox.module.css";
import { LeadInboxEmpty } from "@/components/lead-inbox-empty";

const LEADS_FRESH_MS = 15 * 60_000;

function readLeadSyncTime(key: string): number {
  try { return Number(localStorage.getItem(key)); } catch { return 0; }
}

function saveLeadSyncTime(key: string, completedAt: number) {
  try { localStorage.setItem(key, String(completedAt)); } catch { return; }
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

function initials(name: string | null): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return words.length ? (words[0][0] + (words.length > 1 ? words.at(-1)![0] : "")).toUpperCase() : "?";
}

export function LeadInbox({
  businessName,
  offer = null,
  language = "en",
  vertical = null,
  ownPhotos = false,
  initialLeads,
  initialTotal = initialLeads.filter((lead) => !isMetaTestLead(lead)).length,
  initialNextCursor = null,
  metaReady,
  syncScope,
  title,
  summary = null,
  allTotal,
  offerAlerts = false,
  chatsEmpty = false,
  addEnquiryFor = null,
  metaWaitUntil = null,
  words,
}: {
  businessName: string;
  /** #1049: the business's first offer and language, for the pre-filled first WhatsApp reply. */
  offer?: string | null;
  language?: ReplyLanguage;
  /** #1945: the business type; a pilot segment's "WhatsApp them" offers its 3 first replies, then 2 follow-ups. */
  vertical?: string | null;
  /** #1945/#1617: the owner has their own photos, so interiors may offer to share them. */
  ownPhotos?: boolean;
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
  /** #1438: the page's words in the owner's language (#798 statuses in owners' words); English without. */
  words?: Words<"enquiries">;
}) {
  const tn = useNotices();
  const t = useMemo(() => enquiriesTranslator(words), [words]);
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
  // #1945: the enquiry whose reply sheet is open.
  const [replyLeadId, setReplyLeadId] = useState<string | null>(null);
  const page = useLeadList({ leads: initialLeads, total: initialTotal, nextCursor: initialNextCursor }, view === "all"
    ? { query, status, contact: contactFilter, sort }
    : { query: "", status: view === "waiting" ? "new" : "customer", contact: "all", sort: "newest" });
  const [deleteLead, confirmDialog] = useLeadErasure(setError, (lead) => {
    if (selected?.id === lead.id) setSelected(null);
    page.refresh();
  });
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
      setSaveError(tn("enquiries.followUpSaveFailed"));
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
      setError(tn("enquiries.saveOffline"));
    } finally {
      setMarking(null);
    }
  }

  async function sync(tapped = false) {
    if (syncing) return;
    // #1838 (CPO #1870): Meta asked us to wait, so nothing is sent; a tap says when we'll check again.
    if (throttleActive(metaWaitUntil)) { if (tapped) setNotice(checkLaterLine(metaWaitUntil, words)); return; }
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
        setError(data.error ?? tn("enquiries.checkFailed"));
        return;
      }
      page.refresh();
      setSyncId(data.sync?.hasMore ? data.sync.id : null);
      if (data.failedForms?.length || data.sync?.state === "partial" || data.sync?.hasMore) {
        const soFar = t("sync.soFar", { count: data.imported ?? 0 });
        setWarning(data.failedForms?.length ? t("sync.unread", { forms: data.failedForms.map(form => form.name).join(", "), soFar }) :
          t(!res.ok ? "sync.noAnswer" : "sync.stillChecking", { soFar }));
        return;
      }
      if (data.sync?.state === "complete") {
        const at = Date.now();
        if (syncStorageKey) saveLeadSyncTime(syncStorageKey, at);
        setSyncedAt(at);
      }
      // #1260: 'Updated just now' says a quiet check found nothing; only news gets a sentence.
      setNotice(
        data.imported ? tn("enquiries.imported", { count: data.imported }) : data.sync?.state === "complete" ? null : tn("enquiries.someUnchecked"),
      );
    } catch {
      setError(tn("enquiries.checkOffline"));
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
    if (mounted) return enquiryAge(t, createdTime, now) || formatDate(createdTime);
    return formatDate(createdTime) || "—";
  }

  function rowInfo(l: Lead) {
    const first = firstContact(l);
    const contactMinutes = first ? (Date.parse(first) - Date.parse(l.created_time ?? l.created_at)) / 60_000 : NaN;
    const current = statusOf(l);
    // #1260: one state word per row: New → Contacted in {m} → Customer.
    // #1819: Meta's test lead isn't someone waiting (the counts leave it out), so it says what it is.
    const state = isMetaTestLead(l) ? "test" : current === "customer" ? "customer" : current === "closed" ? "closed" : first ? "contacted" : current === "new" ? "new" : "other";
    const stateLabel = state === "test" ? t("state.test") : state === "new" ? t("status.new") : state === "contacted" ? contactedLabel(contactMinutes, words) : state === "closed" ? t("state.notInterested") : t(`status.${current}`);
    // #1819: no WhatsApp/Call line and no Became a customer, so ⋯ sits on the name row instead of alone on a line.
    const noActions = state === "test" || state === "customer" || (state === "new" && !l.phone);
    const city = isMetaTestLead(l) ? null : l.city;
    const meta = [l.created_time ? whenLabel(l.created_time) : null, l.source === "whatsapp_manual" ? t("lead.whatsappChat") : null, city].filter(Boolean).join(" · ");
    const choices = replyChoices({ leadName: leadName(l), businessName, offer, vertical, language, contacted: Boolean(first), ownPhotos });
    const replyText = choices.texts[0] ?? "";
    const whatsapp = isMetaTestLead(l) || !replyText ? null : whatsappReplyLink(l.phone, replyText);
    return { first, contactMinutes, current, state, stateLabel, meta, name: leadName(l) ?? t("lead.this"), choices, replyText, whatsapp, noActions };
  }
  // #1945: one generic reply opens WhatsApp straight away; a segment's choices open the sheet first.
  function whatsappAction(l: Lead, info: ReturnType<typeof rowInfo>, className: string | undefined, content: ReactNode) {
    if (!info.whatsapp) return null;
    if (info.choices.kind === "generic") {
      return <a href={info.whatsapp} target="_blank" rel="noopener noreferrer" onClick={() => markContacted(l)} className={className}>{content}</a>;
    }
    return <button type="button" aria-haspopup="dialog" className={className}
      onClick={event => { event.currentTarget.closest("details")?.removeAttribute("open"); setReplyLeadId(l.id); }}>{content}</button>;
  }
  const replyLead = replyLeadId ? leads.find((lead) => lead.id === replyLeadId) ?? null : null;
  const replyInfo = replyLead ? rowInfo(replyLead) : null;
  const selectedLead = wide ? leads.find((lead) => lead.id === pickedId) ?? leads[0] ?? null : null;
  const detail = selectedLead ? rowInfo(selectedLead) : null;
  const answers = selectedLead && !isMetaTestLead(selectedLead) ? leadAnswers(selectedLead.field_data) : [];

  // #1597: no enquiries anywhere; #1810: decided from the unfiltered first load, never from a tab's filtered result.
  if (emptyOnArrival && page.total === 0 && leads.length === 0 && !page.loading && !page.error) {
    return <LeadInboxEmpty metaReady={metaReady} offerAlerts={offerAlerts} addEnquiryFor={addEnquiryFor} words={words} />;
  }

  return (
    <div className={styles.inbox}>
      {!metaReady && (
        <Alert variant="warning">
          {t.rich("sync.notConnected", { link: (chunks) => <Link href="/settings" className="inline-flex min-h-11 items-center font-semibold underline">{chunks}</Link> })}
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">
          {title ?? t("title")}{" "}
          <span className="font-normal text-slate-400">({view === "all" || allTotal === undefined ? page.total : allTotal})</span>
        </h2>
      </div>
      {metaReady && <p className="-mt-2 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
        {/* #1260: checking runs on open; the time sits quietly here, with a small Check now for impatient owners and retries. */}
        <span aria-live="polite">{syncing ? t("sync.checking") : lastSync ? t("sync.updated", { age: enquiryAge(t, new Date(lastSync).toISOString(), now) }) : null}</span>
        <button type="button" className="inline-flex min-h-11 items-center gap-1 font-medium text-blue-700 disabled:text-slate-400" onClick={() => void sync(true)} disabled={syncing}>
          {syncing ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={12} aria-hidden="true" />}
          {t(syncId ? "sync.keepChecking" : "sync.checkNow")}
        </button>
      </p>}
      {metaReady && mounted && throttleActive(metaWaitUntil, now) && <p className="-mt-2 text-xs text-slate-600">{enquiriesWaitLine(lastSync ? now.getTime() - lastSync : Date.parse(metaWaitUntil) - now.getTime(), words)}</p>}

      {waiting !== null && <p className={styles.summary}>
        {waiting === 0 ? t("summary.nobody") : t("summary.waiting", { count: waiting })}
        {summary?.replyMinutes != null && ` ${t("summary.replyTime", { time: formatReplyTime(summary.replyMinutes, words?.locale) })}`}
      </p>}
      <div className={styles.views} role="group" aria-label={t("view.label")}>
        {(["waiting", "all", "customers"] as const).map((option) => (
          <button key={option} type="button" aria-pressed={view === option} onClick={() => { setView(option); setFiltersOpen(false); }}>{t(`view.${option}`)}</button>
        ))}
      </div>
      {error && <Alert variant="error">{error}</Alert>}
      {confirmDialog}
      {customerNotice && <EnquiryStatusNotice notice={customerNotice} marking={!!marking} onUndo={() => void setCustomer(customerNotice.lead, customerNotice.previous, customerNotice.previous, true)} />}
      {/* #847: sync results are news, not alarms; the list below stays usable either way. */}
      <p aria-live="polite" className={warning || notice ? "text-sm text-slate-600" : "sr-only"}>{warning ?? notice}</p>
      {page.error && <Alert variant="error">{page.error} <button type="button" onClick={page.refresh}>{t("list.retry")}</button></Alert>}

      {view === "all" && <div>
        <div className={styles.toolbar}>
          <div className={styles.search}>
            <Search size={17} aria-hidden="true" />
            <input ref={searchField} type="search" aria-label={t("list.search")} placeholder={t("list.searchPlaceholder")} value={query} onChange={event => setQuery(event.target.value)} />
            {query && <button type="button" title={t("list.clearSearch")} aria-label={t("list.clearSearch")} onClick={() => setQuery("")}><X size={16} aria-hidden="true" /></button>}
          </div>
          <button type="button" className={styles.filterToggle} aria-label={activeFilters ? t("list.filterSet", { count: activeFilters }) : t("list.filter")} aria-expanded={filtersOpen} aria-controls="enquiry-filters" onClick={() => setFiltersOpen(open => !open)}>
            <SlidersHorizontal size={16} aria-hidden="true" />{t("list.filter")}{activeFilters > 0 && <span className={styles.filterCount}>{activeFilters}</span>}
          </button>
          <div id="enquiry-filters" className={styles.filters} data-open={filtersOpen || undefined}>
          <select aria-label={t("list.contact")} value={contactFilter} onChange={event => setContactFilter(event.target.value)}>
            <option value="all">{t("list.allContacts")}</option><option value="ready">{t("list.hasContact")}</option><option value="missing">{t("list.missingContact")}</option>
          </select>
          <select aria-label={t("list.workflow")} value={status} onChange={event => setStatus(event.target.value)}>
            <option value="all">{t("list.allStatuses")}</option>
            {workflowStatuses.map(value => <option key={value} value={value}>{t(`status.${value}`)}</option>)}
          </select>
          <select aria-label={t("list.sort")} value={sort} onChange={event => setSort(event.target.value)}>
            <option value="newest">{t("list.newest")}</option><option value="oldest">{t("list.oldest")}</option><option value="name">{t("list.byName")}</option>
          </select>
          </div>
        </div>
        <div className={styles.resultCount} data-quiet={hasFilters || realShown < page.total ? undefined : true}><span role="status">{page.loading ? t("list.loading") : hasFilters || realShown < page.total ? t("list.count", { shown: realShown, total: page.total }) : ""}</span>{hasFilters && leads.length > 0 && <button type="button" onClick={clearFilters}>{t("list.clearFilters")}</button>}</div>
      </div>}

      {selected && <form className={styles.editor} aria-label={t("editor.label")} onSubmit={saveFollowUp}>
        <div className={styles.editorHeading}><div><h3>{t("editor.heading", { name: leadName(selected) ?? t("lead.unnamed") })}</h3>{dirty && <p role="status" className="text-xs text-amber-800">{t("editor.unsaved")}</p>}</div><button type="button" aria-label={t("editor.close")} title={t("editor.close")} disabled={saving} onClick={closeEditor}><X size={18} /></button></div>
        <label>{t("editor.status")}<select ref={editorField} value={draftStatus} disabled={saving} onChange={event => { setDraftStatus(event.target.value as WorkflowStatus); setSaved(false); }}>
          {workflowStatuses.map(value => <option key={value} value={value}>{t(`status.${value}`)}</option>)}
        </select></label>
        <label>{t("editor.note")}<textarea rows={4} maxLength={2000} value={draftNote} disabled={saving} onChange={event => { setDraftNote(event.target.value); setSaved(false); }} /></label>
        <div className={styles.editorActions}><span>{draftNote.length}/2000</span><Button type="submit" data-product-event="lead.follow_up" size="sm" disabled={saving}>{saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}{t("editor.save")}</Button></div>
        {saveError && <Alert variant="error">{saveError}</Alert>}
        {saved && <Alert variant="success">{t("editor.saved")}</Alert>}
      </form>}

      {page.error && leads.length === 0 ? null : page.loading && leads.length === 0 ? <div className={styles.empty}><Loader2 className="animate-spin" aria-label={t("list.loadingLabel")} /></div> : leads.length === 0 && view === "waiting" ? (
        <div className={styles.empty}><h3>{t("summary.nobody")}</h3><Button variant="outline" onClick={() => setView("all")}>{t("empty.seeAll")}</Button></div>
      ) : leads.length === 0 && view === "customers" ? (
        <div className={styles.empty}><h3>{t("empty.noCustomers")}</h3><p className="text-sm text-slate-500">{t("empty.customersHint")}</p></div>
      ) : leads.length === 0 && !hasFilters ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Inbox className="h-6 w-6 text-slate-300" aria-hidden="true" />
            <p className="max-w-sm font-medium text-slate-700">{t("empty.none")}</p>
            <p className="max-w-sm text-sm text-slate-500">{t("empty.replyFast")}</p>
            {/* #1260 (Designer): one action, and never one the owner can't take. */}
            <Link href={offerAlerts ? "/settings#whatsapp-alerts-title" : "/campaigns"}
              className={offerAlerts
                ? "mt-2 inline-flex min-h-11 items-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-medium text-white"
                : "mt-2 inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-800 hover:bg-slate-50"}>
              {offerAlerts ? <><MessageCircle size={16} aria-hidden="true" />{t("empty.alertEach")}</> : t("arrival.campaigns")}
            </Link>
          </CardContent>
        </Card>
      ) : leads.length === 0 ? (
        <div className={styles.empty}><h3>{t("empty.noMatch")}</h3><Button variant="outline" onClick={clearFilters}>{t("list.clearFilters")}</Button></div>
      ) : (
        <div className={styles.panes}>
        <div className={styles.listPane}>
          <table role="table" aria-label={t("list.table")} className={styles.table}>
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">{t("list.columns.name")}</th>
                <th className="px-4 py-2 font-medium">{t("list.columns.contact")}</th>
                <th className="px-4 py-2 font-medium">{t("list.columns.city")}</th>
                <th className="px-4 py-2 font-medium">{t("list.columns.form")}</th>
                <th className="px-4 py-2 font-medium">{t("list.columns.when")}</th>
                <th className="px-4 py-2 font-medium">{t("list.columns.followUp")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {leads.map((l) => {
                const info = rowInfo(l);
                const { first, contactMinutes, current, state, stateLabel, meta, name, noActions } = info;
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
                        {whatsappAction(l, info, "inline-flex min-h-11 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-white hover:bg-primary-hover",
                          <><MessageCircle size={14} aria-hidden="true" />{t("lead.whatsapp")}</>)}
                        <a href={`tel:${l.phone}`} onClick={() => markContacted(l)}
                          className="inline-flex min-h-11 items-center gap-1 rounded-md border border-slate-300 px-3 text-xs font-medium text-slate-800 hover:bg-slate-50">
                          <Phone size={14} aria-hidden="true" />{t("lead.call")}</a>
                        {first && <span className={`${styles.repliedLine} block w-full text-xs text-slate-500`}>
                          {Number.isFinite(replied) && replied >= 0 ? t("lead.repliedAfter", { time: formatReplyTime(replied / 60_000, words?.locale) }) : t("lead.replied")}
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
                  <td role="cell" className={styles.desktopOnly}><span className={styles.mobileLabel} aria-hidden="true">{t("list.columns.city")}</span>{(isMetaTestLead(l) ? null : l.city) ?? <span className={styles.blank}>—</span>}</td>
                  <td role="cell" className={styles.desktopOnly}><span className={styles.mobileLabel} aria-hidden="true">{t("list.columns.form")}</span>{l.form_name || (l.source === "whatsapp_manual" ? t("lead.whatsappAdded") : "—")}</td>
                  <td role="cell" className={`${styles.desktopOnly} text-slate-500`}>
                    <span className={styles.mobileLabel} aria-hidden="true">{t("list.columns.received")}</span>
                    {whenLabel(l.created_time) || <span className={styles.blank}>—</span>}
                  </td>
                  <td role="cell" className={styles.followUp}><span className={styles.mobileLabel} aria-hidden="true">{t("list.columns.followUp")}</span>
                    <div className={styles.followUpCell}>
                      <button type="button" className={styles.followUpButton} title={t("lead.followUp", { name: leadName(l) ?? t("lead.fallback") })} aria-label={t("lead.followUpStatus", { name: leadName(l) ?? t("lead.fallback"), status: t(`status.${statusOf(l)}`) })} disabled={saving} onClick={event => editLead(l, event.currentTarget)}>
                        <Pencil size={14} aria-hidden="true" />{statusOf(l) === "customer" ? <Status tone="live">{t("status.customer")}</Status> : t(`status.${statusOf(l)}`)}
                      </button>
                      {statusOf(l) !== "customer" && !isMetaTestLead(l) && (
                        <Button type="button" size="sm" variant="outline" className="h-auto min-h-11 max-w-full shrink whitespace-normal py-1.5 text-left" data-product-event="lead.customer" disabled={!!marking || saving}
                          aria-label={t("lead.becameCustomerLabel", { name: leadName(l) ?? t("lead.thisCapital") })} onClick={() => void setCustomer(l, "customer", statusOf(l))}>
                          {marking === l.id ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <UserCheck size={14} aria-hidden="true" />}{t("lead.becameCustomer")}
                        </Button>
                      )}
                      {/* #1260: on phones the status editor moves into ⋯ (Not interested, Edit). */}
                      <details className={styles.more}>
                        <summary aria-label={t("lead.moreFor", { name })} title={t("lead.more")}><MoreHorizontal size={18} aria-hidden="true" /></summary>
                        <div className={styles.moreMenu}>
                          {/* #1260: once someone isn't waiting, their row shows only Became a customer · ⋯, so the replies live here. */}
                          {state !== "new" && !isMetaTestLead(l) && <>
                            {l.phone && whatsappAction(l, info, undefined, t("lead.whatsapp"))}
                            {l.phone && <a href={`tel:${l.phone}`} onClick={() => markContacted(l)}>{t("lead.call")}</a>}
                            {l.email && <a href={`mailto:${l.email}`}>{t("lead.email")}</a>}
                          </>}
                          {current !== "closed" && current !== "customer" && !isMetaTestLead(l) && <button type="button" disabled={!!marking || saving}
                            onClick={event => { event.currentTarget.closest("details")?.removeAttribute("open"); void setCustomer(l, "closed", current); }}>{t("state.notInterested")}</button>}
                          <button type="button" disabled={saving} onClick={event => { const menu = event.currentTarget.closest("details"); menu?.removeAttribute("open"); editLead(l, menu?.querySelector("summary") ?? event.currentTarget); }}>{t("lead.edit")}</button>
                          <button type="button" className="text-danger" disabled={saving} onClick={event => { event.currentTarget.closest("details")?.removeAttribute("open"); void deleteLead(l); }}>{t("lead.delete")}</button>
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
          <aside className={styles.detail} aria-label={t("lead.from", { name: detail.name })}>
            <div className={styles.detailHead}>
              <span className={styles.detailAvatar} aria-hidden="true">{initials(leadName(selectedLead))}</span>
              <div className="min-w-0">
                <h3>{leadName(selectedLead) ?? t("lead.unnamed")}</h3>
                <p><span className={styles.detailState} data-state={detail.state}>{detail.stateLabel}</span>{detail.meta && ` · ${detail.meta}`}</p>
              </div>
            </div>
            {!isMetaTestLead(selectedLead) && detail.state !== "customer" && <div className="flex flex-wrap gap-2">
              {whatsappAction(selectedLead, detail, "inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover",
                <><MessageCircle size={16} aria-hidden="true" />{t("lead.whatsapp")}</>)}
              {selectedLead.phone && <a href={`tel:${selectedLead.phone}`} onClick={() => markContacted(selectedLead)}
                className="inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-800 hover:bg-slate-50">
                <Phone size={16} aria-hidden="true" />{t("lead.call")}</a>}
              {detail.first && <Button type="button" variant="outline" className="min-h-11" data-product-event="lead.customer" disabled={!!marking || saving}
                onClick={() => void setCustomer(selectedLead, "customer", detail.current)}><UserCheck size={16} aria-hidden="true" />{t("lead.becameCustomer")}</Button>}
            </div>}
            {detail.whatsapp && detail.choices.kind === "generic" && detail.state !== "customer" && <section>
              <h4>{t("lead.opensWith")}</h4>
              <p className={styles.detailMessage}>{detail.replyText}</p>
            </section>}
            {answers.length > 0 && <section>
              <h4>{t("lead.answers")}</h4>
              <dl className={styles.answers}>{answers.map(({ question, answer }) => <div key={question}><dt>{question}</dt><dd>{answer}</dd></div>)}</dl>
            </section>}
            <div><Button type="button" variant="danger" size="sm" className="min-h-11" disabled={saving} onClick={() => void deleteLead(selectedLead)}>{t("lead.delete")}</Button></div>
          </aside>
        )}
        </div>
      )}
      <Dialog open={Boolean(replyInfo)} onOpenChange={(open) => { if (!open) setReplyLeadId(null); }}>
        {replyLead && replyInfo && <DialogContent className="sm:max-w-md">
          <div className="flex items-start justify-between gap-2 px-4 pt-4">
            <div className="min-w-0 pt-2">
              <DialogTitle className="text-[17px] font-semibold leading-6 text-slate-900">{t(replyInfo.choices.kind === "follow-up" ? "reply.followUp" : "reply.choose")}</DialogTitle>
              <DialogDescription className="mt-1 text-sm text-slate-600">{t("reply.description", { name: replyInfo.name })}</DialogDescription>
            </div>
            <DialogClose aria-label={t("reply.close")} />
          </div>
          <ul className="flex flex-col gap-2 p-4">
            {replyInfo.choices.texts.map((text) => <li key={text}>
              <a href={whatsappReplyLink(replyLead.phone, text) ?? undefined} target="_blank" rel="noopener noreferrer"
                onClick={() => { markContacted(replyLead); setReplyLeadId(null); }}
                className="flex min-h-11 items-start gap-2 rounded-lg border border-slate-300 px-3 py-2.5 text-[15px] leading-[22px] text-slate-800 hover:border-primary hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                <MessageCircle size={16} className="mt-[3px] shrink-0 text-primary" aria-hidden="true" /><span>{text}</span>
              </a>
            </li>)}
          </ul>
        </DialogContent>}
      </Dialog>
      {page.nextCursor && <Button variant="outline" disabled={page.loading} onClick={page.loadMore}>{page.loading ? <Loader2 size={16} className="animate-spin" /> : <ChevronDown size={16} />}{t("list.loadMore")}</Button>}
    </div>
  );
}
