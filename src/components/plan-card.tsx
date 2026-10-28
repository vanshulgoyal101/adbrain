"use client";

import { useState } from "react";
import { CreditCard, Loader2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import type { PlanStatus } from "@/lib/plan/status";

const day = (iso: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(iso));

/** #718 slice 2: the owner's ₹999 plan. No auto-debit: each month is a payment link the owner opens. */
export function PlanCard({ businessId, status, payUrl: initialUrl }: { businessId: string; status: PlanStatus; payUrl: string | null }) {
  const [openedUrl, setOpenedUrl] = useState<string | null>(null);
  const payUrl = openedUrl ?? initialUrl;
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (status.state === "exempt") return null;
  const due = status.state === "unpaid" || ((status.state === "free" || status.state === "paid") && status.dueSoon);
  const line = status.state === "trial_not_started" ? "Free until your first Go live, then one month free."
    : status.state === "unpaid" ? `Payment due since ${day(status.since)}. Running ads keep running; new ads and campaigns wait until you pay.`
      : status.state === "free" ? `Free until ${day(status.until)}.` : `Paid through ${day(status.until)}.`;
  async function open() {
    setWorking(true);
    setError(null);
    try {
      const response = await fetch("/api/payments/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessId }) });
      const body = await response.json().catch(() => ({})) as { payUrl?: string; error?: string };
      if (!response.ok || !body.payUrl) throw new Error(body.error ?? "Couldn't open the payment page. Try again.");
      setOpenedUrl(body.payUrl);
      window.location.assign(body.payUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't open the payment page. Try again.");
    } finally {
      setWorking(false);
    }
  }
  const button = "inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover";
  return (
    <div className="space-y-3">
      <h3 id="plan-title" className="font-semibold text-slate-900">Plan</h3>
      <p className="text-sm leading-6 text-slate-600">₹999 a month. First month free from your first Go live. No auto-debit. Stop anytime.</p>
      <p className="text-sm font-medium text-slate-900">{line}</p>
      {due && (payUrl
        ? <a href={payUrl} className={button}><CreditCard size={16} aria-hidden="true" />Pay ₹999</a>
        : <button type="button" className={button} disabled={working} onClick={() => void open()}>
          {working ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <CreditCard size={16} aria-hidden="true" />}Pay ₹999
        </button>)}
      {error && <Alert variant="error">{error}</Alert>}
    </div>
  );
}
