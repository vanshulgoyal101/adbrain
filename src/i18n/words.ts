import { createTranslator } from "use-intl/core";
import en from "../../messages/en.json";
import type { AppLocale } from "@/i18n/locale";
import { ageParts } from "@/lib/leads/digest";

/**
 * #1438: one namespace's words for code that also runs in the browser. The server picks the owner's language and
 * passes that namespace only (`namespaceMessages(locale, namespace)`), so one language ships; without it, English.
 */
export type Words<Namespace extends keyof typeof en> = { locale: AppLocale; messages: (typeof en)[Namespace] };

/** The results verdict's words (card, Home, walk page); English when none are passed. */
export function verdictTranslator(words?: Words<"verdict">) {
  return createTranslator({ locale: words?.locale ?? "en", messages: { verdict: words?.messages ?? en.verdict }, namespace: "verdict" });
}

/** The Campaigns list's words (header, filters, sync); English when none are passed. */
export function campaignsTranslator(words?: Words<"campaigns">) {
  return createTranslator({ locale: words?.locale ?? "en", messages: { campaigns: words?.messages ?? en.campaigns }, namespace: "campaigns" });
}

/** "3h ago" / "3 घंटे पहले" from the verdict words' age steps (#1438). */
export function ageText(t: ReturnType<typeof verdictTranslator>, iso: string, now = new Date()): string {
  const age = ageParts(iso, now);
  return !age || age.unit === "now" ? t("ads.age.now") : t(`ads.age.${age.unit}`, { n: age.n });
}
