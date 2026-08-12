"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Inbox, Loader2, MessageCircle, RefreshCw } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { buildLeadDigest, relativeAge } from "@/lib/leads/digest";
import type { Lead } from "@/lib/types";

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
      if (!res.ok) {
        setError(data.error ?? "Couldn't sync leads.");
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

  return (
    <div className="flex flex-col gap-6">
      {!metaReady && (
        <Alert variant="warning">
          Meta isn’t configured, so leads can’t be synced yet. Add your Meta
          credentials to pull leads in.
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">
          Your leads{" "}
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

      {leads.length > 0 && (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <MessageCircle className="h-4 w-4 text-emerald-600" />
              WhatsApp digest
            </div>
            <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
              {digest}
            </pre>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={copyDigest}>
                {copied ? (
                  <Check className="h-4 w-4 text-emerald-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
              <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
                <Button size="sm">
                  <MessageCircle className="h-4 w-4" /> Share on WhatsApp
                </Button>
              </a>
            </div>
          </CardContent>
        </Card>
      )}

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
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Phone</th>
                <th className="px-4 py-2 font-medium">City</th>
                <th className="px-4 py-2 font-medium">Form</th>
                <th className="px-4 py-2 font-medium">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {leads.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium text-slate-800">
                    {l.full_name ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">
                    {l.phone ? (
                      <a
                        href={`tel:${l.phone}`}
                        className="text-emerald-700 hover:underline"
                      >
                        {l.phone}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{l.city ?? "—"}</td>
                  <td className="px-4 py-2.5 text-slate-500">{l.form_name ?? "—"}</td>
                  <td className="px-4 py-2.5 text-slate-500">
                    {relativeAge(l.created_time, now) || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
