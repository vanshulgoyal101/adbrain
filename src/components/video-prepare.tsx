"use client";

import { useEffect, useState } from "react";

type Progress = "working" | "ready" | "error";
const POLL_MS = 5_000;

/**
 * #781 (#749): sends the owner's chosen photos and videos to the business's own ad account and polls until Meta has
 * prepared them, so Review finds them ready. One POST per file: `ready` or `error` ends it, `processing` is called
 * again. Nothing here creates an ad or spends; the server picks the account.
 */
export function VideoPrepare({ assetIds, words, request = (...args) => fetch(...args) }: {
  assetIds: string[];
  words: { working: string; ready: string; error: string };
  request?: typeof fetch;
}) {
  const key = [...new Set(assetIds)].sort().join(",");
  const [progress, setProgress] = useState<Record<string, Progress>>({});

  useEffect(() => {
    const ids = key ? key.split(",") : [];
    const stop = new AbortController();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const step = async (id: string) => {
      let next: Progress = "working";
      try {
        const response = await request(`/api/media/${encodeURIComponent(id)}/meta`, { method: "POST", signal: stop.signal });
        const body = response.ok ? await response.json() as { status?: string } : null;
        next = !body || body.status === "error" ? "error" : body.status === "ready" ? "ready" : "working";
      } catch {
        if (stop.signal.aborted) return;
        next = "working";
      }
      setProgress((current) => ({ ...current, [id]: next }));
      if (next === "working") timers.add(setTimeout(() => void step(id), POLL_MS));
    };
    for (const id of ids) void step(id);
    return () => { stop.abort(); timers.forEach(clearTimeout); };
  }, [key, request]);

  const states = Object.entries(progress).filter(([id]) => key.split(",").includes(id)).map(([, state]) => state);
  if (states.includes("error")) return <p role="alert" className="mt-2 text-sm font-medium text-red-800">{words.error}</p>;
  if (states.length < new Set(key ? key.split(",") : []).size || states.includes("working")) return <p role="status" className="mt-2 text-sm text-slate-600">{words.working}</p>;
  return states.length ? <p role="status" className="mt-2 text-sm text-slate-600">{words.ready}</p> : null;
}
