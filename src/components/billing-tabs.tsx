"use client";

import { useId, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export type BillingTab = "budget" | "payments";

/**
 * #1358 (CEO rule): a payment amount never appears on the same screen as any budget figure. Ad budget and
 * Payments are two tabs and only the open one is rendered, so "You pay ₹X" or a receipt never sits beside
 * "Available ad budget ₹Y".
 */
export function BillingTabs({ budget, payments, initialTab }: { budget: ReactNode; payments: ReactNode; initialTab: BillingTab }) {
  const [tab, setTab] = useState<BillingTab>(initialTab);
  const id = useId();
  const tabs: [BillingTab, string][] = [["budget", "Ad budget"], ["payments", "Payments"]];
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Billing" className="inline-flex gap-1 rounded-lg bg-slate-100 p-1">
        {tabs.map(([value, label]) => (
          <button key={value} type="button" role="tab" id={`${id}-${value}`} aria-selected={tab === value} aria-controls={`${id}-panel`}
            className="min-h-11 rounded-md px-4 text-sm font-medium text-slate-600 aria-selected:bg-white aria-selected:text-slate-900 aria-selected:shadow-sm"
            onClick={() => setTab(value)}>{label}</button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`} className="space-y-4">
        {tab === "budget" ? <>
          {budget}
          <Button type="button" variant="outline" onClick={() => setTab("payments")}><Plus size={16} aria-hidden="true" />Add money</Button>
        </> : payments}
      </div>
    </div>
  );
}
