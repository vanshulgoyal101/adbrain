import { createTranslator } from "use-intl/core";
import en from "../../messages/en.json";
import type { AppLocale } from "@/i18n/locale";

/**
 * #1438: one namespace's words for code that also runs in the browser. The server picks the owner's language and
 * passes that namespace only (`namespaceMessages(locale, namespace)`), so one language ships; without it, English.
 */
export type Words<Namespace extends keyof typeof en> = { locale: AppLocale; messages: (typeof en)[Namespace] };

/** The results verdict's words (card, Home, walk page); English when none are passed. */
export function verdictTranslator(words?: Words<"verdict">) {
  return createTranslator({ locale: words?.locale ?? "en", messages: { verdict: words?.messages ?? en.verdict }, namespace: "verdict" });
}
