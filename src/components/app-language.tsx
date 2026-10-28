"use client";

import { useState, useTransition } from "react";
import { setAppLanguage } from "@/app/(app)/settings/language-actions";
import type { AppLocale } from "@/i18n/locale";

// Each language is named in its own script, so an owner can find theirs whatever is showing.
const CHOICES: { locale: AppLocale; name: string }[] = [{ locale: "en", name: "English" }, { locale: "hi", name: "हिंदी" }];

/** #1438: Settings' app-language switch; labels come from the server in the current language. */
export function AppLanguage({ initial, labels }: { initial: AppLocale; labels: { language: string; hint: string; saveFailed: string } }) {
  const [locale, setLocale] = useState(initial);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function choose(next: AppLocale) {
    if (next === locale) return;
    const previous = locale;
    setLocale(next);
    setFailed(false);
    startTransition(async () => {
      const result = await setAppLanguage(next).catch(() => ({ ok: false as const }));
      if (!result.ok) { setLocale(previous); setFailed(true); }
    });
  }

  return <section aria-labelledby="app-language-heading" className="space-y-3" lang={initial === "en" ? undefined : initial}>
    <div>
      <h2 id="app-language-heading" className="text-lg font-semibold text-slate-900">{labels.language}</h2>
      {labels.hint && <p className="text-sm text-slate-600">{labels.hint}</p>}
    </div>
    <div className="flex flex-wrap gap-2">
      {CHOICES.map((choice) => (
        <button key={choice.locale} type="button" lang={choice.locale} aria-pressed={locale === choice.locale} disabled={pending}
          onClick={() => choose(choice.locale)}
          className="inline-flex min-h-11 items-center rounded-md border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground">
          {choice.name}
        </button>
      ))}
    </div>
    {failed && <p role="alert" className="text-sm text-danger">{labels.saveFailed}</p>}
  </section>;
}

const HI_NOTE = "अभी सिर्फ़ होम हिंदी में है; बाकी स्क्रीन एक-एक करके जुड़ेंगी।";

/**
 * #1641 (CPO #1621): WS1 step 1's chooser, shown only until a language is chosen. Labelled in both scripts and
 * nothing pre-picked; one tap saves it (Settings keeps the full switch). English stays the default; never from the browser.
 */
export function CompactAppLanguage() {
  const [chosen, setChosen] = useState<AppLocale | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function choose(next: AppLocale) {
    setFailed(false);
    startTransition(async () => {
      const result = await setAppLanguage(next).catch(() => ({ ok: false as const }));
      if (result.ok) setChosen(next);
      else setFailed(true);
    });
  }

  if (chosen === "hi") return <p lang="hi" className="text-sm text-slate-600">{HI_NOTE}</p>;
  if (chosen) return null;
  return <div className="flex flex-col items-end gap-1">
    <div role="group" aria-labelledby="setup-language-label" className="flex flex-wrap items-center justify-end gap-2">
      <span id="setup-language-label" className="text-sm text-slate-600">Language / <span lang="hi">भाषा</span></span>
      {CHOICES.map((choice) => (
        <button key={choice.locale} type="button" lang={choice.locale} aria-pressed={false} disabled={pending}
          onClick={() => choose(choice.locale)}
          className="inline-flex min-h-11 items-center rounded-full border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">
          {choice.name}
        </button>
      ))}
    </div>
    {failed && <p role="alert" className="text-sm text-danger">Couldn&apos;t save. Try again. / <span lang="hi">सेव नहीं हुआ। फिर से चुनें।</span></p>}
  </div>;
}
