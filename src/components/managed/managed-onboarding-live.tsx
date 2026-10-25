"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ManagedOnboarding } from "@/components/managed/managed-onboarding";
import { ManagedPageStep } from "@/components/managed-page-step";
import { createMetaConnectClient } from "@/lib/meta-connect-ui/client";
import { continueInTab } from "@/lib/meta-connect-ui/navigate";
import { onboardingProgress, type ManagedAccountProgressRow } from "@/lib/managed/onboarding";
import { ONBOARDING_CONNECT_KEY } from "@/lib/managed/onboarding-connect";

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
      setAttemptId(data.attemptId);
      setConnecting(false);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function signInWithFacebook() {
    setConnecting(true);
    setConnectError(null);
    window.sessionStorage.setItem(ONBOARDING_CONNECT_KEY, "1");
    const popup = window.open("/connect/meta/waiting", "adbrain-meta-connect", "popup,width=520,height=720");
    popupRef.current = popup;
    try {
      const started = await createMetaConnectClient().start(businessId, { kind: "setup" });
      if (popup) popup.location.href = started.authorizationUrl;
      else continueInTab(started.authorizationUrl);
    } catch (reason) {
      popup?.close();
      window.sessionStorage.removeItem(ONBOARDING_CONNECT_KEY);
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
