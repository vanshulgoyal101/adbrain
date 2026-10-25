"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ManagedOnboarding } from "@/components/managed/managed-onboarding";
import { ManagedPageStep } from "@/components/managed-page-step";
import { createMetaConnectClient } from "@/lib/meta-connect-ui/client";
import { continueInTab } from "@/lib/meta-connect-ui/navigate";
import { onboardingProgress, type ManagedAccountProgressRow } from "@/lib/managed/onboarding";
import { clearOnboardingConnect, markOnboardingConnect } from "@/lib/managed/onboarding-connect";
import { POPUP_FALLBACK_MS } from "@/components/meta-connect/meta-connect-dialog";

const POLL_MS = 5_000;
type Snapshot = { row: ManagedAccountProgressRow | null; paid: boolean };

/** #526: the onboarding screen with live progress from the ledger, and the three owner steps wired in. */
export function ManagedOnboardingLive({ businessId, initialAttemptId }: { businessId: string; initialAttemptId: string | null }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attemptId, setAttemptId] = useState(initialAttemptId);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);
  const [inTabUrl, setInTabUrl] = useState<string | null>(null);
  const fallbackTimerRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/managed/onboarding?businessId=${encodeURIComponent(businessId)}`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.error?.message ?? "Your progress couldn't be loaded.");
      setSnapshot(body.data as Snapshot);
      setLoadError(null);
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : "Your progress couldn't be loaded.");
    }
  }, [businessId]);

  const ready = snapshot?.row?.state === "ready";
  useEffect(() => {
    const first = window.setTimeout(() => void refresh(), 0);
    const timer = ready ? null : window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      window.clearTimeout(first);
      if (timer !== null) window.clearInterval(timer);
    };
  }, [refresh, ready]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; attemptId?: unknown };
      if (event.origin !== window.location.origin || event.source !== popupRef.current || data?.type !== "adbrain.meta.complete" || typeof data.attemptId !== "string") return;
      clearOnboardingConnect(window.sessionStorage);
      if (fallbackTimerRef.current !== null) window.clearTimeout(fallbackTimerRef.current);
      setInTabUrl(null);
      setAttemptId(data.attemptId);
      setConnecting(false);
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      // Leaving onboarding: a later ordinary Connect in this tab must not come back here.
      clearOnboardingConnect(window.sessionStorage);
      if (fallbackTimerRef.current !== null) window.clearTimeout(fallbackTimerRef.current);
    };
  }, []);

  async function signInWithFacebook() {
    setConnecting(true);
    setConnectError(null);
    markOnboardingConnect(window.sessionStorage);
    const popup = window.open("/connect/meta/waiting", "adbrain-meta-connect", "popup,width=520,height=720");
    popupRef.current = popup;
    try {
      const started = await createMetaConnectClient().start(businessId, { kind: "setup" });
      if (popup) {
        popup.location.href = started.authorizationUrl;
        // #474: some browsers hand back a popup that never shows; offer the same tab after a moment.
        fallbackTimerRef.current = window.setTimeout(() => setInTabUrl(started.authorizationUrl), POPUP_FALLBACK_MS);
      } else continueInTab(started.authorizationUrl);
    } catch (reason) {
      popup?.close();
      clearOnboardingConnect(window.sessionStorage);
      setConnecting(false);
      setConnectError(reason instanceof Error ? reason.message : "Facebook sign-in couldn't start. Try again.");
    }
  }

  if (!snapshot) {
    return <p role={loadError ? "alert" : "status"} className="py-10 text-slate-600">{loadError ?? "Loading your setup…"}</p>;
  }
  const steps = {
    pay: (
      <Link href="/settings" className="inline-flex min-h-11 items-center rounded-md bg-blue-600 px-4 font-semibold text-white hover:bg-blue-700">Add money</Link>
    ),
    page: attemptId ? (
      <ManagedPageStep attemptId={attemptId} onLinked={() => void refresh()} />
    ) : (
      <div className="space-y-2">
        <p className="text-sm text-slate-600">Sign in with the Facebook account that manages your business Page.</p>
        <Button onClick={() => void signInWithFacebook()} disabled={connecting}>{connecting ? "Waiting for Facebook…" : "Sign in with Facebook"}</Button>
        {connectError && <p role="alert" className="text-sm text-red-700">{connectError}</p>}
        {inTabUrl && connecting && (
          <p className="text-sm text-slate-700">
            Popup didn&apos;t open?{" "}
            <button type="button" className="font-medium text-blue-700 underline underline-offset-4"
              onClick={() => { popupRef.current?.close(); continueInTab(inTabUrl); }}>Continue in this tab</button>
          </p>
        )}
      </div>
    ),
    whatsapp: <p className="text-sm text-slate-600">This step opens here soon. Your ads can&apos;t start until it&apos;s done.</p>,
  };
  return (
    <>
      {loadError && <p role="alert" className="mb-4 text-sm text-red-700">{loadError} Retrying…</p>}
      <ManagedOnboarding progress={onboardingProgress(snapshot.row, { paid: snapshot.paid })} steps={steps} />
    </>
  );
}
