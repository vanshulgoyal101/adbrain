"use client";

import { useEffect, useId, useState } from "react";
import { Alert } from "@/components/ui/alert";

type Setting = { enabled: boolean; available: boolean };

export function LeadEmailSetting({ businessId }: { businessId: string }) {
  const [setting, setSetting] = useState<Setting | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputId = useId();

  useEffect(() => {
    let active = true;
    fetch(`/api/lead-email?businessId=${encodeURIComponent(businessId)}`, { cache: "no-store" }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not load the email setting.");
      return body as Setting;
    }).then(value => { if (active) setSetting(value); })
      .catch(cause => { if (active) setError((cause as Error).message); });
    return () => { active = false; };
  }, [businessId]);

  async function change(enabled: boolean) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/lead-email", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, enabled }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not save the email setting.");
      setSetting(body as Setting);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="lead-email-title" className="space-y-3 rounded-lg border border-slate-200 bg-white p-6">
      <h2 id="lead-email-title" className="font-semibold text-slate-900">Enquiry emails</h2>
      <p className="text-sm text-slate-600">
        Get an email within about 15 minutes of each new enquiry from a lead form, with the name, phone, their answers and a Call now link.
      </p>
      <label htmlFor={inputId} className="flex items-center gap-2 text-sm font-medium text-slate-800">
        <input id={inputId} type="checkbox" className="h-4 w-4" checked={setting?.enabled ?? false}
          disabled={!setting || busy} onChange={event => void change(event.target.checked)} />
        Email me about new enquiries
      </label>
      {setting && !setting.available && <p className="text-xs text-slate-500">Email alerts are not switched on yet. Your choice is saved for when they are.</p>}
      {error && <Alert variant="error">{error}</Alert>}
    </section>
  );
}
