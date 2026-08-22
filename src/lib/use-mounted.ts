"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * Returns `false` on the server and during the first client render, then
 * `true` after hydration. Gate any time-relative or otherwise
 * non-deterministic UI behind this so the server HTML and the first client
 * render match exactly — preventing React hydration mismatches that show up as
 * flickering elements.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
