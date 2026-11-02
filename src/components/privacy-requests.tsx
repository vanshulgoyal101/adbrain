"use client";

import { useEffect, useMemo, useState } from "react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import type { PrivacyRequest } from "@/lib/privacy-requests";
import { privacyRequestSubject } from "@/lib/privacy-request-label";
import { formatDate } from "@/lib/format";
import { settingsTranslator, type Words } from "@/i18n/words";

// The operator queue is an internal tool, so it keeps English.
const english = settingsTranslator();

export function PrivacyRequests({ initialRequests = null, initialOperatorAvailable = false, words }: {
  initialRequests?: PrivacyRequest[] | null; initialOperatorAvailable?: boolean; words?: Words<"settings">;
} = {}) {
  const t = useMemo(() => settingsTranslator(words), [words]);
  const loadFailed = t("privacy.loadFailed");
  const [requests, setRequests] = useState<PrivacyRequest[] | null>(initialRequests);
  const [operatorAvailable, setOperatorAvailable] = useState(initialOperatorAvailable);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirm, confirmDialog] = useConfirm();
  const serverLoaded = initialRequests !== null;

  useEffect(() => {
    if (serverLoaded) return;
    let active = true;
    fetch("/api/privacy-requests", { cache: "no-store" }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? loadFailed);
      return body.requests as PrivacyRequest[];
    }).then(rows => { if (active) setRequests(rows); })
      .catch(cause => { if (active) setError((cause as Error).message); });
    fetch("/api/privacy-requests/operator?check=1", { cache: "no-store" })
      .then(response => { if (active) setOperatorAvailable(response.ok); })
      .catch(() => {});
    return () => { active = false; };
  }, [serverLoaded, loadFailed]);

  async function submit(kind: PrivacyRequest["kind"]) {
    if (kind === "delete" && !(await confirm({ title: t("privacy.deleteTitle"), description: t("privacy.deleteBody"),
      confirmLabel: t("privacy.requestDeletion"), cancelLabel: t("privacy.cancel"), tone: "danger" }))) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/privacy-requests", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? t("privacy.submitFailed"));
      setRequests(current => [body.request as PrivacyRequest, ...(current ?? [])].slice(0, 20));
      setNotice(t(kind === "export" ? "privacy.exportReceived" : "privacy.deleteReceived"));
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  return <section aria-labelledby="privacy-requests-title" className="space-y-4 border-t border-slate-200 pt-6">
      {confirmDialog}
    <div>
      <h2 id="privacy-requests-title" className="text-lg font-semibold text-slate-900">{t("privacy.title")}</h2>
      <p className="text-sm text-slate-600">{t("privacy.intro")}</p>
      <a href="/data-deletion" className="inline-flex min-h-11 items-center text-sm font-medium text-blue-700 underline">{t("privacy.details")}</a>
    </div>
    {error && <Alert variant="error">{error}</Alert>}
    {notice && <Alert variant="success">{notice}</Alert>}
    <div className="flex flex-wrap gap-3">
      <Button type="button" variant="outline" disabled={busy || !requests || requests.some(row => row.kind === "export" && ["received", "in_review"].includes(row.status))} onClick={() => submit("export")}>{t("privacy.requestExport")}</Button>
      <Button type="button" variant="outline" disabled={busy || !requests || requests.some(row => row.kind === "delete" && ["received", "in_review"].includes(row.status))} onClick={() => submit("delete")}>{t("privacy.requestDeletion")}</Button>
    </div>
    {!requests && !error && <p role="status" className="text-sm text-slate-600">{t("privacy.loading")}</p>}
    {requests && <div aria-label={t("privacy.list")}>
      {requests.length === 0 ? <p className="text-sm text-slate-600">{t("privacy.none")}</p> :
        <ul className="divide-y divide-slate-200 border-y border-slate-200">{requests.map(row => <li key={row.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm">
          <span className="font-medium text-slate-900">{t(`privacy.kind.${row.kind}`)} · {formatDate(row.created_at, undefined, words?.locale)}</span>
          <span className="text-slate-700">{t(`privacy.status.${row.status}`)}</span>
        </li>)}</ul>}
    </div>}
    {operatorAvailable && <Link href="/settings/privacy-requests" className="inline-flex min-h-11 items-center text-sm font-medium text-blue-700 underline underline-offset-4">{t("privacy.operatorQueue")}</Link>}
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
      <span className="min-w-0 flex-1 break-all text-slate-800">{privacyRequestSubject(row)} · {english(`privacy.kind.${row.kind}`)} · {english(`privacy.status.${row.status}`)} · {formatDate(row.created_at)}</span>
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