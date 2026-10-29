import { WalletCards } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import type { MetaConnection } from "@/lib/meta/credentials";
import { TestCheckout } from "@/components/test-checkout";
import { ProductionCheckout } from "@/components/production-checkout";
import { CustomerBalance } from "@/components/customer-balance";
import { PlanCard } from "@/components/plan-card";
import type { PlanStatus } from "@/lib/plan/status";
import { BillingTabs, type BillingTab } from "@/components/billing-tabs";
import type { CustomerBalanceView as Balance } from "@/lib/payments/customer-balance-contracts";

type BillingConnection = Pick<MetaConnection, "adAccountId" | "ready" | "pending" | "expired">;

/** #1358: a business with any money shows its Ad budget first; one that hasn't paid yet starts on Payments. */
export function initialBillingTab(balance: Balance | null, requested?: string | null): BillingTab {
  if (requested === "payments" || requested === "budget") return requested;
  const anyMoney = balance && [balance.remainingPaise, balance.reservedPaise, balance.mediaCostPaise, balance.taxCostPaise, balance.refundedPaise].some((paise) => paise > 0);
  return anyMoney ? "budget" : "payments";
}

export function ManagedBilling({ connection, testBusinessId, liveBusinessId, initialBalance = null, billingTab }: {
  connection: BillingConnection | null; testBusinessId?: string; liveBusinessId?: string; initialBalance?: Balance | null;
  /** `/settings?billing=payments|budget` opens that tab. */
  billingTab?: string | null;
}) {
  if (liveBusinessId) return <BillingTabs key={liveBusinessId} initialTab={initialBillingTab(initialBalance, billingTab)}
    budget={<CustomerBalance key={`allowance-${liveBusinessId}`} businessId={liveBusinessId} initialBalance={initialBalance} />}
    payments={<ProductionCheckout key={liveBusinessId} businessId={liveBusinessId} />} />;
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
export function BillingSection({ mode, plan, planBusinessId, planUnavailable = false, ...billing }: { mode: "managed" | "own" | "operator" | null;
  /** #718 slice 2: an own-account owner's ₹999 plan, when plan billing is on. */
  plan?: { status: PlanStatus; payUrl: string | null } | null; planBusinessId?: string; planUnavailable?: boolean } & Parameters<typeof ManagedBilling>[0]) {
  if (mode === "managed") return <ManagedBilling {...billing} />;
  if (mode !== "own") return null;
  return (
    <section aria-labelledby="own-billing-title" className="space-y-2 border-t border-slate-200 pt-6">
      <h2 id="own-billing-title" className="flex items-center gap-2 font-semibold text-slate-900">
        <WalletCards aria-hidden="true" className="h-5 w-5 text-blue-600" />
        Billing
      </h2>
      {planUnavailable ? <>
        <p className="text-sm leading-6 text-slate-600">You pay Meta directly from your ad account.</p>
        <Alert variant="error">Your plan is unavailable right now. Refresh Settings to try again.</Alert>
      </> : plan && planBusinessId ? <>
        <p className="text-sm leading-6 text-slate-600">You pay Meta directly from your ad account.</p>
        <PlanCard businessId={planBusinessId} status={plan.status} payUrl={plan.payUrl} />
      </> : <p className="text-sm leading-6 text-slate-600">You pay Meta directly from your ad account. Your first month of AdBrain is free; after that it&apos;s ₹999 a month.</p>}
    </section>
  );
}
