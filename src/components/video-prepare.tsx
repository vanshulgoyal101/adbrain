"use client";

import { useEffect, useRef, useState } from "react";

export type VideoPreparationState = "working" | "delayed" | "waiting" | "ready" | "error";
const POLL_MS = 5_000;
const POLL_SPACING_MS = 2_500;
const LONG_WAIT_MS = 15 * 60_000;
const MAX_FAILURES = 3;
const send: typeof fetch = (...args) => fetch(...args);
const videoId = (value: unknown) => typeof value === "string" && /^\d{1,30}$/.test(value);
const currentTime = () => Date.now();

export type VideoPrepareWords = {
  working: string; delayed: string; waiting: string; ready: string; error: string; retry: string;
};

type Task = { request: typeof fetch; controller: AbortController; timer: ReturnType<typeof setTimeout> | null; started: number };

function stopTask(task: Task) {
  task.controller.abort();
  if (task.timer !== null) clearTimeout(task.timer);
}

/**
 * #781 (#749): prepare selected videos in the business's own account. Processing keeps being checked; a failed video
 * is retried only on the owner's request. Removing a selection cancels its request and timer.
 */
export function VideoPrepare({ assetIds, labels, words, request = send, onProgress }: {
  assetIds: string[];
  labels?: Record<string, string>;
  words: VideoPrepareWords;
  request?: typeof fetch;
  onProgress?: (state: VideoPreparationState) => void;
}) {
  const ids = [...new Set(assetIds)].sort();
  const key = ids.join(",");
  const [previous, setPrevious] = useState({ key, request });
  const [progress, setProgress] = useState<Record<string, VideoPreparationState>>({});
  const [retryVersion, setRetryVersion] = useState(0);
  const tasks = useRef(new Map<string, Task>());
  const retries = useRef(new Set<string>());
  const pollMs = useRef(POLL_MS);

  if (previous.key !== key || previous.request !== request) {
    const oldIds = new Set(previous.key ? previous.key.split(",") : []);
    const kept: Record<string, VideoPreparationState> = {};
    if (previous.request === request) {
      for (const id of ids) if (oldIds.has(id) && progress[id]) kept[id] = progress[id];
    }
    setPrevious({ key, request });
    setProgress(kept);
  }

  useEffect(() => {
    const chosen = key ? key.split(",") : [];
    const wanted = new Set(chosen);
    const active = tasks.current;
    pollMs.current = Math.max(POLL_MS, chosen.length * POLL_SPACING_MS);
    for (const [id, task] of active) {
      if (!wanted.has(id) || task.request !== request) {
        stopTask(task);
        active.delete(id);
      }
    }
    for (const id of retries.current) if (!wanted.has(id)) retries.current.delete(id);
    for (const id of chosen) {
      if (active.has(id)) continue;
      const task: Task = { request, controller: new AbortController(), timer: null, started: currentTime() };
      active.set(id, task);
      const step = async (failures: number, retry: boolean) => {
        let next: VideoPreparationState = "working";
        let misses = failures;
        let delay = pollMs.current;
        try {
          const response = await request(`/api/media/${encodeURIComponent(id)}/meta`, {
            method: "POST",
            signal: task.controller.signal,
            ...(retry ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ retry: true }) } : {}),
          });
          misses = 0;
          if (response.status === 429) {
            next = "waiting";
            const seconds = Number(response.headers.get("Retry-After"));
            if (Number.isFinite(seconds) && seconds > 0) delay = Math.max(delay, Math.min(seconds, 2_147_000) * 1_000);
          } else if (!response.ok) {
            next = "error";
          } else {
            const body: unknown = await response.json();
            if (typeof body !== "object" || body === null || !("status" in body) || !("kind" in body) || body.kind !== "video") {
              next = "error";
            } else if (body.status === "ready") {
              next = "videoId" in body && videoId(body.videoId) ? "ready" : "error";
            } else if (body.status === "processing" && "videoId" in body && (body.videoId === null || videoId(body.videoId))) {
              next = currentTime() - task.started >= LONG_WAIT_MS ? "delayed" : "working";
            } else {
              next = "error";
            }
          }
        } catch {
          if (task.controller.signal.aborted) return;
          misses = failures + 1;
          next = misses >= MAX_FAILURES ? "error" : "working";
        }
        if (task.controller.signal.aborted || active.get(id) !== task) return;
        setProgress((current) => current[id] === next ? current : { ...current, [id]: next });
        if (next !== "ready" && next !== "error") {
          task.timer = setTimeout(() => { task.timer = null; void step(misses, false); }, delay);
        }
      };
      void step(0, retries.current.delete(id));
    }
  }, [key, request, retryVersion]);

  useEffect(() => {
    const active = tasks.current;
    const pending = retries.current;
    return () => { active.forEach(stopTask); active.clear(); pending.clear(); };
  }, []);

  function retryFailed(id: string) {
    if (progress[id] !== "error") return;
    const task = tasks.current.get(id);
    if (task) stopTask(task);
    tasks.current.delete(id);
    retries.current.add(id);
    setProgress((current) => ({ ...current, [id]: "working" }));
    setRetryVersion((version) => version + 1);
  }

  const states = ids.map((id) => progress[id]);
  const state: VideoPreparationState = states.includes("error") ? "error"
    : states.includes("waiting") ? "waiting"
      : states.includes("delayed") ? "delayed"
        : states.every((item) => item === "ready") ? "ready" : "working";
  useEffect(() => { onProgress?.(state); }, [onProgress, state]);

  if (ids.length === 0) return null;
  return <ul className="mt-2 space-y-2">
    {ids.map((id) => {
      const current = progress[id] ?? "working";
      const label = labels?.[id];
      return <li key={id} className="min-w-0 text-sm">
        {label && <p className="wrap-break-word font-medium text-slate-800">{label}</p>}
        <p role={current === "error" ? "alert" : "status"} className={current === "error" ? "font-medium text-red-800" : "text-slate-600"}>{words[current]}</p>
        {current === "error" && <button type="button" aria-label={label ? `${words.retry}: ${label}` : words.retry}
          className="min-h-11 text-sm font-medium text-primary underline underline-offset-4" onClick={() => retryFailed(id)}>{words.retry}</button>}
      </li>;
    })}
  </ul>;
}
