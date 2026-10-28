// @vitest-environment jsdom
// #1541: one polling rule for every client poller: back off on 429, pause while the tab is hidden, stop on 401.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pollDelay, usePoll } from "@/lib/use-poll";

const reply = (status: number, headers: Record<string, string> = {}) => new Response(null, { status, headers });

describe("pollDelay", () => {
  it("waits the usual interval after an answer or a network error", () => {
    expect(pollDelay(reply(200), 5_000)).toBe(5_000);
    expect(pollDelay(reply(500), 5_000)).toBe(5_000);
    expect(pollDelay(null, 5_000)).toBe(5_000);
  });

  it("honours Retry-After on 429, in seconds or as a date", () => {
    expect(pollDelay(reply(429, { "Retry-After": "30" }), 5_000)).toBe(30_000);
    const now = Date.parse("2026-10-28T17:00:00Z");
    expect(pollDelay(reply(429, { "Retry-After": "Wed, 28 Oct 2026 17:02:00 GMT" }), 5_000, now)).toBe(120_000);
  });

  it("a 429 never polls sooner than usual, waits a minute without a header, and at most 10 minutes", () => {
    expect(pollDelay(reply(429, { "Retry-After": "1" }), 5_000)).toBe(5_000);
    expect(pollDelay(reply(429), 5_000)).toBe(60_000);
    expect(pollDelay(reply(429, { "Retry-After": "3600" }), 5_000)).toBe(600_000);
  });

  it("stops on 401: signed out", () => {
    expect(pollDelay(reply(401), 5_000)).toBeNull();
  });
});

describe("usePoll", () => {
  let hidden = false;
  beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
  });
  afterEach(() => vi.useRealTimers());

  const setHidden = async (value: boolean) => {
    hidden = value;
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  };
  const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  it("polls at once and then every interval", async () => {
    const task = vi.fn(async () => reply(200));
    renderHook(() => usePoll(task, { intervalMs: 5_000 }));
    await advance(0);
    expect(task).toHaveBeenCalledTimes(1);
    await advance(5_000);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("doesn't poll while the tab is hidden, and catches up when it's shown", async () => {
    const task = vi.fn(async () => reply(200));
    renderHook(() => usePoll(task, { intervalMs: 5_000 }));
    await advance(0);
    await setHidden(true);
    await advance(60_000);
    expect(task).toHaveBeenCalledTimes(1);
    await setHidden(false);
    await advance(0);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("waits out Retry-After after a 429", async () => {
    const task = vi.fn(async () => reply(429, { "Retry-After": "30" }));
    renderHook(() => usePoll(task, { intervalMs: 5_000 }));
    await advance(0);
    await advance(29_000);
    expect(task).toHaveBeenCalledTimes(1);
    await advance(1_000);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("a hidden tab shown again before Retry-After still waits", async () => {
    const task = vi.fn(async () => reply(429, { "Retry-After": "30" }));
    renderHook(() => usePoll(task, { intervalMs: 5_000 }));
    await advance(0);
    await setHidden(true);
    await setHidden(false);
    await advance(10_000);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("stops for good after a 401", async () => {
    const task = vi.fn(async () => reply(401));
    renderHook(() => usePoll(task, { intervalMs: 5_000 }));
    await advance(0);
    await setHidden(true);
    await setHidden(false);
    await advance(600_000);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("keeps polling after a network error", async () => {
    const task = vi.fn(async () => { throw new TypeError("offline"); });
    renderHook(() => usePoll(task, { intervalMs: 5_000 }));
    await advance(5_000);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("starts over when its key changes, aborting the old request", async () => {
    const signals: AbortSignal[] = [];
    const task = vi.fn(async (signal: AbortSignal) => { signals.push(signal); return reply(200); });
    const { rerender } = renderHook(({ id }) => usePoll(task, { intervalMs: 5_000, key: id }), { initialProps: { id: "a" } });
    await advance(0);
    rerender({ id: "b" });
    expect(signals[0].aborted).toBe(true);
    await advance(0);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("does nothing while disabled, and stops and aborts on unmount", async () => {
    const signals: AbortSignal[] = [];
    const task = vi.fn(async (signal: AbortSignal) => { signals.push(signal); return reply(200); });
    const { rerender, unmount } = renderHook(({ enabled }) => usePoll(task, { intervalMs: 5_000, enabled }), { initialProps: { enabled: false } });
    await advance(20_000);
    expect(task).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await advance(0);
    expect(task).toHaveBeenCalledTimes(1);
    unmount();
    expect(signals[0].aborted).toBe(true);
    await advance(20_000);
    expect(task).toHaveBeenCalledTimes(1);
  });
});
