import { createTranslator } from "use-intl/core";
import en from "../../messages/en.json";
import hi from "../../messages/hi.json";
import { timeAgo } from "@/lib/utils";

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

/** One namespace's messages, for a server page to hand a client component (the rest stays on the server). */
export function namespaceMessages<Namespace extends keyof Messages>(locale: AppLocale, namespace: Namespace): Messages[Namespace] {
  return MESSAGES[locale][namespace];
}

/** #1774: "10m ago" in English (unchanged); in Hindi, Intl's words ("2 दिन पहले"), same steps. */
export function timeAgoIn(locale: AppLocale, date: Date, now: Date = new Date()): string {
  if (locale === "en") return timeAgo(date, now);
  const secs = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (secs < 45) return "अभी";
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "always" });
  const mins = Math.round(secs / 60);
  if (mins < 60) return format.format(-mins, "minute");
  const hours = Math.round(mins / 60);
  return hours < 24 ? format.format(-hours, "hour") : format.format(-Math.round(hours / 24), "day");
}

/** Synchronous, so it works the same in server components, plain helpers and tests. */
export function translator<Namespace extends keyof Messages>(locale: AppLocale, namespace: Namespace) {
  return createTranslator({ locale, messages: MESSAGES[locale], namespace });
}

export type OwnerErrorKey = keyof Messages["errors"];
/** #2312: values for an error with placeholders (amounts, counts, a select). */
export type OwnerErrorValues = Record<string, string | number>;

/** #2333: a business-access refusal (requireOwnedBusiness) in the owner's words, by its code; its message is English. */
export const BUSINESS_ACCESS_ERRORS = {
  UNAUTHENTICATED: "signInRequired", NOT_FOUND: "businessMissing", FORBIDDEN: "businessAccessDenied",
  CONFLICT: "businessAccessUnchecked", UNAVAILABLE: "businessAccessUnchecked",
} as const satisfies Record<string, OwnerErrorKey>;

/** #2305: an owner-facing API error in one language; routes keep their status codes and `code` fields unchanged. */
export function ownerErrorIn(locale: AppLocale, key: OwnerErrorKey, values?: OwnerErrorValues): string {
  return translator(locale, "errors")(key, values);
}
