"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatClock } from "@/lib/format";
import type { TransferCheck } from "@/lib/prospect/transfer";
import type { RepTransferState } from "@/lib/prospect/transfer-server";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const time = (iso: string) => formatClock(iso).replace(/^.*?,\s*/, "");

/**
 * #1670 (Designer #1736 frames 1, 1b, 2): on a `+prospect` account, Settings hands the prepared business to its owner.
 * The rep types the owner's email; the owner signs in with it on their own phone and confirms on Home.
 */
export function ProspectHandOver({ businessId, businessName, ads, checks, latest }: {
  businessId: string; businessName: string; ads: number; checks: TransferCheck[]; latest: RepTransferState["latest"];
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(method: "POST" | "DELETE") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/prospect/transfer", {
        method, headers: { "content-type": "application/json" },
        body: JSON.stringify(method === "POST" ? { businessId, ownerEmail: email.trim() } : { businessId }),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? "Couldn't do that. Try again.");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't do that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const heading = <p className="text-sm font-semibold text-slate-900">{businessName} · {ads} {ads === 1 ? "ad" : "ads"}</p>;

  if (latest?.state === "pending") {
    return (
      <section aria-labelledby="hand-over-title" className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        <div>
          <h2 id="hand-over-title" className="text-xl font-semibold text-slate-950">Waiting for the owner</h2>
          {heading}
        </div>
        <div className="rounded-md bg-slate-50 p-4 text-sm">
          <p className="text-slate-600">Handing over to</p>
          <p className="font-semibold text-slate-950">{latest.targetEmail}</p>
          <p className="mt-2 text-slate-600">Ends at {time(latest.expiresAt)} (30 minutes)</p>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-900">On the owner&apos;s phone</h3>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-700">
            <li>Open adbrain.vanshul.com/login</li>
            <li>Continue with Google, or Email me a sign-in link, as this email</li>
            <li>Tap Make it mine</li>
          </ol>
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <Button variant="danger" className="w-full" disabled={busy} onClick={() => void send("DELETE")}>Cancel hand-over</Button>
        <p className="text-xs text-slate-500">Once they confirm, the business is theirs and leaves this account.</p>
      </section>
    );
  }

  const ready = checks.every((check) => check.ok) && EMAIL.test(email.trim());
  return (
    <section aria-labelledby="hand-over-title" className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <div>
        <h2 id="hand-over-title" className="text-xl font-semibold text-slate-950">Hand this account to the owner</h2>
        {heading}
      </div>
      {latest?.state === "declined" && <p className="text-sm text-slate-700">{latest.targetEmail} said this isn&apos;t their business. Check the email with the owner.</p>}
      {latest?.state === "expired" && <p className="text-sm text-slate-700">The hand-over to {latest.targetEmail} ended at {time(latest.expiresAt)}. Start again.</p>}
      <div>
        <label htmlFor="owner-email" className="text-sm font-medium text-slate-900">Owner&apos;s email</label>
        <input id="owner-email" type="email" autoComplete="off" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)}
          className="mt-1 block min-h-11 w-full rounded-md border border-slate-300 px-3 text-sm" aria-describedby="owner-email-hint" />
        <p id="owner-email-hint" className="mt-1 text-xs text-slate-600">They sign in with this email on their own phone, then confirm. Check it with them: a wrong email can&apos;t take it over.</p>
      </div>
      <ul className="space-y-2 text-sm">
        {checks.map((check) => (
          <li key={check.label} className="flex gap-2">
            {check.ok
              ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-primary" aria-label="Passed" />
              : <AlertCircle size={18} className="mt-0.5 shrink-0 text-danger" aria-label="Needs fixing" />}
            <span className="text-slate-800">{check.ok ? check.label : check.problem}</span>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button className="w-full" disabled={!ready || busy} onClick={() => void send("POST")}>Hand to owner</Button>
    </section>
  );
}
