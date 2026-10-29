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

/** Languages the owner can pick when creating ads. */
export type CreateLanguageId = "en" | "hinglish" | "hi" | "pa";

export const CREATE_LANGUAGES: { id: CreateLanguageId; label: string }[] = [
  { id: "en", label: "English" },
  { id: "hinglish", label: "Hinglish" },
  { id: "hi", label: "हिंदी" },
  { id: "pa", label: "ਪੰਜਾਬੀ" },
];

const BRAND_LANGUAGE_ALIASES = new Map<string, CreateLanguageId>([
  ["english", "en"],
  ["en", "en"],
  ["hinglish", "hinglish"],
  ["hindi", "hi"],
  ["हिंदी", "hi"],
  ["हिन्दी", "hi"],
  ["hi", "hi"],
  ["punjabi", "pa"],
  ["ਪੰਜਾਬੀ", "pa"],
  ["pa", "pa"],
]);

/** #1681: the Brand language a Create language is saved as (Brand `languages[0]`). */
export const BRAND_LANGUAGE_NAME: Record<CreateLanguageId, string> = { en: "English", hinglish: "Hinglish", hi: "Hindi", pa: "Punjabi" };

/**
 * The first Brand language (free text) that maps to a Create language; else the segment's default (#1681, CPO #1669:
 * solar ads read best in Hinglish), else English.
 */
export function defaultAdLanguage(brandLanguages: string[] | null | undefined, vertical?: string | null): CreateLanguageId {
  for (const language of brandLanguages ?? []) {
    const id = BRAND_LANGUAGE_ALIASES.get(String(language).normalize("NFC").trim().toLowerCase());
    if (id) return id;
  }
  return /solar/i.test(vertical ?? "") ? "hinglish" : "en";
}

/** Short UI label for a language id (for badges); "" for brand default. */
export function languageLabel(id: string | null | undefined): string {
  const lang = getAdLanguage(id);
  if (!lang || lang.id === "brand" || lang.id === "en") return "";
  return lang.label;
}

const HINGLISH_WORDS = new Set(["mujhe", "humein", "hume", "chahiye", "karo", "karna", "karwa", "karwao", "banao", "banana", "hai", "hain",
  "liye", "aur", "nahi", "nahin", "kya", "apne", "apna", "apni", "mera", "meri", "hamara", "zyada", "jyada", "mein", "wala", "wale", "kaise", "abhi"]);

/** Hindi written in Roman script: at least two common Hindi words ("mujhe … chahiye"). */
export function isRomanHindi(text: string): boolean {
  const words = new Set(text.toLowerCase().match(/[a-z]+/g) ?? []);
  return [...HINGLISH_WORDS].filter((word) => words.has(word)).length >= 2;
}
