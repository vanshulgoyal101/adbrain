"use client";

import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type PrivacyRequest = { id: string; owner_id?: string; kind: "export" | "delete";
  status: "received" | "in_review" | "completed" | "declined"; created_at: string; updated_at: string };

const statusLabel = { received: "Received", in_review: "In review", completed: "Completed", declined: "Declined" };

export function PrivacyRequests() {
  const [requests, setRequests] = useState<PrivacyRequest[] | null>(null);
  const [operatorRequests, setOperatorRequests] = useState<PrivacyRequest[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [operatorError, setOperatorError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/privacy-requests", { cache: "no-store" }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not load privacy requests.");
      return body.requests as PrivacyRequest[];
    }).then(rows => { if (active) setRequests(rows); })
      .catch(cause => { if (active) setError((cause as Error).message); });
    fetch("/api/privacy-requests/operator", { cache: "no-store" }).then(async response => {
      if (response.status === 403) return null;
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not load the operator queue.");
      return body.requests as PrivacyRequest[];
    }).then(rows => { if (active) setOperatorRequests(rows); })
      .catch(cause => { if (active) setOperatorError((cause as Error).message); });
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

  async function update(row: PrivacyRequest, status: "in_review" | "completed" | "declined") {
    setBusy(true); setOperatorError("");
    try {
      const response = await fetch("/api/privacy-requests/operator", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, expectedStatus: row.status, status }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not update request status.");
      setOperatorRequests(current => current?.flatMap(item => item.id !== row.id ? [item] :
        status === "in_review" ? [body.request as PrivacyRequest] : []) ?? null);
      setRequests(current => current?.map(item => item.id === row.id ? body.request as PrivacyRequest : item) ?? null);
    } catch (cause) { setOperatorError((cause as Error).message); }
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
    {operatorRequests && <div className="space-y-3 border-t border-slate-200 pt-5">
      <h3 className="font-semibold text-slate-900">Operator request queue</h3>
      {operatorError && <Alert variant="error">{operatorError}</Alert>}
      {operatorRequests.length === 0 ? <p className="text-sm text-slate-600">No requests.</p> :
        <ul className="divide-y divide-slate-200 border-y border-slate-200">{operatorRequests.map(row => <li key={row.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
          <span className="min-w-0 flex-1 break-all text-slate-800">{row.owner_id} · {row.kind} · {statusLabel[row.status]} · {new Date(row.created_at).toLocaleDateString()}</span>
          {["received", "in_review"].includes(row.status) && <select aria-label={`Update ${row.kind} request ${row.id}`} defaultValue="" disabled={busy}
            onChange={event => { if (event.target.value) void update(row, event.target.value as "in_review" | "completed" | "declined"); event.target.value = ""; }}
            className="h-10 rounded border border-slate-300 bg-white px-2 text-sm">
            <option value="" disabled>Set status</option>
            {row.status === "received" && <option value="in_review">In review</option>}
            <option value="completed">Completed</option><option value="declined">Declined</option>
          </select>}
        </li>)}</ul>}
    </div>}
  </section>;
}