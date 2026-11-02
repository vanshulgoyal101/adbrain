"use client";

import { useId, useState, useTransition } from "react";
import { CheckCircle2 } from "lucide-react";
import { saveBrandFact } from "@/app/(app)/brand/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { translator, type AppLocale } from "@/i18n/locale";
import { BRAND_METER_SNOOZE_COOKIE, meterCounts, type BrandMeter } from "@/lib/brand/meter";
import { PROOF_CHIPS } from "@/lib/brand/setup-fields";
import { proofFacts } from "@/lib/creative/proof-line";

type Segment = keyof typeof PROOF_CHIPS;

/** A #1966 line counts as proof only if, once filled in, preflight would find a proof fact in it. */
function countsAsProof(template: string): boolean {
  return proofFacts([template.replace(/\{n\}/g, "100").replace(/\{[^}]*\}/g, "Mohali")]).length > 0;
}

/**
 * #2032: Home's Brand meter. One ranked nudge for the top missing fact; Add saves it to the Brand for the
 * next Create, Not now hides the card for 7 days (a cookie, so the server leaves it out and nothing shifts).
 */
export function BrandMeterCard({ businessId, meter, segment, locale = "en" }: {
  businessId: string;
  meter: BrandMeter;
  segment: string | null;
  locale?: AppLocale;
}) {
  const t = translator(locale, "workQueue");
  const ts = translator(locale, "setup");
  const id = useId();
  const [state, setState] = useState<"nudge" | "editing" | "saved" | "hidden">("nudge");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const fact = meter.next;
  if (!fact || state === "hidden") return null;

  const known = segment && segment in PROOF_CHIPS ? (segment as Segment) : null;
  const example = known && (fact === "offer" || fact === "audience") ? t(`meter.examples.${known}.${fact}`) : null;
  const chips = known && (fact === "proof" || fact === "why")
    ? PROOF_CHIPS[known].map((key) => ts(`business.proof.chips.${key}`)).filter((chip) => fact === "why" || countsAsProof(chip))
    : [];

  function notNow() {
    document.cookie = `${BRAND_METER_SNOOZE_COOKIE}=1; max-age=${7 * 24 * 60 * 60}; path=/; samesite=lax`;
    setState("hidden");
  }

  function save() {
    // Unfilled #1966 blanks get the server's own words; anything else the meter wouldn't count is asked for here.
    if (!/[{}]/.test(value) && value.trim() && (fact === "offer" || fact === "proof") && !meterCounts(fact, value)) {
      setError(t(`meter.needs.${fact}`));
      return;
    }
    startSaving(async () => {
      const result = await saveBrandFact(businessId, fact!, value);
      if (result.ok) setState("saved");
      else setError(result.error ?? null);
    });
  }

  return (
    <section aria-labelledby={`${id}-title`} className="rounded-lg border border-slate-200 bg-white p-4 sm:p-6">
      <h3 id={`${id}-title`} className="text-base font-semibold text-slate-950">{t("meter.title", { n: meter.known, total: meter.total })}</h3>
      <div className="mt-3 flex gap-1" aria-hidden="true">
        {Array.from({ length: meter.total }, (_, index) => (
          <span key={index} className={`h-1.5 flex-1 rounded-full ${index < meter.known ? "bg-primary" : "bg-slate-200"}`} />
        ))}
      </div>
      {state === "saved" ? (
        <p role="status" className="mt-4 flex items-start gap-2 text-sm text-slate-700">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
          {t("meter.saved")}
        </p>
      ) : (
        <>
          <p className="mt-4 max-w-xl text-sm text-slate-700">
            {t(`meter.${fact}`)}
            {example && <> {t("meter.example", { example })}</>}
          </p>
          {state === "editing" ? (
            <form className="mt-4 flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); save(); }}>
              <label htmlFor={`${id}-field`} className="text-sm font-medium text-slate-900">{t(`meter.label.${fact}`)}</label>
              <Input id={`${id}-field`} value={value} maxLength={200} autoFocus
                aria-invalid={error ? true : undefined} aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
                onChange={(event) => { setValue(event.target.value); setError(null); }} />
              {chips.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {chips.map((chip) => (
                    <button key={chip} type="button" onClick={() => { setValue(chip); setError(null); }}
                      className="min-h-11 max-w-full rounded-lg border border-slate-300 px-3 py-2 text-left text-sm text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
                      {chip}
                    </button>
                  ))}
                </div>
              )}
              {error && <p id={`${id}-error`} className="text-sm font-medium text-red-800">{error}</p>}
              <p id={`${id}-help`} className="text-sm text-slate-600">{t("meter.nextCreate")}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" variant="secondary" disabled={saving || !value.trim()}>{t("meter.save")}</Button>
                <Button type="button" variant="quiet" onClick={() => { setState("nudge"); setError(null); }}>{t("meter.cancel")}</Button>
              </div>
            </form>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={() => setState("editing")}>{t("meter.add")}</Button>
              <Button type="button" variant="quiet" onClick={notNow}>{t("meter.notNow")}</Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
