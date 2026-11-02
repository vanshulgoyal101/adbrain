"use client";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { noticesTranslator, type Words } from "@/i18n/words";

const NoticesContext = createContext<Words<"notices"> | undefined>(undefined);

/** #2345: the (app) layout passes the owner's `notices` words once, so client fallbacks needn't be threaded as props. */
export function NoticesProvider({ words, children }: { words: Words<"notices">; children: ReactNode }) {
  return <NoticesContext.Provider value={words}>{children}</NoticesContext.Provider>;
}

/** The fallback words for a client component; English outside the provider (tests, pages outside the app shell). */
export function useNotices() {
  const words = useContext(NoticesContext);
  return useMemo(() => noticesTranslator(words), [words]);
}
