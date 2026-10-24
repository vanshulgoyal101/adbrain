import { useSyncExternalStore } from "react";

const RETURNING_KEY = "adbrain:returning-visitor";
const INTRO_SEEN_KEY = "adbrain:login-intro-seen";
const listeners = new Set<() => void>();

function read(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function write(key: string) {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    // Private mode: the visitor just sees the new-visitor view again.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** Called after a sign-in request succeeds, so the next visit opens on "Welcome back". */
export function rememberReturningVisitor() {
  write(RETURNING_KEY);
  write(INTRO_SEEN_KEY);
}

export function markLoginIntroSeen() {
  write(INTRO_SEEN_KEY);
}

/** Server and first client render assume a new visitor; the stored value applies after hydration. */
export function useReturningVisitor() {
  return useSyncExternalStore(subscribe, () => read(RETURNING_KEY), () => false);
}

/** `true` on the server so the intro never flashes over the form before storage is read. */
export function useLoginIntroSeen() {
  return useSyncExternalStore(subscribe, () => read(INTRO_SEEN_KEY), () => true);
}
