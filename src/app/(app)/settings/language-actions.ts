"use server";

import { cookies } from "next/headers";
import { observeAction } from "@/lib/observability/logger";
import { LOCALE_COOKIE, toLocale } from "@/i18n/locale";

/** #1438: the owner's app language, kept on this browser for a year; Home reads it on the next render. */
export async function setAppLanguage(value: string): Promise<{ ok: true } | { ok: false }> {
  return observeAction("server.setAppLanguage", async () => {
    (await cookies()).set(LOCALE_COOKIE, toLocale(value), {
      path: "/", maxAge: 365 * 24 * 60 * 60, sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production",
    });
    return { ok: true };
  });
}
