import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { LOCALE_COOKIE, toLocale, type AppLocale } from "@/i18n/locale";

/** #1641: whether the owner has picked a language on this browser (step 1 offers the choice until then). */
export async function localeChosen(): Promise<boolean> {
  try {
    return Boolean((await cookies()).get(LOCALE_COOKIE)?.value);
  } catch (error) {
    unstable_rethrow(error);
    return true;
  }
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
