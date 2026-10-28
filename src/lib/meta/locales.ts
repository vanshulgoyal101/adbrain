/**
 * #773: the languages an owner may target, as Meta's ad locale keys (`targeting.locales`). Keys were read from
 * Graph `search?type=adlocale` on 2026-10-27. No languages means everyone in the area, whatever their language.
 */
export const AD_LANGUAGES = [
  { key: 1001, name: "English" },
  { key: 46, name: "Hindi" },
  { key: 47, name: "Punjabi" },
  { key: 81, name: "Marathi" },
  { key: 67, name: "Gujarati" },
  { key: 45, name: "Bengali" },
  { key: 48, name: "Tamil" },
  { key: 49, name: "Telugu" },
  { key: 75, name: "Kannada" },
  { key: 50, name: "Malayalam" },
  { key: 90, name: "Urdu" },
] as const;

export const AD_LANGUAGE_KEYS: ReadonlySet<number> = new Set(AD_LANGUAGES.map(language => language.key));

/** Meta stores a group locale as its members: English (All) 1001 reads back as English (US) 6 + (UK) 24 (recorded #773). */
const LOCALE_GROUPS: Readonly<Record<number, readonly number[]>> = { 1001: [6, 24] };

/** The locale keys as Meta reads them back, sorted, so a sent list can be compared with the stored one. */
export function storedLocales(keys: readonly number[]): number[] {
  return [...new Set(keys.flatMap(key => LOCALE_GROUPS[key] ?? [key]))].sort((a, b) => a - b);
}
