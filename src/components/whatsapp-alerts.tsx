"use client";

import { useState, useTransition } from "react";
import { MessageCircle } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { saveAlertSettings, startAlertVerification } from "@/app/(app)/settings/whatsapp-alerts-actions";
import type { AlertSettings } from "@/lib/alerts/alert-settings";

const FAILED = "Couldn't save your alert settings. Try again.";

/**
 * #701: Settings → WhatsApp alerts. Each new enquiry within a minute and one daily results line,
 * on the owner's own WhatsApp, only after they confirm the number by sending START. STOP ends both.
 */
export function WhatsAppAlerts({ businessId, initial }: { businessId: string; initial: AlertSettings }) {
  const [settings, setSettings] = useState(initial);
  const [draft, setDraft] = useState({ leadAlerts: initial.leadAlerts, dailyResults: initial.dailyResults, language: initial.language });
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const changed = draft.leadAlerts !== settings.leadAlerts || draft.dailyResults !== settings.dailyResults || draft.language !== settings.language;

  const save = () => startTransition(async () => {
    const result = await saveAlertSettings({ businessId, ...draft }).catch(() => ({ ok: false as const, error: FAILED }));
    if (!result.ok) { setMessage({ ok: false, text: result.error }); return; }
    setSettings(result.settings);
    setMessage({ ok: true, text: draft.leadAlerts || draft.dailyResults
      ? result.settings.number ? "Saved. Alerts go to your WhatsApp." : "Saved. Confirm your WhatsApp number below to start getting them."
      : "Saved. Alerts are off." });
  });
  const confirm = () => startTransition(async () => {
    const result = await startAlertVerification({ businessId }).catch(() => ({ ok: false as const, error: "Couldn't start the confirmation. Try again." }));
    if (!result.ok) { setMessage({ ok: false, text: result.error }); return; }
    setMessage(null);
    setLink(result.link);
  });

  return <section aria-labelledby="whatsapp-alerts-title" className="rounded-lg border border-slate-200 bg-white p-6">
    <h2 id="whatsapp-alerts-title" className="flex items-center gap-2 font-semibold text-slate-900"><MessageCircle className="h-4 w-4" aria-hidden="true" />WhatsApp alerts</h2>
    <p className="mt-1 text-sm text-slate-600">Get each new enquiry on WhatsApp within a minute, so you can call back while they&apos;re still interested.</p>
    <div className="mt-4 grid gap-3">
      <label className="flex items-start gap-3 text-sm text-slate-800">
        <input type="checkbox" checked={draft.leadAlerts} onChange={(event) => { setDraft({ ...draft, leadAlerts: event.target.checked }); setMessage(null); }} className="mt-0.5 h-4 w-4 accent-blue-600" />
        <span><span className="font-medium">Every new enquiry</span><span className="block text-xs text-slate-500">Name, phone, their answers and which ad, with a tap to call.</span></span>
      </label>
      <label className="flex items-start gap-3 text-sm text-slate-800">
        <input type="checkbox" checked={draft.dailyResults} onChange={(event) => { setDraft({ ...draft, dailyResults: event.target.checked }); setMessage(null); }} className="mt-0.5 h-4 w-4 accent-blue-600" />
        <span><span className="font-medium">Yesterday&apos;s results, 9 am</span><span className="block text-xs text-slate-500">One line: spend, enquiries and cost per enquiry.</span></span>
      </label>
      <label className="grid max-w-xs gap-1 text-sm font-medium text-slate-800">Language
        <select value={draft.language} onChange={(event) => { setDraft({ ...draft, language: event.target.value as "en" | "hi" }); setMessage(null); }} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal">
          <option value="en">English</option>
          <option value="hi">हिंदी (Hindi)</option>
        </select>
      </label>
      <div><Button type="button" variant="outline" disabled={pending || !changed} onClick={save}>Save alerts</Button></div>
    </div>
    <div className="mt-5 border-t border-slate-100 pt-4 text-sm text-slate-700">
      {settings.number && !settings.optedOut
        ? <p>Alerts go to <span className="whitespace-nowrap font-medium">{settings.number}</span>. Reply STOP on WhatsApp anytime to turn them off.</p>
        : <p>{settings.optedOut ? "You replied STOP, so alerts are off. Send START from your WhatsApp to turn them back on." : "Confirm the WhatsApp number that should get alerts: send one message from it."}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {link
          ? <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center rounded-md bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-700">Open WhatsApp and send START</a>
          : <Button type="button" variant="outline" disabled={pending} onClick={confirm}>{settings.number ? "Use another number" : "Confirm my WhatsApp number"}</Button>}
        {link && <span className="text-xs text-slate-500">The message is ready to send. The link works for 15 minutes.</span>}
      </div>
    </div>
    {message && <div className="mt-4"><Alert variant={message.ok ? undefined : "error"}>{message.text}</Alert></div>}
  </section>;
}
