/**
 * Ad copy languages for localised creatives — tuned for the Indian market.
 * "Hinglish" (Hindi in Roman script) often reaches more people than Devanagari
 * on social, so it's offered as a first-class option.
 */

export interface AdLanguage {
  id: string;
  label: string;
  /** How to describe the language to the copywriting LLM. Empty = brand default. */
  promptName: string;
}

export const AD_LANGUAGES: AdLanguage[] = [
  { id: "brand", label: "Brand default", promptName: "" },
  { id: "en", label: "English", promptName: "English" },
  {
    id: "hinglish",
    label: "Hinglish (Roman script)",
    promptName:
      'Hinglish — Hindi written in Roman/Latin script, casual and natural (e.g. "Bijli ka bill aadha karo")',
  },
  { id: "hi", label: "Hindi (हिंदी)", promptName: "Hindi in Devanagari script" },
  {
    id: "pa",
    label: "Punjabi (ਪੰਜਾਬੀ)",
    promptName: "Punjabi in Gurmukhi script",
  },
  {
    id: "pa_roman",
    label: "Punjabi (Roman script)",
    promptName: "Punjabi written in Roman/Latin script",
  },
];

export function getAdLanguage(id: string | null | undefined): AdLanguage | undefined {
  if (!id) return undefined;
  return AD_LANGUAGES.find((l) => l.id === id);
}

/** The LLM-facing language description for an id ("" for brand default/unknown). */
export function languagePromptName(id: string | null | undefined): string {
  return getAdLanguage(id)?.promptName ?? "";
}

/** Short UI label for a language id (for badges); "" for brand default. */
export function languageLabel(id: string | null | undefined): string {
  const lang = getAdLanguage(id);
  if (!lang || lang.id === "brand" || lang.id === "en") return "";
  return lang.label;
}
