"use client";

import { CREATE_LANGUAGES, type CreateLanguageId } from "@/lib/languages";
import { cn } from "@/lib/utils";

const LANG_ATTR: Record<CreateLanguageId, string> = { en: "en", hinglish: "hi-Latn", hi: "hi", pa: "pa" };

/** #1681 (CPO #1669): the ad-language field before a first batch: "Your ads will be in" over English · Hinglish · हिंदी · ਪੰਜਾਬੀ. */
export function AdLanguageChips({ value, onChange, disabled = false }: {
  value: CreateLanguageId; onChange: (next: CreateLanguageId) => void; disabled?: boolean;
}) {
  return (
    // Designer (#1641): a form field, labelled like step 1's others, so it reads as business details, not the app picker.
    <div role="group" aria-labelledby="ad-language-label" className="flex flex-col gap-1.5">
      {/* CEO (owner, #1681): the ads' language, worded so it isn't taken for the app language. */}
      <span id="ad-language-label" className="text-sm font-medium text-slate-900">Your ads will be in</span>
      <div className="flex flex-wrap gap-2">
        {CREATE_LANGUAGES.map((language) => (
          <button key={language.id} type="button" lang={LANG_ATTR[language.id]} aria-pressed={value === language.id} disabled={disabled}
            onClick={() => onChange(language.id)}
            className={cn("inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium disabled:opacity-60",
              value === language.id ? "border-primary bg-primary/10 text-primary" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50")}>
            {language.label}
          </button>
        ))}
      </div>
    </div>
  );
}
