"use client";
import { useId } from "react";
import { CREATE_LANGUAGES, type CreateLanguageId } from "@/lib/languages";

const SCRIPT_LANG: Partial<Record<CreateLanguageId, string>> = { hi: "hi", pa: "pa" };

export function AdLanguagePicker({
  value,
  onChange,
  disabled,
}: {
  value: CreateLanguageId;
  onChange: (id: CreateLanguageId) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span id={`${id}-label`} className="text-sm font-medium text-slate-800">Ad language</span>
      <div role="radiogroup" aria-labelledby={`${id}-label`} className="flex flex-wrap gap-1.5">
        {CREATE_LANGUAGES.map((language) => (
          <label key={language.id} className={disabled ? "cursor-not-allowed" : "cursor-pointer"}>
            <input
              type="radio"
              name={`${id}-language`}
              value={language.id}
              checked={value === language.id}
              disabled={disabled}
              onChange={() => onChange(language.id)}
              className="peer sr-only"
            />
            <span
              lang={SCRIPT_LANG[language.id]}
              className="flex min-h-11 items-center rounded-full border border-slate-300 bg-white px-3.5 text-sm text-slate-700 transition-colors hover:border-blue-400 hover:text-blue-700 peer-checked:border-blue-600 peer-checked:bg-blue-50 peer-checked:font-medium peer-checked:text-blue-700 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-blue-600 peer-disabled:opacity-50 peer-disabled:hover:border-slate-300 peer-disabled:hover:text-slate-700 sm:min-h-9"
            >
              {language.label}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
