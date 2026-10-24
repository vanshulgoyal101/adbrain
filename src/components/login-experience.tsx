"use client";

import { Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Loader2, X } from "lucide-react";
import { AdbrainCycle } from "@/components/adbrain-cycle";
import { LoginForm } from "@/components/login-form";
import { markLoginIntroSeen, useLoginIntroSeen, useReturningVisitor } from "@/lib/login-visitor";
import styles from "./login-experience.module.css";

function PhoneIntro({ onClose }: { onClose: () => void }) {
  const skipRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    skipRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="intro-title" className={styles.intro}>
      <div className={styles.introTop}>
        <p id="intro-title" className={styles.introTitle}>From your business to WhatsApp chats</p>
        <button ref={skipRef} type="button" onClick={onClose} className={styles.skip}>Skip <X size={16} aria-hidden="true" /></button>
      </div>
      <AdbrainCycle fill className={styles.introCycle} />
      <button type="button" onClick={onClose} className={styles.introCta}>Create my free account</button>
    </div>
  );
}

const PHONE_QUERY = "(max-width: 760px)";
function subscribePhone(listener: () => void) {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

export function LoginExperience() {
  const returning = useReturningVisitor();
  const introSeen = useLoginIntroSeen();
  const [choice, setChoice] = useState<"new" | "returning" | null>(null);
  const [introClosed, setIntroClosed] = useState(false);
  const phone = useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE_QUERY).matches, () => false);
  const mode = choice ?? (returning ? "returning" : "new");
  const isNew = mode === "new";

  const closeIntro = () => {
    markLoginIntroSeen();
    setIntroClosed(true);
    document.getElementById("email")?.focus();
  };

  return (
    <>
      {phone && isNew && !introSeen && !introClosed && <PhoneIntro onClose={closeIntro} />}
      <div className={styles.heading}>
        <h1 id="sign-in-title">{isNew ? "Create your free account" : "Welcome back"}</h1>
        <p>{isNew ? "Make your first ad in about 2 minutes. Nothing runs until you approve it." : "Sign in to see your ads and the customers who messaged you."}</p>
      </div>
      <Suspense fallback={<div role="status" className="flex min-h-80 items-center justify-center gap-2 text-sm text-slate-500"><Loader2 size={18} aria-hidden="true" className="animate-spin" /> Loading sign in...</div>}>
        <LoginForm newVisitor={isNew} />
      </Suspense>
      <p className={styles.switch}>
        {isNew ? "Already have an account?" : "New to AdBrain?"}{" "}
        <button type="button" onClick={() => setChoice(isNew ? "returning" : "new")}>{isNew ? "Sign in" : "Create a free account"}</button>
      </p>
    </>
  );
}
