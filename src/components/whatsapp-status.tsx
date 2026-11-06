"use client";

import { useMemo, useState } from "react";
import { MessageCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseWhatsAppStatus, type WhatsAppStatus } from "@/lib/meta/whatsapp-status-shared";
import { settingsTranslator, type Words } from "@/i18n/words";

/** #235: shows early whether WhatsApp chat ads can run, with a linking guide while they can't. */
export function WhatsAppStatusPanel({ businessId, initialStatus, words }: { businessId: string; initialStatus: WhatsAppStatus; words?: Words<"settings"> }) {
  const t = useMemo(() => settingsTranslator(words), [words]);
  const [status, setStatus] = useState(initialStatus);
  const [checking, setChecking] = useState(false);

  async function checkAgain() {
    setChecking(true);
    try {
      const response = await fetch(`/api/meta/whatsapp?businessId=${encodeURIComponent(businessId)}`, { cache: "no-store" });
      setStatus(response.ok ? parseWhatsAppStatus(await response.json()) : { state: "unavailable" });
    } catch {
      setStatus({ state: "unavailable" });
    } finally {
      setChecking(false);
    }
  }

  return <section aria-labelledby="whatsapp-status-title" className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">
    <div className="flex items-center justify-between gap-3">
      <h2 id="whatsapp-status-title" className="flex items-center gap-2 font-semibold text-slate-900">
        <MessageCircle aria-hidden="true" className="h-5 w-5 text-emerald-600" />
        {t("whatsappStatus.title")}
      </h2>
      <Button type="button" variant="outline" disabled={checking} onClick={checkAgain}>
        <RefreshCw aria-hidden="true" size={16} className={checking ? "animate-spin" : undefined} />
        {t("whatsappStatus.checkAgain")}
      </Button>
    </div>
    <p role="status" className="text-sm text-slate-700">
      {status.state === "ready"
        ? <>
          {t("whatsappStatus.ready", { numbers: status.numbers.map(({ masked, source }) =>
            t(source === "page" ? "whatsappStatus.readyPage" : "whatsappStatus.readyBusiness", { number: masked })).join(", ") })}
          {status.businessUnavailable && <> {t("whatsappStatus.businessUnavailable")}</>}
        </>
        : t(status.state === "not_linked" ? "whatsappStatus.notLinked" : "whatsappStatus.unavailable")}
    </p>
    {status.state === "not_linked" && <div className="space-y-2 text-sm text-slate-600">
      <p className="font-medium text-slate-800">{t("whatsappStatus.linkTitle")}</p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>{t("whatsappStatus.linkPage")}</li>
        <li>{t("whatsappStatus.linkApp")}</li>
      </ol>
      <p>{t("whatsappStatus.then")}</p>
    </div>}
  </section>;
}
