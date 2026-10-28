"use client";

import { useState } from "react";
import { WhatsAppEnquiries } from "@/components/whatsapp-enquiries";
import type { WhatsAppChatRow } from "@/lib/campaign/real-enquiries";
import { formatNumber } from "@/lib/format";

/** #764: WhatsApp chats, the main result, beside form leads on Enquiries, each with its Add enquiry (#335). */
export function WhatsAppChats({ rows }: { rows: WhatsAppChatRow[] }) {
  const [logged, setLogged] = useState<Record<string, number>>({});
  if (!rows.length) return null;
  return (
    <section aria-labelledby="whatsapp-chats-title" className="flex flex-col gap-3">
      <h2 id="whatsapp-chats-title" className="text-lg font-semibold text-slate-900">WhatsApp chats</h2>
      <div className="grid gap-3 lg:grid-cols-2">
        {rows.map((row) => (
          <article key={row.id} aria-labelledby={`chats-${row.id}`} className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 id={`chats-${row.id}`} className="min-w-0 break-words font-medium text-slate-900">{row.name}</h3>
              <p className="text-sm text-slate-600">{formatNumber(row.chats)} {row.chats === 1 ? "chat" : "chats"} started</p>
            </div>
            <WhatsAppEnquiries campaignId={row.id} spend={row.spend} enquiries={logged[row.id] ?? row.realEnquiries}
              onLogged={(count) => setLogged((current) => ({ ...current, [row.id]: count }))} />
          </article>
        ))}
      </div>
    </section>
  );
}
