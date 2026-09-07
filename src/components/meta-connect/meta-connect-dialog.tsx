"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  AttemptDTO,
  CandidateDTO,
  ConnectIntent,
  ConnectionDTO,
} from "@/lib/meta/connect-contracts";
import {
  createMetaConnectClient,
  MetaConnectClientError,
  type MetaConnectClient,
} from "@/lib/meta-connect-ui/client";

const defaultClient = createMetaConnectClient();

type DialogView = "loading" | "disconnected" | "selection" | "recovery" | "connected";

export type MetaConnectDialogProps = {
  businessId: string;
  intent: ConnectIntent;
  open: boolean;
  onClose: () => void;
  onConnected: (connection: ConnectionDTO) => void;
  onBeforeStart?: () => Promise<ConnectIntent>;
  initialAttempt?: AttemptDTO;
  client?: MetaConnectClient;
};

function isConnected(connection: ConnectionDTO | null): connection is ConnectionDTO {
  return connection?.authorization === "connected" && connection.selected !== null;
}

function formatAccount(accountId: string): string {
  return accountId.length > 4 ? `Account ending ${accountId.slice(-4)}` : accountId;
}

function CandidateChoice({
  candidate,
  selected,
  onChange,
}: {
  candidate: CandidateDTO;
  selected: boolean;
  onChange: () => void;
}) {
  const { assets } = candidate;
  return (
    <label className="flex cursor-pointer gap-3 rounded-md border border-slate-200 p-3 has-checked:border-blue-500 has-checked:bg-blue-50">
      <input
        type="radio"
        name="meta-candidate"
        checked={selected}
        disabled={!candidate.eligible}
        onChange={onChange}
        className="mt-1 h-4 w-4 accent-blue-600"
      />
      <span className="min-w-0 text-sm">
        <span className="block truncate font-medium text-slate-900">{assets.pageName}</span>
        <span className="block truncate text-slate-600">
          {assets.accountName} · {formatAccount(assets.adAccountId)} · {assets.currency}
        </span>
        {!candidate.eligible && candidate.blockers.length > 0 && (
          <span className="mt-1 block text-xs text-amber-800">{candidate.blockers[0].message}</span>
        )}
      </span>
    </label>
  );
}

export function MetaConnectDialog({
  businessId,
  intent,
  open,
  onClose,
  onConnected,
  onBeforeStart,
  initialAttempt,
  client = defaultClient,
}: MetaConnectDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const popupRef = useRef<Window | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const attemptRef = useRef<string | null>(null);
  const [view, setView] = useState<DialogView>("loading");
  const [connection, setConnection] = useState<ConnectionDTO | null>(null);
  const [attempt, setAttempt] = useState<AttemptDTO | null>(null);
  const [selectedPairId, setSelectedPairId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;

  useEffect(() => {
    if (!open) {
      const dialog = dialogRef.current;
      if (dialog?.open) {
        if (typeof dialog.close === "function") dialog.close();
        else dialog.removeAttribute("open");
        triggerRef.current?.focus();
      }
      return;
    }
    triggerRef.current = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setView("loading");
        setError(null);
      }
    });
    if (initialAttempt) {
      attemptRef.current = initialAttempt.attemptId;
      client.attempt(initialAttempt.attemptId, controller.signal).then((next) => {
        if (controller.signal.aborted) return;
        setAttempt(next);
        setConnection(next.connection);
        setView(next.state === "connected" && isConnected(next.connection) ? "connected"
          : next.state === "selection_required" ? "selection" : "recovery");
      }).catch(() => {
        if (!controller.signal.aborted) {
          setError("We could not check this connection. Return to AdBrain and try again.");
          setView("recovery");
        }
      });
      return () => controller.abort();
    }
    client
      .status(businessId, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setConnection(next);
        if (isConnected(next)) {
          setView("connected");
        } else {
          setView("disconnected");
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "We could not check Meta.");
          setView("recovery");
        }
      });
    return () => controller.abort();
  }, [businessId, client, initialAttempt, open]);

  useEffect(() => {
    if (!open) return;
    const handleMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; attemptId?: unknown };
      if (
        event.origin !== window.location.origin ||
        event.source !== popupRef.current ||
        data?.type !== "adbrain.meta.complete" ||
        data.attemptId !== attemptRef.current
      ) {
        return;
      }
      void refreshAttempt(data.attemptId as string);
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  });

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), a[href]",
        ),
      );
      if (focusable.length === 0) return;
      const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
      const nextIndex = event.shiftKey
        ? currentIndex <= 0
          ? focusable.length - 1
          : currentIndex - 1
        : currentIndex === focusable.length - 1
          ? 0
          : currentIndex + 1;
      event.preventDefault();
      focusable[nextIndex]?.focus();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  function close() {
    requestRef.current?.abort();
    popupRef.current = null;
    if (dialogRef.current?.open) {
      if (typeof dialogRef.current.close === "function") dialogRef.current.close();
      else dialogRef.current.removeAttribute("open");
    }
    onClose();
    triggerRef.current?.focus();
  }

  async function refreshAttempt(attemptId: string): Promise<AttemptDTO | null> {
    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    try {
      const next = await client.attempt(attemptId, controller.signal);
      if (attemptRef.current !== attemptId || controller.signal.aborted) return null;
      setAttempt(next);
      if (next.state === "connected" && isConnected(next.connection)) {
        setConnection(next.connection);
        setView("connected");
        onConnectedRef.current(next.connection);
      } else if (next.state === "selection_required") {
        setView("selection");
      } else if (["failed", "expired", "cancelled", "action_required"].includes(next.state)) {
        setView("recovery");
      }
      return next;
    } catch (reason: unknown) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "We could not finish checking Meta.");
        setView("recovery");
      }
      return null;
    }
  }

  async function pollAttempt(attemptId: string): Promise<void> {
    for (let poll = 0; poll < 20; poll += 1) {
      const next = await refreshAttempt(attemptId);
      if (
        !next ||
        attemptRef.current !== attemptId ||
        requestRef.current?.signal.aborted ||
        next.state === "connected" ||
        next.state === "failed" ||
        next.state === "expired" ||
        next.state === "cancelled" ||
        next.state === "selection_required" ||
        next.state === "action_required"
      ) return;
      const waitMs = Math.min(5000, Math.max(500, next?.retryAfterMs ?? 1000));
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, waitMs);
        const cancel = () => {
          window.clearTimeout(timer);
          resolve();
        };
        const signal = requestRef.current?.signal;
        if (!signal || signal.aborted) {
          cancel();
          return;
        }
        signal.addEventListener("abort", cancel, { once: true });
      });
    }
    if (attemptRef.current === attemptId && !requestRef.current?.signal.aborted) {
      setError("Meta has not finished yet. Complete the Meta window, then check again. Your draft is saved.");
      setView("recovery");
    }
  }

  async function startConnection() {
    setError(null);
    setAttempt(null);
    setSelectedPairId(null);
    const popup = window.open("/connect/meta/waiting", "adbrain-meta-connect", "popup,width=520,height=720");
    popupRef.current = popup;
    try {
      const startIntent = (await onBeforeStart?.()) ?? intent;
      const controller = new AbortController();
      requestRef.current?.abort();
      requestRef.current = controller;
      const started = await client.start(businessId, startIntent, controller.signal);
      attemptRef.current = started.attemptId;
      if (popup) {
        popup.location.href = started.authorizationUrl;
      } else {
        window.location.assign(started.authorizationUrl);
        return;
      }
      setView("loading");
      await pollAttempt(started.attemptId);
    } catch (reason: unknown) {
      popup?.close();
      setError(
        reason instanceof MetaConnectClientError
          ? reason.message
          : "We could not start the Meta connection.",
      );
      setView("recovery");
    }
  }

  async function selectCandidate() {
    if (!attempt || !selectedPairId) return;
    setError(null);
    try {
      const selectedCandidate = attempt.candidates.find((candidate) => candidate.pairId === selectedPairId);
      const previousSelection = attempt.connection?.selected;
      const confirmReplacement = Boolean(
        selectedCandidate &&
        previousSelection &&
        (selectedCandidate.assets.adAccountId !== previousSelection.adAccountId ||
          selectedCandidate.assets.pageId !== previousSelection.pageId),
      );
      const controller = new AbortController();
      requestRef.current?.abort();
      requestRef.current = controller;
      const next = await client.select(
        attempt.attemptId,
        selectedPairId,
        attempt.revision,
        confirmReplacement,
        controller.signal,
      );
      setAttempt(next);
      if (isConnected(next.connection)) {
        setConnection(next.connection);
        setView("connected");
        onConnectedRef.current(next.connection);
      }
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "We could not save that selection.");
      setView("recovery");
    }
  }

  async function retryAttempt() {
    if (!attemptRef.current || !attempt) {
      setError("This connection attempt cannot be retried yet.");
      return;
    }
    setError(null);
    setView("loading");
    if (["authorizing", "discovering"].includes(attempt.state)) {
      await pollAttempt(attempt.attemptId);
      return;
    }
    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    try {
      const next = await client.retry(attemptRef.current, attempt.revision, controller.signal);
      if (controller.signal.aborted || attemptRef.current !== next.attemptId) return;
      setAttempt(next);
      await pollAttempt(next.attemptId);
    } catch (reason: unknown) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "We could not retry this connection.");
        setView("recovery");
      }
    }
  }

  const selected = connection?.selected;
  const needsReconnect = !attempt || ["expired", "cancelled"].includes(attempt.state)
    || attempt.blockers.some(blocker => blocker.code === "REAUTH_REQUIRED" || blocker.action?.kind === "reconnect");
  const selectedCandidate = attempt?.candidates.find((candidate) => candidate.pairId === selectedPairId);
  const requiresReplacementConfirmation = Boolean(
    selectedCandidate &&
    attempt?.connection?.selected &&
    (selectedCandidate.assets.adAccountId !== attempt.connection.selected.adAccountId ||
      selectedCandidate.assets.pageId !== attempt.connection.selected.pageId),
  );
  const title = view === "connected" ? "Connected to Meta" : "Connect your business to Meta";
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="meta-connect-title"
      aria-describedby="meta-connect-status"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(100%-2rem,32rem)] overflow-y-scroll rounded-lg border border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-950/40"
      style={{ scrollbarGutter: "stable" }}
    >
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
        <div>
          <h2 id="meta-connect-title" className="text-lg font-semibold">{title}</h2>
          <p id="meta-connect-status" aria-live="polite" className="mt-1 text-sm text-slate-600">
            {view === "loading" && "Checking the saved connection."}
            {view === "disconnected" && "Connect an existing Meta business to continue."}
            {view === "selection" && "Choose the verified account and Page for this workspace."}
            {view === "recovery" && "Your draft is preserved while this connection is recovered."}
            {view === "connected" && "Connection readiness is separate from campaign spending readiness."}
          </p>
        </div>
        <button type="button" onClick={close} aria-label="Close connection dialog" className="rounded-md p-1 text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-600">
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <div className="space-y-5 px-6 py-5">
        {view === "loading" && <Loader2 className="h-5 w-5 animate-spin text-blue-600" aria-label="Checking connection" />}
        {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {view === "disconnected" && <Button onClick={() => void startConnection()}>Connect Business</Button>}
        {view === "selection" && attempt && (
          <div className="space-y-3">
            {attempt.candidates.map((candidate) => (
              <CandidateChoice
                key={candidate.pairId}
                candidate={candidate}
                selected={candidate.pairId === selectedPairId}
                onChange={() => setSelectedPairId(candidate.pairId)}
              />
            ))}
            {requiresReplacementConfirmation && (
              <p className="text-sm text-amber-800">This changes the saved account and Page for this workspace.</p>
            )}
            <Button disabled={!selectedPairId} onClick={() => void selectCandidate()}>
              {requiresReplacementConfirmation ? "Confirm replacement" : "Use selected business"}
            </Button>
          </div>
        )}
        {view === "connected" && selected && (
          <div className="space-y-4">
            <div className="flex gap-3 rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-medium">{selected.pageName}</p>
                <p>{selected.accountName} · {formatAccount(selected.adAccountId)} · {selected.currency}</p>
                <p>{selected.timezoneName}</p>
              </div>
            </div>
            {connection?.capabilities.canActivate.state === "blocked" && (
              <p className="text-sm text-amber-800">{connection.capabilities.canActivate.blockers[0]?.message}</p>
            )}
            {connection?.capabilities.canActivate.state === "unknown" && (
              <p className="text-sm text-slate-600">Meta readiness still needs a fresh check before anything can run.</p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  if (intent.kind === "review_activation") {
                    onConnectedRef.current(connection);
                  }
                  close();
                }}
              >
                {intent.kind === "review_activation" ? "Review activation" : "Continue to review"}
              </Button>
              <Button variant="ghost" onClick={() => void startConnection()}><RefreshCw className="h-4 w-4" aria-hidden="true" />Change</Button>
            </div>
          </div>
        )}
        {view === "recovery" && (
          <div className="space-y-4">
            {Boolean(attempt?.blockers.length) && (
              <ul aria-label="Connection issues" className="space-y-3 text-sm text-slate-700">
                {attempt?.blockers.map((blocker, index) => (
                  <li key={`${blocker.code}:${index}`} className="space-y-2">
                    <p>{blocker.message}</p>
                    {blocker.action?.kind === "open_meta" && (
                      <a className="inline-flex items-center gap-2 text-blue-700 underline underline-offset-4" href={blocker.action.url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />{blocker.action.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-2">
              {!needsReconnect && <Button onClick={() => void retryAttempt()}>Check again</Button>}
              <Button variant={needsReconnect ? "primary" : "outline"} onClick={() => void startConnection()}>Reconnect Meta</Button>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}