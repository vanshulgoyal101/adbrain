import type { ReactNode } from "react";
import { ChevronRight, TriangleAlert } from "lucide-react";
import { formatMoney, formatPerDay } from "@/lib/format";
import type { CampaignDeliverySnapshot } from "@/lib/meta/client";
import type { ConnectionDTO } from "@/lib/meta/connect-contracts";

function metaState(status: string | null | undefined) {
  switch (status) {
    case "PAUSED":
    case "CAMPAIGN_PAUSED":
    case "ADSET_PAUSED": return "Paused in Meta";
    case "ACTIVE": return "Active in Meta";
    case "DISAPPROVED": return "Rejected by Meta";
    case "WITH_ISSUES": return "Needs attention in Meta";
    case "PENDING_REVIEW": return "In Meta's review";
    case "PENDING_BILLING_INFO": return "Payment information required in Meta";
    default: return status ? `Meta status: ${status.replaceAll("_", " ").toLowerCase()}` : "Meta status not confirmed";
  }
}

export function CampaignReviewSummary({
  name,
  dailyBudget,
  capped,
  selected,
  delivery,
  children,
}: {
  name: string | null;
  dailyBudget: number | null;
  capped: boolean;
  selected: ConnectionDTO["selected"];
  delivery: CampaignDeliverySnapshot | null;
  children: ReactNode;
}) {
  const attention = [
    ...(delivery?.adSets.map((adSet, i) => ({ label: `Ad set ${i + 1}`, status: adSet.effectiveStatus })) ?? []),
    ...(delivery?.ads.map((ad, i) => ({ label: `Ad ${i + 1}`, status: ad.effectiveStatus })) ?? []),
  ].filter(item => !["ACTIVE", "PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "PREAPPROVED"].includes(item.status ?? ""));

  return (
    <section aria-label="Campaign activation review" className="min-w-0 rounded-lg border border-amber-300 bg-white p-4 text-sm text-slate-700 sm:p-5">
      <h3 className="flex items-start gap-2 text-[17px] font-semibold text-slate-950">
        <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
        <span className="min-w-0 break-words">Review {name ?? "this campaign"} before it can run.</span>
      </h3>
      <dl className="mt-4 grid gap-3 border-b border-slate-100 pb-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-slate-500">Campaign state</dt>
          <dd className="mt-1 font-medium text-slate-900">{metaState(delivery?.campaign.effectiveStatus)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Effective daily total</dt>
          <dd className="mt-1 font-medium tabular-nums text-slate-900">{dailyBudget == null ? "Unavailable" : formatMoney(dailyBudget)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Duration</dt>
          <dd className="mt-1 text-slate-900">{capped ? "Choose the run length below" : "Existing ad set schedule in Meta"}</dd>
        </div>
      </dl>
      <p className="mt-4 text-slate-600">{capped
        ? "AdBrain will copy these ads into a new ad set with a fixed total budget and end date, then turn on only that ad set, its ads and the campaign."
        : "AdBrain will request only the parent campaign to become active; it will not change any ad sets or ads."}</p>
      {selected && <p className="mt-2 break-words text-xs text-slate-500">
        Account: {selected.accountName} · Page: {selected.pageName} · Currency: {selected.currency} · Timezone: {selected.timezoneName}
      </p>}
      {attention.length > 0 && <ul aria-label="Meta delivery warnings" className="mt-3 space-y-1 text-amber-900">
        {attention.map(item => <li key={item.label}>{item.label}: {metaState(item.status)}</li>)}
      </ul>}
      {children}
      {delivery && (
        <details className="group mt-4 border-t border-slate-100 pt-2">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md font-medium text-slate-700 hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
            <ChevronRight className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
            Targeting and Meta details
          </summary>
          <div className="space-y-3 break-words pt-2 text-xs text-slate-600">
            {selected && <p>Account ID: {selected.adAccountId} · Page ID: {selected.pageId}</p>}
            <p>Parent: {delivery.campaign.id} · Requested {delivery.campaign.status} · Effective {delivery.campaign.effectiveStatus ?? "unconfirmed"}</p>
            <ul className="space-y-3">
              {delivery.adSets.map(adSet => <li key={adSet.id}>
                Ad set {adSet.id}: {adSet.dailyBudgetPaise ? formatPerDay(adSet.dailyBudgetPaise / 100) : "campaign-level budget"}, destination {adSet.destinationType ?? "not reported"}, requested {adSet.status}, effective {adSet.effectiveStatus ?? "unconfirmed"}
                <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-md bg-slate-50 p-3 text-xs">Targeting: {JSON.stringify(adSet.targeting)}</pre>
              </li>)}
              {delivery.ads.map(ad => <li key={ad.id}>Ad {ad.id} (set {ad.adSetId}, creative {ad.creativeId}): requested {ad.status}, effective {ad.effectiveStatus ?? "unconfirmed"}</li>)}
            </ul>
          </div>
        </details>
      )}
    </section>
  );
}
