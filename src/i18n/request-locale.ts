import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { LOCALE_COOKIE, toLocale, type AppLocale } from "@/i18n/locale";

/** #1438: the app language the owner picked in Settings; English when unset or unreadable. */
export async function requestLocale(): Promise<AppLocale> {
  try {
    return toLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  } catch (error) {
    unstable_rethrow(error);
    return "en";
  }
}
