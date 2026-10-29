"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PILOT_DAY7_REASONS, type PilotDay7Answer } from "@/lib/feedback/pilot-day7";
import { translator, type AppLocale } from "@/i18n/locale";

/**
 * #1650 (CPO #1644): after the first week, one tap for 'would you pay ₹999 a month?' and one for why. Codes only
 * reach the server; 'Not now' hides it for 3 days (at most twice).
 */
export function PilotDay7Card({ businessId, locale = "en" }: { businessId: string; locale?: AppLocale }) {
  const t = translator(locale, "pilotDay7");
  const [answer, setAnswer] = useState<PilotDay7Answer | null>(null);
  const [state, setState] = useState<"asking" | "saving" | "thanks" | "hidden">("asking");
  const [failed, setFailed] = useState(false);

  async function send(body: Record<string, unknown>, done: "thanks" | "hidden") {
    setState("saving");
    setFailed(false);
    const ok = await fetch("/api/feedback/pilot-day7", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessId, ...body }) })
      .then((response) => response.ok, () => false);
    if (ok) setState(done);
    else { setState("asking"); setFailed(true); }
  }

  if (state === "hidden") return null;
  const busy = state === "saving";
  return (
    <section aria-label={t("question")} className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
      {state === "thanks" ? <p role="status" className="text-sm text-slate-900">{t("thanks")}</p> : <>
        <p className="text-sm font-medium text-slate-900">{t("question")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(["yes", "maybe", "no"] as const).map((value) => (
            <Button key={value} type="button" size="sm" variant={answer === value ? "primary" : "outline"} className="min-h-11" aria-pressed={answer === value}
              disabled={busy} onClick={() => setAnswer(value)}>{t(value)}</Button>
          ))}
          {!answer && <Button type="button" size="sm" variant="ghost" className="min-h-11" disabled={busy} onClick={() => void send({ dismiss: true }, "hidden")}>{t("notNow")}</Button>}
        </div>
        {answer && <>
          <p className="mt-4 text-sm text-slate-600">{t("why")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {PILOT_DAY7_REASONS[answer].map((reason) => (
              <Button key={reason} type="button" size="sm" variant="outline" className="min-h-11" disabled={busy}
                onClick={() => void send({ answer, reason }, "thanks")}>{t(`reason.${reason}`)}</Button>
            ))}
          </div>
        </>}
        {failed && <p role="alert" className="mt-3 text-sm text-danger">{t("saveFailed")}</p>}
      </>}
    </section>
  );
}
