"use client";

import { useEffect, useRef } from "react";

/** A 429 without Retry-After waits a minute; no wait is longer than 10 minutes. */
const NO_HEADER_MS = 60_000;
const MAX_MS = 600_000;

/**
 * #1541: how long to wait before the next poll; null means stop (401: signed out).
 * A 429 honours Retry-After (seconds or an HTTP date) but never polls sooner than usual.
 */
export function pollDelay(response: Pick<Response, "status" | "headers"> | null, intervalMs: number, now = Date.now()): number | null {
  if (!response) return intervalMs;
  if (response.status === 401) return null;
  if (response.status !== 429) return intervalMs;
  const header = response.headers.get("Retry-After")?.trim() ?? "";
  const asked = !header ? NaN : /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - now;
  return Math.min(MAX_MS, Math.max(intervalMs, Number.isFinite(asked) ? asked : NO_HEADER_MS));
}

/**
 * #1541: polls `task` at once and then every `intervalMs`, through `pollDelay`. While the tab is hidden
 * nothing is fetched; a poll that fell due meanwhile runs when the tab is shown or the window regains
 * focus. A thrown task (offline)
 * counts as a normal interval. `task` returns the Response it read so the hook can see 429/401.
 */
export function usePoll(
  task: (signal: AbortSignal) => Promise<Response | null | undefined>,
  { intervalMs, enabled = true, key = null }: {
    intervalMs: number;
    enabled?: boolean;
    /** What the poll is about (a business, an attempt); a new key aborts the old request and starts over. */
    key?: string | null;
  },
): void {
  const taskRef = useRef(task);
  useEffect(() => { taskRef.current = task; });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timer: number | null = null;
    let running = false;
    let stopped = false;
    const hidden = () => document.visibilityState === "hidden";

    async function tick() {
      timer = null;
      if (stopped || controller.signal.aborted || hidden()) return;
      running = true;
      let response: Response | null = null;
      try { response = (await taskRef.current(controller.signal)) ?? null; } catch { response = null; }
      running = false;
      if (controller.signal.aborted) return;
      const delay = pollDelay(response, intervalMs);
      if (delay === null) { stopped = true; return; }
      timer = window.setTimeout(() => void tick(), delay);
    }
    // A pending timer (including a 429's Retry-After) keeps its time; only a poll missed while hidden runs now.
    const onVisibility = () => { if (!hidden() && timer === null && !running) void tick(); };

    timer = window.setTimeout(() => void tick(), 0);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    return () => {
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
    };
  }, [enabled, intervalMs, key]);
}
