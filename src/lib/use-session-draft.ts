"use client";

import { useEffect, useState } from "react";
import { useMounted } from "@/lib/use-mounted";

/**
 * Keep a value in sessionStorage so leaving the tab and coming back doesn't
 * throw away half-finished work.
 *
 * Restoring happens after mount rather than during render, so the server and
 * the first client render agree and nothing flickers. `revive` validates what
 * came out of storage — a stale or hand-edited entry must not crash the page.
 */
export function useSessionDraft<T>(
  key: string,
  initial: T,
  revive: (raw: unknown) => T | null,
): [T, React.Dispatch<React.SetStateAction<T>>, () => void] {
  const mounted = useMounted();
  const [value, setValue] = useState<T>(initial);
  const [restored, setRestored] = useState(false);

  if (mounted && !restored) {
    setRestored(true);
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const parsed = revive(JSON.parse(raw));
        if (parsed !== null) setValue(parsed);
      }
    } catch {
      // Unreadable draft — carry on with the initial value.
    }
  }

  useEffect(() => {
    if (!restored) return;
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Private mode or full quota; losing a draft isn't worth throwing.
    }
  }, [key, value, restored]);

  function clear() {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // Ignore — see above.
    }
  }

  return [value, setValue, clear];
}
