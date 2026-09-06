"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, Copy, Inbox, Loader2, MessageCircle, RefreshCw, Search, X } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { buildLeadDigest, relativeAge } from "@/lib/leads/digest";
import { formatDateShort } from "@/lib/utils";
import { useMounted } from "@/lib/use-mounted";
import type { Lead } from "@/lib/types";
import styles from "./lead-inbox.module.css";

export function LeadInbox({
  businessName,
  initialLeads,
  metaReady,
}: {
  businessName: string;
  initialLeads: Lead[];
  metaReady: boolean;
}) {
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState("");
  const [contactFilter, setContactFilter] = useState("all");
  const [sort, setSort] = useState("newest");
  const mounted = useMounted();

  const search = query.trim().toLocaleLowerCase();
  const filtered = leads.filter(lead => {
    const contactable = Boolean(lead.phone?.trim() || lead.email?.trim());
    return (contactFilter === "all" || (contactFilter === "ready" ? contactable : !contactable)) &&
      (!search || [lead.full_name, lead.phone, lead.email, lead.city, lead.form_name].some(value => value?.toLocaleLowerCase().includes(search)));
  }).sort((first, second) => {
    if (sort === "name") return (first.full_name ?? "").localeCompare(second.full_name ?? "");
    const firstTime = Date.parse(first.created_time ?? "") || 0;
    const secondTime = Date.parse(second.created_time ?? "") || 0;
    return sort === "oldest" ? firstTime - secondTime : secondTime - firstTime;
  });
  const hasFilters = Boolean(query || contactFilter !== "all");
  function clearFilters() {
    setQuery("");
    setContactFilter("all");
  }

  const digest = useMemo(
    () =>
      buildLeadDigest(
        leads.map((l) => ({
          fullName: l.full_name,
          phone: l.phone,
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
    try {
      const res = await fetch("/api/leads/sync", { method: "POST" });
      const data = (await res.json()) as {
        leads?: Lead[];
        imported?: number;
        error?: string;
      };
      if (!res.ok || !Array.isArray(data.leads)) {
        setError(data.error ?? "Couldn't sync leads. Your existing enquiries are still available.");
        return;
      }
      if (Array.isArray(data.leads)) setLeads(data.leads);
      setNotice(
        data.imported
          ? `Synced ${data.imported} lead${data.imported === 1 ? "" : "s"} from Meta.`
          : "You're up to date — no new leads.",
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
          { label: "Total responses", value: leads.length },
          { label: "Ready to contact", value: contactableCount },
          { label: "Areas represented", value: cityCount },
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
          <span className="font-normal text-slate-400">({leads.length})</span>
        </h2>
        {metaReady && (
          <Button size="sm" variant="outline" onClick={sync} disabled={syncing}>
            {syncing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Sync leads
          </Button>
        )}
      </div>

      {error && <Alert variant="error">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      {leads.length > 0 && <div>
        <div className={styles.toolbar}>
          <div className={styles.search}>
            <Search size={17} aria-hidden="true" />
            <input type="search" aria-label="Search enquiries" placeholder="Search name, contact, city, or form" value={query} onChange={event => setQuery(event.target.value)} />
            {query && <button type="button" title="Clear search" aria-label="Clear search" onClick={() => setQuery("")}><X size={16} aria-hidden="true" /></button>}
          </div>
          <select aria-label="Contact availability" value={contactFilter} onChange={event => setContactFilter(event.target.value)}>
            <option value="all">All contacts</option><option value="ready">Has contact details</option><option value="missing">Missing contact details</option>
          </select>
          <select aria-label="Sort enquiries" value={sort} onChange={event => setSort(event.target.value)}>
            <option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="name">Name A–Z</option>
          </select>
        </div>
        <div className={styles.resultCount}><span role="status">{filtered.length} of {leads.length} enquiries</span>{hasFilters && filtered.length > 0 && <button type="button" onClick={clearFilters}>Clear filters</button>}</div>
      </div>}

      {leads.length === 0 ? (
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
      ) : filtered.length === 0 ? (
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
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((l) => (
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {leads.length > 0 && (
        <details className={styles.digest}>
          <summary className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <MessageCircle className="h-4 w-4 text-blue-600" />
            WhatsApp digest
            <span className="ml-auto text-xs font-normal text-slate-500">All {leads.length} enquiries</span>
          </summary>
          <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-slate-50 p-4 text-sm text-slate-700">{digest}</pre>
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
