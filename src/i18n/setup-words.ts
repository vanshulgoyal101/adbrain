import { createTranslator } from "use-intl/core";
import en from "../../messages/en.json";
import type { Words } from "@/i18n/words";

/**
 * #1438: the first-ad setup's words for client components. The server page passes the owner's language and that one
 * namespace (`namespaceMessages(locale, "setup")`); without it the steps read in English, as before.
 */
export type SetupWords = Words<"setup">;

export function setupTranslator(words?: SetupWords) {
  return createTranslator({ locale: words?.locale ?? "en", messages: { setup: words?.messages ?? en.setup }, namespace: "setup" });
}
