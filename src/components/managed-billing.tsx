import { WalletCards } from "lucide-react";
import type { MetaConnection } from "@/lib/meta/credentials";
import { TestCheckout } from "@/components/test-checkout";
import { ProductionCheckout } from "@/components/production-checkout";
import { CustomerBalance } from "@/components/customer-balance";
import type { CustomerBalanceView as Balance } from "@/lib/payments/customer-balance-contracts";

type BillingConnection = Pick<MetaConnection, "adAccountId" | "ready" | "pending" | "expired">;

export function ManagedBilling({ connection, testBusinessId, liveBusinessId, initialBalance = null }: {
  connection: BillingConnection | null; testBusinessId?: string; liveBusinessId?: string; initialBalance?: Balance | null;
}) {
  if (liveBusinessId) return <>
    <ProductionCheckout key={liveBusinessId} businessId={liveBusinessId} />
    <CustomerBalance key={`allowance-${liveBusinessId}`} businessId={liveBusinessId} initialBalance={initialBalance} />
  </>;
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
        <p className="text-sm leading-6 text-slate-700">Pay any amount from ₹500. Your ad budget pays for Meta&apos;s ads and GST; AdBrain makes and runs the ads.</p>
        <p className="mt-3 text-xs leading-5 text-slate-500">One business, one offer and one service area for 12 months, including up to two ads and one capped Meta campaign. Gateway fees are on us. No extra checkout charge, automatic renewal or guaranteed results.</p>
      </div>

      <p className="text-sm leading-6 text-slate-600">The operator pays Meta separately. Your ad budget is not yet a confirmed Meta balance. Payment confirmation does not authorize ad activation.</p>
      <p className="text-sm leading-6 text-slate-600">Full refund before we start work. After that, your unused ad budget is refundable once pending Meta costs are settled. Mandatory customer rights remain applicable.</p>
      <p className="text-xs leading-5 text-slate-500">Live collection is not enabled here. No bank-to-Meta transfer or automatic account creation is performed by AdBrain.</p>
      {testBusinessId && <TestCheckout key={testBusinessId} businessId={testBusinessId} />}
    </section>
  );
}
/**
 * #759 (CTO): payment appears only where AdBrain holds ad money (managed). An own-account owner pays Meta
 * directly and an operator-funded business is paid by the operator, so neither is asked to pay; nor is anyone
 * while the funding mode can't be read.
 */
export function BillingSection({ mode, ...billing }: { mode: "managed" | "own" | "operator" | null } & Parameters<typeof ManagedBilling>[0]) {
  if (mode === "managed") return <ManagedBilling {...billing} />;
  if (mode !== "own") return null;
  return (
    <section aria-labelledby="own-billing-title" className="space-y-2 border-t border-slate-200 pt-6">
      <h2 id="own-billing-title" className="flex items-center gap-2 font-semibold text-slate-900">
        <WalletCards aria-hidden="true" className="h-5 w-5 text-blue-600" />
        Billing
      </h2>
      <p className="text-sm leading-6 text-slate-600">You pay Meta directly from your ad account. AdBrain&apos;s pilot is free.</p>
    </section>
  );
}
