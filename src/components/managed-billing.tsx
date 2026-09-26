import { WalletCards } from "lucide-react";
import type { MetaConnection } from "@/lib/meta/credentials";
import { DEFAULT_PAYMENT_ALLOCATION_POLICY } from "@/lib/payments/allocation";
import { TestCheckout } from "@/components/test-checkout";
import { ProductionCheckout } from "@/components/production-checkout";
import { CustomerBalance } from "@/components/customer-balance";

type BillingConnection = Pick<MetaConnection, "adAccountId" | "ready" | "pending" | "expired">;

export function ManagedBilling({ connection, testBusinessId, liveBusinessId }: { connection: BillingConnection | null; testBusinessId?: string; liveBusinessId?: string }) {
  if (liveBusinessId) return <>
    <ProductionCheckout key={liveBusinessId} businessId={liveBusinessId} />
    <CustomerBalance key={`allowance-${liveBusinessId}`} businessId={liveBusinessId} />
  </>;
  const feePercent = DEFAULT_PAYMENT_ALLOCATION_POLICY.platformFeeBps / 100;
  const connectionStatus = !connection ? "Temporarily unavailable"
    : connection.expired ? "Reconnect required"
      : connection.ready ? "Connected"
        : connection.pending ? "Account selection required" : "Not connected";

  return (
    <section aria-labelledby="managed-billing-title" className="space-y-5 border-t border-slate-200 pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="managed-billing-title" className="flex items-center gap-2 font-semibold text-slate-900">
          <WalletCards aria-hidden="true" className="h-5 w-5 text-blue-600" />
          Managed billing
        </h2>
        <span className="text-sm font-medium text-amber-700">Not enabled</span>
      </div>

      <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
        <div><dt className="text-slate-500">Current operator</dt><dd className="mt-1 font-medium text-slate-900">Vanshul Goyal</dd></div>
        <div><dt className="text-slate-500">Market</dt><dd className="mt-1 font-medium text-slate-900">India / INR</dd></div>
        <div><dt className="text-slate-500">Meta connection</dt><dd className="mt-1 font-medium text-slate-900">{connectionStatus}</dd></div>
        <div><dt className="text-slate-500">Selected ad account</dt><dd className="mt-1 break-all font-mono text-slate-900">{connection ? connection.adAccountId ?? "Not selected" : "Unavailable"}</dd></div>
        <div><dt className="text-slate-500">Meta payment responsibility</dt><dd className="mt-1 font-medium text-slate-900">Operator-managed</dd></div>
      </dl>

      <div className="border-y border-slate-200 py-4">
        <h3 className="text-sm font-medium text-slate-700">Annual total: INR 10,000</h3>
        <dl className="mt-3 grid grid-cols-2 gap-4">
          <div><dt className="text-sm text-slate-500">Service allocation</dt><dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{feePercent}%</dd></div>
          <div><dt className="text-sm text-slate-500">Advertising</dt><dd className="mt-1 text-2xl font-semibold tabular-nums text-emerald-700">{100 - feePercent}%</dd></div>
        </dl>
        <p className="mt-3 text-xs leading-5 text-slate-500">One business, one offer and one service area for 12 months, including up to two creatives and one capped Meta campaign. Meta allocation includes applicable Meta tax. Gateway fees absorbed by AdBrain. No extra checkout charge, automatic renewal or guaranteed results.</p>
      </div>

      <p className="text-sm leading-6 text-slate-600">The operator pays Meta separately. Advertising allocation is not a confirmed Meta balance. Payment confirmation does not authorize ad activation.</p>
      <p className="text-sm leading-6 text-slate-600">Full refund before work starts. Afterward, unused advertising allocation is refundable after pending-cost reconciliation. Service allocation is earned only after the agreed creatives and campaign setup are delivered; otherwise it remains refundable.</p>
      <p className="text-xs leading-5 text-slate-500">Live collection is not enabled here. No bank-to-Meta transfer or automatic account creation is performed by AdBrain.</p>
      {testBusinessId && <TestCheckout key={testBusinessId} businessId={testBusinessId} />}
    </section>
  );
}