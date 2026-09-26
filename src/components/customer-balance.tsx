"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { customerBalanceSchema, type CustomerBalance as Balance } from "@/lib/payments/customer-balance-contracts";

const money = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(paise / 100);

export function CustomerBalance({ businessId }: { businessId: string }) {
  const [storedBalance, setBalance] = useState<Balance | null>(null);
  const balance = storedBalance?.businessId === businessId ? storedBalance : null;
  const [errorBusinessId, setError] = useState<string | null>(null);
  const error = errorBusinessId === businessId;
  const [refresh, setRefresh] = useState(0);
  const load = useEffectEvent(async (signal: AbortSignal) => {
    try {
      const response = await fetch(`/api/payments/customer-balance?businessId=${encodeURIComponent(businessId)}`, { cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) });
      if (!response.ok) throw new Error();
      const payload = await response.json();
      const next = customerBalanceSchema.parse(payload.balance);
      if (next.businessId !== businessId) throw new Error();
      if (!signal.aborted) { setBalance(next); setError(null); }
    } catch {
      if (!signal.aborted) { setBalance(null); setError(businessId); }
    }
  });
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) void load(controller.signal); });
    return () => controller.abort();
  }, [businessId, refresh]);
  return <section aria-labelledby="customer-balance-title" className="min-w-0 space-y-3 border-t border-slate-200 pt-5">
    <div className="flex items-center justify-between gap-3">
      <h3 id="customer-balance-title" className="font-semibold text-slate-900">Advertising allowance</h3>
      <Button variant="outline" onClick={() => setRefresh(value => value + 1)} aria-label="Refresh advertising allowance" title="Refresh advertising allowance"><RefreshCw size={16} aria-hidden="true" /></Button>
    </div>
    {error ? <Alert variant="error">Advertising allowance is unavailable.</Alert> : !balance ? <p role="status">Checking allowance</p> : <>
      {balance.held && <Alert>{balance.reason ?? "Funds are held for reconciliation."}</Alert>}
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        {([
          ["Verified customer payments", balance.capturedPaise], ["Verified refunds", balance.refundedPaise],
          ["Service allocation", balance.serviceAllocationPaise], ["Advertising allocation, including tax", balance.advertisingAllocationPaise],
          ["Attributed media costs", balance.mediaCostPaise], ["Attributed Meta tax", balance.taxCostPaise],
          ["Reserved for campaigns and pending costs", balance.reservedPaise], ["Available for a new reservation", balance.remainingPaise],
        ] as const).map(([label, amount]) => <div key={label} className="min-w-0"><dt className="text-slate-500">{label}</dt><dd className="font-medium tabular-nums text-slate-900">{money(amount)}</dd></div>)}
      </dl>
    </>}
  </section>;
}