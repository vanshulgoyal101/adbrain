"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, Copy, Inbox, Loader2, MessageCircle, RefreshCw, Search, X, Save, Pencil, ChevronDown } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { buildLeadDigest, relativeAge } from "@/lib/leads/digest";
import { formatDateShort } from "@/lib/utils";
import { useMounted } from "@/lib/use-mounted";
import type { Lead } from "@/lib/types";
import { useLeadList } from "@/lib/leads/use-lead-list";
import { workflowStatuses, type WorkflowStatus } from "@/lib/leads/filters";
import styles from "./lead-inbox.module.css";

export function LeadInbox({
  businessName,
  initialLeads,
  initialTotal = initialLeads.length,
  initialNextCursor = null,
  metaReady,
}: {
  businessName: string;
  initialLeads: Lead[];
  initialTotal?: number;
  initialNextCursor?: string | null;
  metaReady: boolean;
}) {
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState("");
  const [contactFilter, setContactFilter] = useState("all");
  const [sort, setSort] = useState("newest");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<Lead | null>(null);
  const [draftStatus, setDraftStatus] = useState<WorkflowStatus>("new");
  const [draftNote, setDraftNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [syncId, setSyncId] = useState<string | null>(null);
  const editorField = useRef<HTMLSelectElement>(null);
  useEffect(() => { editorField.current?.focus(); }, [selected?.id]);
  const page = useLeadList({ leads: initialLeads, total: initialTotal, nextCursor: initialNextCursor }, {
    query, status, contact: contactFilter, sort,
  });
  const leads = page.leads;
  const mounted = useMounted();

  const hasFilters = Boolean(query || contactFilter !== "all" || status !== "all");
  function clearFilters() {
    setQuery("");
    setContactFilter("all");
    setStatus("all");
  }

  function editLead(lead: Lead) {
    setSelected(lead);
    setDraftStatus(lead.workflow_status ?? "new");
    setDraftNote(lead.follow_up_note ?? "");
    setSaveError(null);
    setSaved(false);
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
      if (!response.ok || data.lead?.id !== selected.id) throw new Error("Save failed");
      setSelected(data.lead);
      setSaved(true);
      page.refresh();
    } catch {
      setSaveError("Follow-up could not be saved. Your edits are still here; retry to save them.");
    } finally {
      setSaving(false);
    }
  }

  const digest = useMemo(
    () =>
      buildLeadDigest(
        leads.map((l) => ({
          fullName: l.full_name,
          phone: l.phone,
          email: l.email,
          city: l.city,
          formName: l.form_name,
          createdTime: l.created_time,
        })),
        { businessName },
      ),
    [leads, businessName],
  );

  async function sync() {
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
      if (!res.ok || !Array.isArray(data.leads)) {
        setError(data.error ?? "Couldn't sync leads. Your existing enquiries are still available.");
        return;
      }
      page.refresh();
      setSyncId(data.sync?.hasMore ? data.sync.id : null);
      if (data.failedForms?.length || data.sync?.state === "partial" || data.sync?.hasMore) {
        const failures = data.failedForms?.length ? ` Could not read: ${data.failedForms.map(form => form.name).join(", ")}.` : " More enquiries remain to be checked.";
        setWarning(`Sync incomplete.${failures} ${data.imported ?? 0} new leads imported.`);
        return;
      }
      setNotice(
        data.imported
          ? `Synced ${data.imported} lead${data.imported === 1 ? "" : "s"} from Meta.`
          : data.sync?.state === "complete" ? "You're up to date — no new leads." : "Sync finished. Completion could not be verified.",
      );
    } catch {
      setError("Couldn't sync leads — check your connection.");
    } finally {
      setSyncing(false);
    }
  }

  async function copyDigest() {
    try {
      await navigator.clipboard.writeText(digest);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Couldn't copy — select and copy the text manually.");
    }
  }

  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(digest)}`;
  const now = new Date();
  const contactableCount = leads.filter((lead) => lead.phone?.trim() || lead.email?.trim()).length;
  const cityCount = new Set(leads.map((lead) => lead.city).filter(Boolean)).size;

  // Render a deterministic absolute date on the server and first client render
  // (same string on both sides = no hydration mismatch), then upgrade to the
  // friendlier relative "2h ago" once mounted on the client.
  function whenLabel(createdTime: string | null): string {
    if (!createdTime) return "—";
    if (mounted) return relativeAge(createdTime, now) || formatDateShort(createdTime);
    return formatDateShort(createdTime) || "—";
  }

  return (
    <div className={styles.inbox}>
      {!metaReady && (
        <Alert variant="warning">
          Meta isn’t configured, so leads can’t be synced yet. <Link href="/settings" className="font-semibold underline">Connect your account in Settings</Link>.
        </Alert>
      )}

      <div className={styles.metrics}>
        {[
          { label: hasFilters ? "Matching responses" : "Total responses", value: page.total },
          { label: "Loaded with contact", value: contactableCount },
          { label: "Loaded areas", value: cityCount },
        ].map((item) => (
          <div
            key={item.label}
            className={styles.metric}
          >
            <p className="text-xs text-slate-500">{item.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">
              {item.value}
            </p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">
          Enquiries{" "}
          <span className="font-normal text-slate-400">({page.total})</span>
        </h2>
        {metaReady && (
          <Button size="sm" variant="outline" onClick={sync} disabled={syncing}>
            {syncing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {syncId ? "Resume sync" : "Sync leads"}
          </Button>
        )}
      </div>

      {error && <Alert variant="error">{error}</Alert>}
      {warning && <Alert variant="warning">{warning}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}
      {page.error && <Alert variant="error">{page.error} <button type="button" onClick={page.refresh}>Retry list</button></Alert>}

      <div>
        <div className={styles.toolbar}>
          <div className={styles.search}>
            <Search size={17} aria-hidden="true" />
            <input type="search" aria-label="Search enquiries" placeholder="Search name, contact, city, or form" value={query} onChange={event => setQuery(event.target.value)} />
            {query && <button type="button" title="Clear search" aria-label="Clear search" onClick={() => setQuery("")}><X size={16} aria-hidden="true" /></button>}
          </div>
          <select aria-label="Contact availability" value={contactFilter} onChange={event => setContactFilter(event.target.value)}>
            <option value="all">All contacts</option><option value="ready">Has contact details</option><option value="missing">Missing contact details</option>
          </select>
          <select aria-label="Workflow status" value={status} onChange={event => setStatus(event.target.value)}>
            <option value="all">All follow-up statuses</option>
            {workflowStatuses.map(value => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}
          </select>
          <select aria-label="Sort enquiries" value={sort} onChange={event => setSort(event.target.value)}>
            <option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="name">Name A–Z</option>
          </select>
        </div>
        <div className={styles.resultCount}><span role="status">{page.loading ? "Loading enquiries..." : `${leads.length} of ${page.total} enquiries`}</span>{hasFilters && leads.length > 0 && <button type="button" onClick={clearFilters}>Clear filters</button>}</div>
      </div>

      {selected && <form className={styles.editor} aria-label="Enquiry follow-up" onSubmit={saveFollowUp}>
        <div className={styles.editorHeading}><h3>Follow up: {selected.full_name ?? "Unnamed enquiry"}</h3><button type="button" aria-label="Close follow-up" title="Close follow-up" disabled={saving} onClick={() => setSelected(null)}><X size={18} /></button></div>
        <label>Follow-up status<select ref={editorField} value={draftStatus} disabled={saving} onChange={event => { setDraftStatus(event.target.value as WorkflowStatus); setSaved(false); }}>
          {workflowStatuses.map(value => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}
        </select></label>
        <label>Follow-up note<textarea rows={4} maxLength={2000} value={draftNote} disabled={saving} onChange={event => { setDraftNote(event.target.value); setSaved(false); }} /></label>
        <div className={styles.editorActions}><span>{draftNote.length}/2000</span><Button type="submit" size="sm" disabled={saving}>{saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}Save follow-up</Button></div>
        {saveError && <Alert variant="error">{saveError}</Alert>}
        {saved && <Alert variant="success">Follow-up saved.</Alert>}
      </form>}

      {page.error && leads.length === 0 ? null : page.loading && leads.length === 0 ? <div className={styles.empty}><Loader2 className="animate-spin" aria-label="Loading enquiries" /></div> : leads.length === 0 && !hasFilters ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-1 py-12 text-center">
            <Inbox className="h-6 w-6 text-slate-300" />
            <p className="font-medium text-slate-600">No leads yet</p>
            <p className="max-w-sm text-sm text-slate-400">
              When people fill your Meta lead forms, they’ll show up here. Launch
              a campaign, then hit “Sync leads”.
            </p>
          </CardContent>
        </Card>
      ) : leads.length === 0 ? (
        <div className={styles.empty}><Search size={28} aria-hidden="true" /><h3>No matching enquiries</h3><Button variant="outline" onClick={clearFilters}>Clear filters</Button></div>
      ) : (
        <div>
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
              {leads.map((l) => (
                <tr role="row" key={l.id} className="hover:bg-slate-50">
                  <td role="cell" className={styles.person}>
                    {l.full_name ?? "—"}
                  </td>
                  <td role="cell" className={styles.contact}>
                    {l.phone && (
                      <a
                        href={`tel:${l.phone}`}
                        className="block text-blue-700 hover:underline"
                      >
                        {l.phone}
                      </a>
                    )}
                    {l.email && (
                      <a href={`mailto:${l.email}`} className="block max-w-64 break-all text-blue-700 hover:underline">
                        {l.email}
                      </a>
                    )}
                    {!l.phone && !l.email && "—"}
                  </td>
                  <td role="cell"><span className={styles.mobileLabel} aria-hidden="true">City</span>{l.city ?? "—"}</td>
                  <td role="cell"><span className={styles.mobileLabel} aria-hidden="true">Form</span>{l.form_name ?? "—"}</td>
                  <td role="cell" className="text-slate-500">
                    <span className={styles.mobileLabel} aria-hidden="true">Received</span>
                    {whenLabel(l.created_time) || "—"}
                  </td>
                  <td role="cell"><span className={styles.mobileLabel} aria-hidden="true">Follow-up</span><button type="button" className={styles.followUpButton} title={`Follow up ${l.full_name ?? "enquiry"}`} aria-label={`Follow up ${l.full_name ?? "enquiry"}`} disabled={saving} onClick={() => editLead(l)}><Pencil size={14} aria-hidden="true" />{l.workflow_status ?? "new"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page.nextCursor && <Button variant="outline" disabled={page.loading} onClick={page.loadMore}>{page.loading ? <Loader2 size={16} className="animate-spin" /> : <ChevronDown size={16} />}Load more enquiries</Button>}
      {leads.length > 0 && (
        <details className={styles.digest}>
          <summary className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <MessageCircle className="h-4 w-4 text-blue-600" />
            WhatsApp digest
            <span className="ml-auto text-xs font-normal text-slate-500">Loaded enquiries · Last 7 days · Up to 10 contacts</span>
          </summary>
          <pre
            className="scrollbar-stable max-h-72 overflow-y-scroll whitespace-pre-wrap break-words rounded-md bg-slate-50 p-4 text-sm text-slate-700"
          >
            {digest}
          </pre>
          <div className="mt-3 flex flex-wrap items-center gap-3 pb-4">
            <Button size="sm" variant="outline" onClick={copyDigest}>
              {copied ? <Check className="h-4 w-4 text-blue-600" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <a className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-blue-700" href={whatsappHref} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="h-4 w-4" /> Share on WhatsApp
            </a>
          </div>
        </details>
      )}
    </div>
  );
}
