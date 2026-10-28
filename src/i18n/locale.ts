import { createTranslator } from "use-intl/core";
import en from "../../messages/en.json";
import hi from "../../messages/hi.json";

/** #1438: English is the default; Hindi is wired screen by screen from the CPO's tables. */
export const LOCALES = ["en", "hi"] as const;
export type AppLocale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = "en";
/** The owner's choice, kept per browser (no migration). */
export const LOCALE_COOKIE = "adbrain_lang";

export function toLocale(value: string | null | undefined): AppLocale {
  return LOCALES.find((locale) => locale === value) ?? DEFAULT_LOCALE;
}

type Messages = typeof en;
const MESSAGES: Record<AppLocale, Messages> = { en, hi };

/** Synchronous, so it works the same in server components, plain helpers and tests. */
export function translator<Namespace extends keyof Messages>(locale: AppLocale, namespace: Namespace) {
  return createTranslator({ locale, messages: MESSAGES[locale], namespace });
}
