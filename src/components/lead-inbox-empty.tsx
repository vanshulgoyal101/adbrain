"use client";

import { useState } from "react";
import Link from "next/link";
import { WhatsAppEnquiries } from "@/components/whatsapp-enquiries";
import { enquiriesTranslator, type Words } from "@/i18n/words";

/**
 * #1597 (Designer, #1463): no enquiries anywhere: one block (title, line, one action) instead of banner, count, tabs,
 * search and a card that repeats it. The inbox keeps checking, so the first enquiry brings it back.
 */
export function LeadInboxEmpty({ metaReady, offerAlerts, addEnquiryFor, words }: {
  metaReady: boolean;
  offerAlerts: boolean;
  /** #1597: a WhatsApp campaign the block's 'Add an enquiry' logs to. */
  addEnquiryFor: { campaignId: string; spend: number; enquiries: number } | null;
  words?: Words<"enquiries">;
}) {
  const t = enquiriesTranslator(words);
  const [adding, setAdding] = useState(false);
  const solid = !metaReady || offerAlerts;
  return (
    <section aria-labelledby="enquiries-empty-title" className="mt-4 flex max-w-xl flex-col items-start gap-2">
      <h2 id="enquiries-empty-title" className="text-[17px] font-semibold leading-6 text-slate-900">{t("arrival.title")}</h2>
      <p className="text-[15px] leading-[22px] text-slate-600">{t(metaReady ? "arrival.ready" : "arrival.notReady")}</p>
      <Link href={!metaReady ? "/settings" : offerAlerts ? "/settings#whatsapp-alerts-title" : "/campaigns"}
        className={`mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md px-4 text-sm font-medium sm:w-auto ${solid
          ? "bg-[var(--primary)] text-white"
          : "border border-slate-300 text-slate-800 hover:bg-slate-50"}`}>
        {t(!metaReady ? "arrival.connect" : offerAlerts ? "arrival.alerts" : "arrival.campaigns")}
      </Link>
      {metaReady && addEnquiryFor && (adding
        ? <WhatsAppEnquiries compact campaignId={addEnquiryFor.campaignId} spend={addEnquiryFor.spend} enquiries={addEnquiryFor.enquiries}
          words={words} onLogged={() => window.location.reload()} />
        : <button type="button" className="inline-flex min-h-11 items-center text-sm font-medium text-blue-700 hover:underline" onClick={() => setAdding(true)}>{t("log.addAn")}</button>)}
    </section>
  );
}
