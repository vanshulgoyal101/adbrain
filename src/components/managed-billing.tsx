import { ArrowUpRight, CreditCard, Landmark, WalletCards } from "lucide-react";
import type { MetaConnection } from "@/lib/meta/credentials";
import { DEFAULT_PAYMENT_ALLOCATION_POLICY } from "@/lib/payments/allocation";
import { META_FUNDING_METHODS } from "@/lib/payments/meta-funding";

type BillingConnection = Pick<MetaConnection, "adAccountId" | "ready" | "pending" | "expired">;

const methodIcons = { upi_auto_reload: WalletCards, recurring_card: CreditCard, monthly_invoicing: Landmark };

export function ManagedBilling({ connection }: { connection: BillingConnection | null }) {
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
        <div><dt className="text-slate-500">Billing entity</dt><dd className="mt-1 font-medium text-slate-900">Solaride Energy</dd></div>
        <div><dt className="text-slate-500">Market</dt><dd className="mt-1 font-medium text-slate-900">India / INR</dd></div>
        <div><dt className="text-slate-500">Meta connection</dt><dd className="mt-1 font-medium text-slate-900">{connectionStatus}</dd></div>
        <div><dt className="text-slate-500">Selected ad account</dt><dd className="mt-1 break-all font-mono text-slate-900">{connection ? connection.adAccountId ?? "Not selected" : "Unavailable"}</dd></div>
        <div><dt className="text-slate-500">Planned account ownership</dt><dd className="mt-1 font-medium text-slate-900">Solaride-owned, separate per customer</dd></div>
        <div><dt className="text-slate-500">Funding verification</dt><dd className="mt-1 font-medium text-slate-900">Not verified</dd></div>
        <div><dt className="text-slate-500">New account capacity</dt><dd className="mt-1 font-medium text-slate-900">Not checked</dd></div>
      </dl>

      <div className="border-y border-slate-200 py-4">
        <h3 className="text-sm font-medium text-slate-700">Planned pre-tax allocation</h3>
        <dl className="mt-3 grid grid-cols-2 gap-4">
          <div><dt className="text-sm text-slate-500">Service fee</dt><dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{feePercent}%</dd></div>
          <div><dt className="text-sm text-slate-500">Advertising</dt><dd className="mt-1 text-2xl font-semibold tabular-nums text-emerald-700">{100 - feePercent}%</dd></div>
        </dl>
        <p className="mt-3 text-xs leading-5 text-slate-500">Tax policy pending approval. Gateway charges borne by AdBrain. No customer funds collected.</p>
      </div>

      <div>
        <h3 className="text-sm font-medium text-slate-700">Funding options</h3>
        <div className="mt-2 divide-y divide-slate-200">
          {META_FUNDING_METHODS.map(method => {
            const Icon = methodIcons[method.id];
            return (
              <details key={method.id} className="group py-3">
                <summary className="cursor-pointer rounded-sm text-sm font-medium text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600">
                  <Icon aria-hidden="true" className="mx-2 inline h-4 w-4 text-slate-500" />{method.name}
                </summary>
                <dl className="mt-3 space-y-3 pl-6 text-sm">
                  <div><dt className="text-slate-500">Availability</dt><dd className="mt-1 text-slate-700">{method.availability}</dd></div>
                  <div><dt className="text-slate-500">Payment timing</dt><dd className="mt-1 text-slate-700">{method.paymentTiming}</dd></div>
                  <div><dt className="text-slate-500">Required authorisation</dt><dd className="mt-1 text-slate-700">{method.setup}</dd></div>
                </dl>
                {method.accountSpendLimit === "unavailable" && <p className="mt-3 pl-6 text-xs leading-5 text-amber-800">Prepaid accounts have no Meta account spending limit. Reloads can leave unused funds; campaign budgets and reconciliation are required.</p>}
                <a href={method.documentationUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-10 items-center gap-1 rounded-sm pl-6 text-sm font-medium text-blue-700 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600">
                  Meta requirements for {method.name}<ArrowUpRight aria-hidden="true" className="h-4 w-4 shrink-0" />
                </a>
              </details>
            );
          })}
        </div>
      </div>

      <p className="text-sm leading-6 text-slate-600">No funding method selected. Meta-initiated charges do not transfer exactly 80% of each customer payment. Payment timing acceptance, account ownership, recurring authorisation and spend controls remain unverified.</p>
      <p className="text-xs leading-5 text-slate-500">Checkout, outbound transfers and automatic account creation are not enabled. Existing Meta connections and campaign settings are unchanged.</p>
    </section>
  );
}