import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { LOCALE_COOKIE, namespaceMessages, toLocale, type AppLocale } from "@/i18n/locale";
import type { Words } from "@/i18n/words";
import type { SetupWords } from "@/i18n/setup-words";

/** #1641: whether the owner has picked a language on this browser (step 1 offers the choice until then). */
export async function localeChosen(): Promise<boolean> {
  try {
    return Boolean((await cookies()).get(LOCALE_COOKIE)?.value);
  } catch (error) {
    unstable_rethrow(error);
    return true;
  }
}

/** #1438: one namespace's words in the owner's language, for a client component (only that language ships). */
export async function requestWords<Namespace extends Parameters<typeof namespaceMessages>[1]>(namespace: Namespace): Promise<Words<Namespace>> {
  const locale = await requestLocale();
  return { locale, messages: namespaceMessages(locale, namespace) };
}

/** #1438: the app language the owner picked in Settings; English when unset or unreadable. */
export async function requestLocale(): Promise<AppLocale> {
  try {
    return toLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  } catch (error) {
    unstable_rethrow(error);
    return "en";
  }
}

/** #1438: the first-ad setup's words in the owner's language, for the three step pages to pass to their client step. */
export function setupWords(): Promise<SetupWords> {
  return requestWords("setup");
}
