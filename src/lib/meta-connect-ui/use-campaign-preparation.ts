"use client";

import { useEffect, useRef, useState } from "react";

type PreparationState = { scope: string; label: string } | null;
type PendingPreparation = { controller: AbortController; timer: ReturnType<typeof setTimeout> };

export function useCampaignPreparation(scope: string, onStop: (timedOut: boolean) => void) {
  const pendingRef = useRef<PendingPreparation | null>(null);
  const [state, setState] = useState<PreparationState>(null);

  useEffect(() => () => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) {
      clearTimeout(pending.timer);
      pending.controller.abort();
    }
  }, [scope]);

  function stop(timedOut = false) {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    clearTimeout(pending.timer);
    pending.controller.abort();
    setState(null);
    onStop(timedOut);
  }

  function begin(): AbortSignal {
    if (pendingRef.current) throw new Error("Campaign preparation is already running.");
    const controller = new AbortController();
    pendingRef.current = { controller, timer: setTimeout(() => stop(true), 60_000) };
    setState({ scope, label: "" });
    return controller.signal;
  }

  function finish(signal: AbortSignal) {
    const pending = pendingRef.current;
    if (pending?.controller.signal !== signal) return;
    clearTimeout(pending.timer);
    pendingRef.current = null;
    setState(null);
  }

  function setStage(signal: AbortSignal, label: string) {
    if (pendingRef.current?.controller.signal === signal) setState({ scope, label });
  }

  return {
    preparing: state !== null && state.scope === scope,
    preparationStage: state?.scope === scope ? state.label : "",
    beginPreparation: begin,
    finishPreparation: finish,
    stopPreparation: stop,
    setPreparationStage: setStage,
    isPreparing: () => pendingRef.current !== null,
  };
}