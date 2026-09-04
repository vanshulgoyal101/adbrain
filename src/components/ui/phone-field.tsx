"use client";

import { Input } from "@/components/ui/input";
import {
  COUNTRIES,
  flagEmoji,
  formatPhone,
  getCountry,
  parsePhone,
} from "@/lib/brand/countries";

/**
 * Phone entry with a country selector. The rest of the app stores a single
 * string (it's printed on the poster), so the parts are parsed out of that
 * value on render and recombined on change — no schema change.
 */
export function PhoneField({
  name,
  value,
  onChange,
  invalid,
}: {
  name: string;
  value: string;
  onChange: (next: string) => void;
  invalid?: boolean;
}) {
  const { countryCode, national } = parsePhone(value);
  const country = getCountry(countryCode);

  return (
    <div className="flex items-center gap-2">
      <input type="hidden" name={name} value={value} />

      <div className="relative shrink-0">
        <select
          aria-label="Country calling code"
          value={country.code}
          onChange={(e) => onChange(formatPhone(e.target.value, national))}
          className="h-10 w-40 appearance-none truncate rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
        >
          {COUNTRIES.map((c) => (
            // Name first so the browser's type-ahead still finds a country.
            <option key={c.code} value={c.code}>
              {c.name} (+{c.dial})
            </option>
          ))}
        </select>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-base leading-none"
        >
          {flagEmoji(country.code)}
        </span>
      </div>

      <Input
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        value={national}
        onChange={(e) => onChange(formatPhone(country.code, e.target.value))}
        placeholder="98765 43210"
        aria-invalid={invalid || undefined}
      />
    </div>
  );
}
