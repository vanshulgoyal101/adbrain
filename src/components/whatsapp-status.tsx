"use client";

import { useState } from "react";
import { MessageCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseWhatsAppStatus, type WhatsAppStatus } from "@/lib/meta/whatsapp-status-shared";

/** #235: shows early whether WhatsApp chat ads can run, with a linking guide while they can't. */
export function WhatsAppStatusPanel({ businessId, initialStatus }: { businessId: string; initialStatus: WhatsAppStatus }) {
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
        WhatsApp chat ads
      </h2>
      <Button type="button" variant="outline" disabled={checking} onClick={checkAgain}>
        <RefreshCw aria-hidden="true" size={16} className={checking ? "animate-spin" : undefined} />
        Check again
      </Button>
    </div>
    <p role="status" className="text-sm text-slate-700">
      {status.state === "ready"
        ? `Ready: ${status.numbers.map(({ masked, source }) => `${masked} (${source === "page" ? "linked to your Page" : "your WhatsApp Business account"})`).join(", ")}`
        : status.state === "not_linked" ? "Not linked yet. Ads can't open a WhatsApp chat until a number is linked."
          : "WhatsApp status is unavailable. Connect Meta and choose your ad account and Page first."}
    </p>
    {status.state === "not_linked" && <div className="space-y-2 text-sm text-slate-600">
      <p className="font-medium text-slate-800">Link your WhatsApp number (either way works):</p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>On your Facebook Page: Settings → Linked accounts → WhatsApp. The code arrives as a WhatsApp message from Facebook, not an SMS.</li>
        <li>In the WhatsApp Business app: Settings → Business tools → Facebook &amp; Instagram. No code is needed.</li>
      </ol>
      <p>Then press Check again.</p>
    </div>}
  </section>;
}
