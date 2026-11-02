"use client";

import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { WhatsAppEnquiries } from "@/components/whatsapp-enquiries";
import type { WhatsAppChatRow } from "@/lib/campaign/real-enquiries";
import { formatNumber } from "@/lib/format";
import { enquiriesTranslator, type Words } from "@/i18n/words";

/**
 * #764/#1260: each WhatsApp campaign is one quiet strip on Enquiries. AdBrain can't read the chats, so it says
 * how many Meta counted as started (chats, not people; CPO) and offers Add an enquiry and Got a customer? +1.
 */
export function WhatsAppChats({ rows, words }: { rows: WhatsAppChatRow[]; words?: Words<"enquiries"> }) {
  const [logged, setLogged] = useState<Record<string, number>>({});
  if (!rows.length) return null;
  const t = enquiriesTranslator(words);
  return (
    <section aria-labelledby="whatsapp-chats-title" className="flex flex-col gap-3">
      <h2 id="whatsapp-chats-title" className="sr-only">{t("chats.heading")}</h2>
      {rows.map((row) => {
        const loggedCount = logged[row.id] ?? row.realEnquiries;
        return (
        <article key={row.id} aria-label={t("chats.from", { name: row.name })} className="flex flex-col gap-3 rounded-lg bg-slate-50 px-4 py-3">
          <p className="flex gap-2 text-sm leading-6 text-slate-700">
            <MessageCircle className="mt-1 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
            <span className="min-w-0 break-words">{row.chats > 0
              ? t("chats.started", { count: row.chats, chats: formatNumber(row.chats), name: row.name })
              : loggedCount > 0
                ? t("chats.added", { count: loggedCount, logged: formatNumber(loggedCount), name: row.name })
                : t("chats.none", { name: row.name })}</span>
          </p>
          <WhatsAppEnquiries compact campaignId={row.id} spend={row.spend} enquiries={loggedCount} words={words}
            onLogged={(count) => setLogged((current) => ({ ...current, [row.id]: count }))} />
        </article>
        );
      })}
    </section>
  );
}
