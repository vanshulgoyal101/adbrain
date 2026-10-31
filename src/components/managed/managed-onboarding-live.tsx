"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ManagedOnboarding } from "@/components/managed/managed-onboarding";
import { ManagedPageStep } from "@/components/managed-page-step";
import { createMetaConnectClient } from "@/lib/meta-connect-ui/client";
import { continueInTab } from "@/lib/meta-connect-ui/navigate";
import { usePoll } from "@/lib/use-poll";
import { onboardingProgress, type ManagedAccountProgressRow } from "@/lib/managed/onboarding";
import type { FundingReason, PayerStatus } from "@/services/managed-billing";
import { clearOnboardingConnect, markOnboardingConnect } from "@/lib/managed/onboarding-connect";
import { POPUP_FALLBACK_MS } from "@/components/meta-connect/meta-connect-dialog";

const POLL_MS = 5_000;
// Meta's Page settings → Linked accounts → WhatsApp (Meta sends the code to the number). Checked on QA's walk.
const PAGE_WHATSAPP_SETTINGS = "https://www.facebook.com/settings/?tab=linked_whatsapp";
const WHATSAPP_MESSAGES: Record<"not_linked" | "waiting_setup" | "taken" | "unavailable", string> = {
  not_linked: "We don't see a WhatsApp number on your Page yet. Link it on Facebook, then check again.",
  waiting_setup: "We'll be able to check as soon as your ad account is ready, usually within a minute.",
  taken: "That WhatsApp number is already used by another AdBrain business. Link a different number to your Page.",
  unavailable: "Your setup has stopped, so WhatsApp can't be linked right now. Contact AdBrain support.",
};

/** #524 v1: the owner links WhatsApp to their own Page on Facebook; AdBrain checks and records it. */
function WhatsAppStep({ businessId, onLinked }: { businessId: string; onLinked: () => void }) {
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  async function check() {
    setChecking(true);
    setMessage(null);
    try {
      const response = await fetch("/api/managed/whatsapp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessId }) });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.error?.message ?? "We couldn't check your Page's WhatsApp just now. Try again.");
      const result = body.data as { status: "linked"; masked: string } | { status: "not_linked" | "waiting_setup" | "taken" | "unavailable" };
      if (result.status === "linked") {
        setMessage({ text: `Linked: ${result.masked}`, error: false });
        onLinked();
      } else setMessage({ text: WHATSAPP_MESSAGES[result.status], error: result.status === "taken" || result.status === "unavailable" });
    } catch (reason) {
      setMessage({ text: reason instanceof Error ? reason.message : "Try again.", error: true });
    } finally {
      setChecking(false);
    }
  }
  return (
    <div className="space-y-3 text-sm text-slate-700">
      <ol className="list-decimal space-y-1 pl-5">
        <li><a href={PAGE_WHATSAPP_SETTINGS} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-700 underline underline-offset-4">Open your Page&apos;s WhatsApp settings on Facebook</a></li>
        <li>Enter your WhatsApp Business number and the code WhatsApp sends you.</li>
      </ol>
      <Button variant="outline" onClick={() => void check()} disabled={checking}>{checking ? "Checking…" : "Check again"}</Button>
      {message && <p role={message.error ? "alert" : "status"} className={message.error ? "text-red-700" : "text-slate-700"}>{message.text}</p>}
    </div>
  );
}
type BillingResult =
  | { status: "funded" | "invited" | "invalid_email" | "waiting_setup" | "unavailable" }
  | { status: "not_funded"; reason: FundingReason; payer: PayerStatus };
const SETUP_MESSAGES = {
  invalid_email: "Enter a valid email address.",
  waiting_setup: "We'll be able to check as soon as your ad account is ready, usually within a minute.",
  unavailable: "Your setup has stopped, so the card can't be checked right now. Contact AdBrain support.",
};
const NO_CARD: Record<PayerStatus, string> = {
  none: "We don't see a card on your ad account yet. Invite the person who'll add it.",
  invited: "Waiting for your person to accept Facebook's invite. Ask them to check their email.",
  joined: "We don't see a card on your ad account yet. Ask your person to add it, then check again.",
};
const FUNDING_MESSAGES: Record<Exclude<FundingReason, "NO_PAYMENT_METHOD">, string> = {
  PREPAID_UNCONFIRMED: "Your ad account has a prepaid balance, not a card. Add a card on Facebook, then check again.",
  PAYMENT_DUE: "Facebook says a payment is due on your ad account. Pay it on Facebook, then check again.",
  PENDING_REVIEW: "Facebook is reviewing your ad account's payment. This can take a day; check again later.",
  IN_GRACE_PERIOD: "Facebook couldn't charge your card. Update it on Facebook, then check again.",
  ACCOUNT_DISABLED: "Facebook has disabled this ad account. Contact AdBrain support.",
  ACCOUNT_CLOSED: "This ad account is closed. Contact AdBrain support.",
  ACCOUNT_NOT_ACTIVE: "Facebook says your ad account isn't active yet. Check again in a few minutes.",
};

/** #2359: the owner's person adds their own card to the child ad account in Meta; AdBrain invites them and reads the card from Meta. */
function CardStep({ businessId, onFunded }: { businessId: string; onFunded: () => void }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<"invite" | "check" | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  async function send(action: "invite" | "check") {
    setBusy(action);
    setMessage(null);
    try {
      const response = await fetch("/api/managed/billing", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "invite" ? { action, businessId, email } : { action, businessId }) });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.error?.message ?? "We couldn't reach Facebook just now. Try again.");
      const result = body.data as BillingResult;
      if (result.status === "funded") {
        setMessage({ text: "Card added. Your ad account can run ads.", error: false });
        onFunded();
      } else if (result.status === "invited") {
        setMessage({ text: "Invite sent. They'll get an email from Facebook; once they accept, they add the card.", error: false });
      } else if (result.status === "not_funded") {
        setMessage(result.reason === "NO_PAYMENT_METHOD"
          ? { text: NO_CARD[result.payer], error: false }
          : { text: FUNDING_MESSAGES[result.reason], error: result.reason === "ACCOUNT_DISABLED" || result.reason === "ACCOUNT_CLOSED" });
      } else setMessage({ text: SETUP_MESSAGES[result.status], error: result.status !== "waiting_setup" });
    } catch (reason) {
      setMessage({ text: reason instanceof Error ? reason.message : "Try again.", error: true });
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="space-y-3 text-sm text-slate-700">
      <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void send("invite"); }}>
        <label htmlFor="card-person-email" className="block font-medium text-slate-900">Email of the person who&apos;ll add the card</label>
        <p className="text-slate-600">It can be you. They need a Facebook account with this email.</p>
        <div className="flex flex-wrap gap-2">
          <input id="card-person-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)}
            className="min-h-11 min-w-0 flex-1 rounded-md border border-slate-300 px-3" />
          <Button type="submit" disabled={busy !== null || !email.trim()}>{busy === "invite" ? "Sending…" : "Send invite"}</Button>
        </div>
      </form>
      <ol className="list-decimal space-y-1 pl-5">
        <li>They accept the invite in the email from Facebook.</li>
        <li>On Facebook, they open Business Settings → Billing &amp; payments for your ad account and add the card.</li>
      </ol>
      <Button variant="outline" onClick={() => void send("check")} disabled={busy !== null}>{busy === "check" ? "Checking…" : "Check again"}</Button>
      {message && <p role={message.error ? "alert" : "status"} className={message.error ? "text-red-700" : "text-slate-700"}>{message.text}</p>}
    </div>
  );
}

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

  /** Returns the Response it read so the poll can back off (429) or stop (401, #1541). */
  const load = useCallback(async (signal?: AbortSignal): Promise<Response | null> => {
    let response: Response | null = null;
    try {
      response = await fetch(`/api/managed/onboarding?businessId=${encodeURIComponent(businessId)}`, { cache: "no-store", signal });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.error?.message ?? "Your progress couldn't be loaded.");
      if (signal?.aborted) return response;
      setSnapshot(body.data as Snapshot);
      setLoadError(null);
    } catch (reason) {
      if (!signal?.aborted) setLoadError(reason instanceof Error ? reason.message : "Your progress couldn't be loaded.");
    }
    return response;
  }, [businessId]);
  const refresh = useCallback(() => load(), [load]);

  const ready = snapshot?.row?.state === "ready";
  usePoll(load, { intervalMs: POLL_MS, enabled: !ready, key: businessId });

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
    whatsapp: <WhatsAppStep businessId={businessId} onLinked={() => void refresh()} />,
    card: <CardStep businessId={businessId} onFunded={() => void refresh()} />,
  };
  return (
    <>
      {loadError && <p role="alert" className="mb-4 text-sm text-red-700">{loadError} Retrying…</p>}
      <ManagedOnboarding progress={onboardingProgress(snapshot.row, { paid: snapshot.paid })} steps={steps} />
    </>
  );
}
