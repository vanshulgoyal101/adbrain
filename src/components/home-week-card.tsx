"use client";

import { useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { translator, type AppLocale } from "@/i18n/locale";
import { formatMoney } from "@/lib/format";
import { WEEK_SUGGESTION_HREF, type WeekSummary } from "@/lib/home/week-summary";

const SUGGESTION = { quick_questions: "weekQuickQuestions", add_enquiries: "weekAddEnquiries", run_again: "weekRunAgain" } as const;
const ACTION = { quick_questions: "weekOpenCampaigns", add_enquiries: "weekAddEnquiriesAction", run_again: "weekRunAgainAction" } as const;

/** #1668 (CPO, #1654): last Monday-to-Sunday on Home, dismissible for the week. */
export function HomeWeekCard({ summary, locale = "en" }: { summary: WeekSummary; locale?: AppLocale }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  const t = translator(locale, "home");
  const spend = formatMoney(Math.round(summary.spend));
  return (
    <section aria-labelledby="week-title" className="relative rounded-lg border border-slate-200 bg-white p-4 pr-12">
      <h2 id="week-title" className="text-base font-semibold text-slate-900">
        {t("weekTitle", { chats: summary.chats, enquiries: summary.enquiries, spend })}
      </h2>
      {summary.bestAd && <p className="mt-1 text-sm text-slate-700">{t("weekBest", { name: summary.bestAd })}</p>}
      {summary.suggestion && (
        <div className="mt-3 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-700">{t(SUGGESTION[summary.suggestion])}</p>
          <Link href={WEEK_SUGGESTION_HREF[summary.suggestion]} className="inline-flex min-h-11 shrink-0 items-center font-medium text-blue-700 hover:underline">
            {t(ACTION[summary.suggestion])}
          </Link>
        </div>
      )}
      <button type="button" aria-label={t("weekDismiss")} data-product-event="home.week_summary_dismiss" onClick={() => setHidden(true)}
        className="absolute right-1 top-1 inline-flex h-11 w-11 items-center justify-center rounded-md text-slate-500 hover:bg-slate-50">
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </section>
  );
}
