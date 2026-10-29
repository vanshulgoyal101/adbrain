"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HelpOnWhatsApp } from "@/components/support-link";
import type { AdReview } from "@/lib/meta/client";
import { rejectedAdsSentence, rejectionCopy, type RejectionAction } from "@/lib/meta/rejection-copy";
import { verdictTranslator, type Words } from "@/i18n/words";
import { cn } from "@/lib/utils";

const link = "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 hover:bg-slate-50 max-sm:min-h-11";

/** Meta's own words for the rejection the card names, for the card's Details (#1841: one Details per card). */
export function rejectedMetaMessage(reviews: AdReview[], vertical: string | null = null): string | null {
  const rejected = reviews.filter((review) => review.state === "rejected");
  return rejected.length ? rejectionCopy(rejected.flatMap((review) => review.feedback), { vertical })?.message ?? null : null;
}

/**
 * #1274 (CTO, #1305): a campaign with ads Meta didn't approve says why in one owner sentence, with the fix as the
 * row's actions. #1841 (Designer, #1633's pattern): a quiet amber rule, not a filled box, since the other ads still
 * run; Meta's own message is in the card's Details (`rejectedMetaMessage`). Null when no ad is rejected or no reason.
 */
export function RejectedAds({ reviews, spend, running = false, vertical = null, onEditAd, adsManagerUrl, ownDetails = false, className, words }: {
  reviews: AdReview[];
  spend: number;
  /** The campaign is on, so the approved ads are showing ("Your other 2 ads are running."). */
  running?: boolean;
  /** The Brand's category: the IELTS and interiors pilots get their own words (#1645). */
  vertical?: string | null;
  /** Opens the ad's words editor (#765) with the row's hint, if any; left out where the words can't be edited. */
  onEditAd?: (hint?: string) => void;
  adsManagerUrl?: string;
  /** Meta's message under its own Details, for a card with no results (so no Details of its own) yet. */
  ownDetails?: boolean;
  className?: string;
  /** #1438: the owner's language (`verdict` namespace); English without. */
  words?: Words<"verdict">;
}) {
  const rejected = reviews.filter((review) => review.state === "rejected");
  const copy = rejected.length ? rejectionCopy(rejected.flatMap((review) => review.feedback), { vertical, words }) : null;
  if (!copy) return null;
  const t = verdictTranslator(words);
  const action = (kind: RejectionAction) => {
    switch (kind) {
      case "edit_words":
        return onEditAd ? <Button key={kind} size="sm" variant="outline" onClick={() => onEditAd(copy.editHint)}>{t("rejected.actions.edit_words")}</Button> : null;
      case "change_picture":
        return <Link key={kind} href="/create" className={link}>{t("rejected.actions.change_picture")}</Link>;
      case "message_us":
        return <HelpOnWhatsApp key={kind} label={t("rejected.actions.message_us")} className={link} />;
      case "check_whatsapp":
        return <Link key={kind} href="/brand" className={link}>{t("rejected.actions.check_whatsapp")}</Link>;
      case "ask_meta_review":
        return adsManagerUrl
          ? <a key={kind} href={adsManagerUrl} target="_blank" rel="noopener noreferrer" className={link}><ExternalLink className="h-4 w-4" aria-hidden="true" />{t("rejected.actions.ask_meta_review")}</a>
          : null;
    }
  };
  return (
    <div role="group" aria-label={t("rejected.label")} className={cn("flex flex-col gap-2 border-l-2 border-amber-500 pl-3", className)}>
      <p className="text-sm leading-snug text-slate-900">{rejectedAdsSentence(copy, { rejected: rejected.length, total: reviews.length, spent: spend, running, words })}</p>
      <div className="flex flex-wrap gap-2">{copy.actions.map(action)}</div>
      {ownDetails && (
        <details className="text-sm">
          <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium text-slate-700 [&::-webkit-details-marker]:hidden">{t("rejected.details")}</summary>
          <p className="wrap-break-word text-slate-700">{t("rejected.metaMessage", { message: copy.message })}</p>
        </details>
      )}
    </div>
  );
}
