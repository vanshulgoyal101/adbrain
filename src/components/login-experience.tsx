"use client";

import { Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { AdbrainCycle } from "@/components/adbrain-cycle";
import { LoginForm, useHashCallbackError } from "@/components/login-form";
import { useHasPendingIdea } from "@/lib/ideas/pending";
import { markLoginIntroSeen, useLoginIntroSeen, useReturningVisitor } from "@/lib/login-visitor";
import styles from "./login-experience.module.css";

function PhoneIntro({ onClose }: { onClose: () => void }) {
  const skipRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Keep keyboard and screen-reader focus inside the full-screen intro.
    const hidden = [...document.body.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el !== dialogRef.current && !el.inert);
    hidden.forEach((el) => { el.inert = true; });
    return () => hidden.forEach((el) => { el.inert = false; });
  }, []);
  useEffect(() => {
    // #847: focus lands on Skip for keyboard and screen-reader users, without a ring that reads as an error on touch.
    skipRef.current?.focus({ focusVisible: false } as FocusOptions);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="intro-title" className={styles.intro}>
      <div className={styles.introTop}>
        <p id="intro-title" className={styles.introTitle}>From your business to WhatsApp chats</p>
        <button ref={skipRef} type="button" onClick={onClose} className={styles.skip}>Skip <X size={16} aria-hidden="true" /></button>
      </div>
      <AdbrainCycle fill className={styles.introCycle} />
      <button type="button" onClick={onClose} className={styles.introCta}>Create my free account</button>
    </div>,
    document.body,
  );
}

const PHONE_QUERY = "(max-width: 760px)";
function subscribePhone(listener: () => void) {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

/** `deepLink`: sent here from an app page (e.g. ?redirect=/campaigns), so it is a returning user. */
export function LoginExperience({ deepLink = false, signIn = false, failedSignIn = false }: {
  deepLink?: boolean;
  /** #1793: arrived from a "Sign in" link (`?mode=signin`); the visitor said they have an account. */
  signIn?: boolean;
  /** #1428: back from a failed sign-in; the phone intro would cover what went wrong. */
  failedSignIn?: boolean;
}) {
  const hashError = useHashCallbackError();
  // #1417: while the failed-sign-in panel shows, the sign-up heading and switch stay hidden.
  const [panelGone, setPanelGone] = useState(false);
  const panelShown = (failedSignIn || hashError !== null) && !panelGone;
  const returning = useReturningVisitor();
  const introSeen = useLoginIntroSeen();
  const [choice, setChoice] = useState<"new" | "returning" | null>(null);
  const [introClosed, setIntroClosed] = useState(false);
  const phone = useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE_QUERY).matches, () => false);
  // A visitor who picked an idea in the gallery is most likely new, even though /create sent them here.
  const pendingIdea = useHasPendingIdea();
  const mode = choice ?? (returning || signIn || (deepLink && !pendingIdea) ? "returning" : "new");
  const isNew = mode === "new";

  const closeIntro = () => {
    markLoginIntroSeen();
    setIntroClosed(true);
    document.getElementById("email")?.focus();
  };

  return (
    <>
      {phone && isNew && !introSeen && !introClosed && !failedSignIn && !hashError && <PhoneIntro onClose={closeIntro} />}
      {panelShown ? <h1 id="sign-in-title" className="sr-only">Sign in</h1> : (
        <div className={styles.heading}>
          <h1 id="sign-in-title">{isNew ? "Create your free account" : "Welcome back"}</h1>
          <p>{isNew ? "Make your first ad in about 2 minutes. Nothing runs until you approve it." : "Sign in to see your ads and the customers who messaged you."}</p>
        </div>
      )}
      <Suspense fallback={<div role="status" className="flex min-h-80 items-center justify-center gap-2 text-sm text-slate-500"><Loader2 size={18} aria-hidden="true" className="animate-spin" /> Loading sign in...</div>}>
        <LoginForm newVisitor={isNew} onSucceeded={() => setChoice(mode)} onCallbackDismiss={() => setPanelGone(true)} />
      </Suspense>
      {!panelShown && <p className={styles.switch}>
        {isNew ? "Already have an account?" : "New to AdBrain?"}{" "}
        <button type="button" onClick={() => setChoice(isNew ? "returning" : "new")}>{isNew ? "Sign in" : "Create a free account"}</button>
      </p>}
    </>
  );
}
