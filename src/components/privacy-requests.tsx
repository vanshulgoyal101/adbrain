"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type PrivacyRequest = { id: string; owner_id?: string; kind: "export" | "delete";
  status: "received" | "in_review" | "completed" | "declined"; created_at: string; updated_at: string };

const statusLabel = { received: "Received", in_review: "In review", completed: "Completed", declined: "Declined" };

export function PrivacyRequests() {
  const [requests, setRequests] = useState<PrivacyRequest[] | null>(null);
  const [operatorAvailable, setOperatorAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/privacy-requests", { cache: "no-store" }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not load privacy requests.");
      return body.requests as PrivacyRequest[];
    }).then(rows => { if (active) setRequests(rows); })
      .catch(cause => { if (active) setError((cause as Error).message); });
    fetch("/api/privacy-requests/operator?check=1", { cache: "no-store" })
      .then(response => { if (active) setOperatorAvailable(response.ok); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  async function submit(kind: PrivacyRequest["kind"]) {
    if (kind === "delete" && !window.confirm("Submit an account deletion request for operator review? No data will be deleted immediately.")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/privacy-requests", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not submit the request.");
      setRequests(current => [body.request as PrivacyRequest, ...(current ?? [])].slice(0, 20));
      setNotice(`${kind === "export" ? "Export" : "Deletion"} request received. You can follow its status below.`);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  return <section aria-labelledby="privacy-requests-title" className="space-y-4 border-t border-slate-200 pt-6">
    <div>
      <h2 id="privacy-requests-title" className="text-lg font-semibold text-slate-900">Privacy and data requests</h2>
      <p className="text-sm text-slate-600">Requests are reviewed by an operator; no full-account export or deletion happens automatically. <a href="/data-deletion" className="font-medium text-blue-700 underline">Data request details</a></p>
    </div>
    {error && <Alert variant="error">{error}</Alert>}
    {notice && <Alert variant="success">{notice}</Alert>}
    <div className="flex flex-wrap gap-3">
      <Button type="button" disabled={busy || !requests || requests.some(row => row.kind === "export" && ["received", "in_review"].includes(row.status))} onClick={() => submit("export")}>Request export</Button>
      <Button type="button" variant="outline" disabled={busy || !requests || requests.some(row => row.kind === "delete" && ["received", "in_review"].includes(row.status))} onClick={() => submit("delete")}>Request deletion</Button>
    </div>
    {!requests && !error && <p role="status" className="text-sm text-slate-600">Loading requests</p>}
    {requests && <div aria-label="Your privacy requests">
      {requests.length === 0 ? <p className="text-sm text-slate-600">No requests yet.</p> :
        <ul className="divide-y divide-slate-200 border-y border-slate-200">{requests.map(row => <li key={row.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm">
          <span className="font-medium text-slate-900">{row.kind === "export" ? "Export" : "Deletion"} · {new Date(row.created_at).toLocaleDateString()}</span>
          <span className="text-slate-700">{statusLabel[row.status]}</span>
        </li>)}</ul>}
    </div>}
    {operatorAvailable && <Link href="/settings/privacy-requests" className="inline-block text-sm font-medium text-blue-700 underline underline-offset-4">Operator request queue</Link>}
  </section>;
}

export function PrivacyOperatorQueue() {
  const [requests, setRequests] = useState<PrivacyRequest[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/privacy-requests/operator", { cache: "no-store" }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not load the operator queue.");
      return body.requests as PrivacyRequest[];
    }).then(rows => { if (active) setRequests(rows); })
      .catch(cause => { if (active) setError((cause as Error).message); });
    return () => { active = false; };
  }, []);

  async function update(row: PrivacyRequest, status: "in_review" | "completed" | "declined") {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/privacy-requests/operator", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, expectedStatus: row.status, status }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not update request status.");
      setRequests(current => current?.flatMap(item => item.id !== row.id ? [item] :
        status === "in_review" ? [body.request as PrivacyRequest] : []) ?? null);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  return <section aria-label="Open privacy requests" className="space-y-3">
    {error && <Alert variant="error">{error} <button type="button" className="underline" onClick={() => window.location.reload()}>Reload</button></Alert>}
    {!requests && !error && <p role="status" className="text-sm text-slate-600">Loading requests</p>}
    {requests?.length === 0 && <p className="text-sm text-slate-600">No open requests.</p>}
    {requests && requests.length > 0 && <ul className="divide-y divide-slate-200 border-y border-slate-200">{requests.map(row => <li key={row.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
      <span className="min-w-0 flex-1 break-all text-slate-800">{row.owner_id} · {row.kind === "export" ? "Export" : "Deletion"} · {statusLabel[row.status]} · {new Date(row.created_at).toLocaleDateString()}</span>
      <select aria-label={`Update ${row.kind} request ${row.id}`} defaultValue="" disabled={busy}
        onChange={event => { if (event.target.value) void update(row, event.target.value as "in_review" | "completed" | "declined"); event.target.value = ""; }}
        className="h-10 rounded border border-slate-300 bg-white px-2 text-sm">
        <option value="" disabled>Set status</option>
        {row.status === "received" && <option value="in_review">In review</option>}
        <option value="completed">Completed</option><option value="declined">Declined</option>
      </select>
    </li>)}</ul>}
  </section>;
}