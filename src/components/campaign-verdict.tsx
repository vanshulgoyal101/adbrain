import Link from "next/link";
import type { ReactNode } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Verdict } from "@/lib/campaign/verdict";
import { formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

// Links that look like the small buttons (#847: 44 px on a phone).
const link = "inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium max-sm:min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const primary = cn(link, "bg-primary text-primary-foreground hover:bg-primary-hover");
const outline = cn(link, "border border-slate-300 bg-white text-slate-900 hover:bg-slate-50");

/**
 * #1274 (#1255 slice 2): a campaign card answers "Is it working? What should I do?" with one sentence, one number and
 * at most one action. The figures it replaces stay one tap away under Details.
 */
export function CampaignVerdict({ verdict, whatsapp, results, spend, details, onRunAgain, runAgainBusy = false, adsManagerUrl, onEditAd }: {
  verdict: Verdict;
  whatsapp: boolean;
  results: number;
  spend: number;
  details: ReactNode;
  onRunAgain?: () => void;
  runAgainBusy?: boolean;
  adsManagerUrl?: string;
  /** #1274 (CPO): state 3's action opens the ad's copy editor (#765); editing a running campaign's message is later. */
  onEditAd?: () => void;
}) {
  const noun = (n: number) => whatsapp ? (n === 1 ? "chat" : "chats") : (n === 1 ? "enquiry" : "enquiries");
  const action = (() => {
    switch (verdict.action) {
      case "reply":
        return <Link href="/leads" className={primary}>Reply now</Link>;
      case "run_again":
        return onRunAgain ? (
          <Button size="sm" onClick={onRunAgain} disabled={runAgainBusy}>
            {runAgainBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Run this again
          </Button>
        ) : null;
      case "new_ads":
        return <Link href="/create" className={outline}>Try new ads</Link>;
      case "meta_status":
        return adsManagerUrl ? (
          <a href={adsManagerUrl} target="_blank" rel="noopener noreferrer" className={outline}><ExternalLink className="h-4 w-4" aria-hidden="true" />See Meta&apos;s status</a>
        ) : null;
      case "edit_message":
        return onEditAd ? <Button size="sm" variant="outline" onClick={onEditAd}>Edit the ad</Button> : null;
      // "Pause this ad" lives on the ad's own row (#1045, Which ad worked).
      default:
        return null;
    }
  })();
  return (
    <section aria-label="How it's going" className="flex flex-col gap-2">
      <p className="text-[17px] leading-snug text-slate-900">{verdict.sentence}</p>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-[32px] font-semibold leading-none tabular-nums text-slate-950">
          {verdict.number.kind === "cost" ? formatMoney(verdict.number.value) : formatNumber(verdict.number.value)}
        </span>
        <span className="text-sm text-slate-600">
          {verdict.number.kind === "cost" ? `per ${noun(1)} · ${formatNumber(results)} ${noun(results)}, ${formatMoney(spend)} spent`
            : `${noun(verdict.number.value)}${spend > 0 ? ` · ${formatMoney(spend)} spent` : ""}`}
        </span>
      </p>
      {action && <div className="pt-1">{action}</div>}
      <details className="group text-sm">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium text-slate-700 [&::-webkit-details-marker]:hidden">Details</summary>
        <div className="flex flex-col gap-3 pt-1">{details}</div>
      </details>
    </section>
  );
}
