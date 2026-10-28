"use client";

import { formatMoneyExact } from "@/lib/format";
import { useEffect, useEffectEvent, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { customerBalanceViewSchema, type CustomerBalanceView as Balance } from "@/lib/payments/customer-balance-contracts";

const money = (paise: number) => formatMoneyExact(paise / 100);

export function CustomerBalance({ businessId, initialBalance = null }: { businessId: string; initialBalance?: Balance | null }) {
  const [storedBalance, setBalance] = useState<Balance | null>(initialBalance?.businessId === businessId ? initialBalance : null);
  const balance = storedBalance?.businessId === businessId ? storedBalance : null;
  const [errorBusinessId, setError] = useState<string | null>(null);
  const error = errorBusinessId === businessId;
  const [refresh, setRefresh] = useState(0);
  const load = useEffectEvent(async (signal: AbortSignal) => {
    try {
      const response = await fetch(`/api/payments/customer-balance?businessId=${encodeURIComponent(businessId)}`, { cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) });
      if (!response.ok) throw new Error();
      const payload = await response.json();
      const next = customerBalanceViewSchema.parse(payload.balance);
      if (next.businessId !== businessId) throw new Error();
      if (!signal.aborted) { setBalance(next); setError(null); }
    } catch {
      if (!signal.aborted) { setBalance(null); setError(businessId); }
    }
  });
  const serverLoaded = initialBalance?.businessId === businessId;
  useEffect(() => {
    if (serverLoaded && refresh === 0) return;
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) void load(controller.signal); });
    return () => controller.abort();
  }, [businessId, refresh, serverLoaded]);
  return <section aria-labelledby="customer-balance-title" className="min-w-0 space-y-3 border-t border-slate-200 pt-5">
    <div className="flex items-center justify-between gap-3">
      <h3 id="customer-balance-title" className="font-semibold text-slate-900">Ad budget</h3>
      <Button variant="outline" onClick={() => setRefresh(value => value + 1)} aria-label="Refresh ad budget" title="Refresh ad budget"><RefreshCw size={16} aria-hidden="true" /></Button>
    </div>
    {error ? <Alert variant="error">Ad budget is unavailable.</Alert> : !balance ? <p role="status">Checking ad budget</p> : <>
      {balance.held && <Alert>{balance.reason ?? "Funds are held for reconciliation."}</Alert>}
      {/* #1235 (CEO, CPO row 4): Available leads; no Paid and no total budget, which beside a payment would show AdBrain's margin. */}
      <dl className="space-y-3 text-sm">
        <div className="min-w-0"><dt className="text-slate-500">Available ad budget</dt>
          <dd className="text-2xl font-semibold tabular-nums text-slate-900">{money(balance.remainingPaise)}</dd>
          <dd className="text-slate-600">What your ads can still spend, including Meta&apos;s GST.</dd></div>
        <div className="grid gap-3 sm:grid-cols-3">
          {([
            ["Spent on ads, incl. Meta's GST", balance.mediaCostPaise + balance.taxCostPaise],
            ["Held for running campaigns", balance.reservedPaise],
            ["Refunded", balance.refundedPaise],
          ] as const).filter(([, amount]) => amount !== 0).map(([label, amount]) => <div key={label} className="min-w-0"><dt className="text-slate-500">{label}</dt><dd className="font-medium tabular-nums text-slate-900">{money(amount)}</dd></div>)}
        </div>
      </dl>
    </>}
  </section>;
}