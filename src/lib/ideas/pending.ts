import { useSyncExternalStore } from "react";

// "Make one like this" survives the sign-up round trip here; the auth redirect keeps only the path.
const KEY = "adbrain:pending-idea-goal";

export function savePendingIdea(goal: string) {
  try { localStorage.setItem(KEY, goal); } catch { /* private mode: Create just starts empty */ }
}

/** Returns the saved goal once, then forgets it. */
export function takePendingIdea(): string | null {
  try {
    const goal = localStorage.getItem(KEY);
    localStorage.removeItem(KEY);
    return goal;
  } catch {
    return null;
  }
}

const subscribe = (listener: () => void) => {
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
};
const hasPending = () => { try { return localStorage.getItem(KEY) !== null; } catch { return false; } };

export function useHasPendingIdea() {
  return useSyncExternalStore(subscribe, hasPending, () => false);
}
