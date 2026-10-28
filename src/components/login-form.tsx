"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeft, ArrowRight, Eye, EyeOff, Loader2, Mail, MailCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { openAfterSignIn, safeAuthRedirect } from "@/lib/auth-redirect";
import { rememberReturningVisitor } from "@/lib/login-visitor";
import { reportAuthOutcome } from "@/lib/observability/auth-beacon";
import { authCode } from "@/lib/observability/auth-events";
import { CALLBACK_ERRORS, hashCallbackError, parseCallbackError } from "@/lib/auth-callback-error";

const primaryClass = "bg-primary font-semibold text-primary-foreground shadow-xs hover:bg-primary-hover";

/** `newVisitor` leads with a sign-in link, which also creates the account; passwords stay one tap away. */
const noHash = () => () => {};
/** #1414: the fragment's sign-in error (old-style links); none on the server. */
export function useHashCallbackError() {
  return useSyncExternalStore(noHash, () => hashCallbackError(window.location.hash), () => null);
}

export function LoginForm({ newVisitor = false, onSucceeded }: { newVisitor?: boolean; onSucceeded?: () => void }) {
  const searchParams = useSearchParams();
  const redirect = safeAuthRedirect(searchParams.get("redirect"));
  // #1414: why the last sign-in failed, with its one action (a new link, or Google again in this browser).
  const hashError = useHashCallbackError();
  const callbackError = parseCallbackError(searchParams.get("error")) ?? hashError;
  const [callbackDismissed, setCallbackDismissed] = useState(false);
  const callbackShown = !callbackDismissed;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [usePassword, setUsePassword] = useState(false);
  const passwordMode = !newVisitor || usePassword;
  const emailRef = useRef<HTMLInputElement>(null);
  const restoreEmailFocus = useRef(false);
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [pending, setPending] = useState<"magic" | "password" | "google" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "idle" && restoreEmailFocus.current) {
      emailRef.current?.focus();
      restoreEmailFocus.current = false;
    }
  }, [status]);

  function remember() {
    onSucceeded?.();
    rememberReturningVisitor();
  }

  function callbackUrl() {
    return `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(redirect)}`;
  }

  async function sendMagicLink() {
    if (pending) return;
    if (!emailRef.current?.reportValidity()) return;
    setError(null);
    setStatus("sending");
    setPending("magic");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: callbackUrl() },
      });
      if (error) {
        reportAuthOutcome({ method: "email_link", outcome: "failed", code: authCode(error) });
        throw new Error(error.message);
      }
      reportAuthOutcome({ method: "email_link", outcome: "started" });
      remember();
      setStatus("sent");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not send a sign-in link. Please try again.");
      setStatus("idle");
    } finally {
      setPending(null);
    }
  }

  async function signInWithGoogle() {
    if (pending) return;
    setError(null);
    setPending("google");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: callbackUrl() },
      });
      if (error) {
        reportAuthOutcome({ method: "google", outcome: "failed", code: authCode(error) });
        throw new Error(error.message);
      }
      remember();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not sign in with Google. Please try again.");
    } finally {
      setPending(null);
    }
  }

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setPending("password");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        reportAuthOutcome({ method: "password", outcome: "failed", code: authCode(error) });
        throw new Error(error.message);
      }
      reportAuthOutcome({ method: "password", outcome: "success" });
      remember();
      openAfterSignIn(redirect);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not sign in. Please try again.");
      setPending(null);
    }
  }

  if (status === "sent") {
    return (
      <div className="flex flex-col gap-6">
        <div role="status" className="border-l-2 border-primary pl-4">
          <MailCheck size={24} aria-hidden="true" className="mb-3 text-primary" />
          <h2 className="text-lg font-semibold text-slate-900">Check your email</h2>
          <p className="mt-2 break-words text-sm leading-6 text-slate-600">
            We sent a sign-in link to <span className="font-medium text-slate-900">{email}</span>. Open it on this device to {newVisitor ? "finish creating your account" : "sign in"}.
          </p>
        </div>
        <Button type="button" variant="outline" className="h-11" onClick={() => {
          restoreEmailFocus.current = true;
          setPassword("");
          setShowPassword(false);
          setError(null);
          setStatus("idle");
        }}>
          <ArrowLeft size={16} aria-hidden="true" /> Back to sign in
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5" aria-busy={pending !== null}>
      {process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === "true" && (
        <div className="flex flex-col gap-2">
          <a
            href="/auth/dev-login"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800"
          >
            Continue in dev mode
          </a>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <div className="h-px flex-1 bg-slate-200" />
            or sign in
            <div className="h-px flex-1 bg-slate-200" />
          </div>
        </div>
      )}

      <Button type="button" variant="outline" className="h-11" disabled={pending !== null} onClick={signInWithGoogle}>
        {pending === "google" && <Loader2 size={16} aria-hidden="true" className="animate-spin" />}
        {pending === "google" ? "Connecting..." : "Continue with Google"}
      </Button>

      <div className="flex items-center gap-3 text-xs text-slate-500">
        <div className="h-px flex-1 bg-border" />
        or with email
        <div className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={passwordMode ? signInWithPassword : (e) => { e.preventDefault(); void sendMagicLink(); }} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            ref={emailRef}
            id="email"
            type="email"
            name="email"
            required
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            disabled={pending !== null}
            className="h-11"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        {passwordMode && <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              required
              autoComplete="current-password"
              autoFocus={usePassword}
              disabled={pending !== null}
              className="h-11 pr-12"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} title={showPassword ? "Hide password" : "Show password"} disabled={pending !== null} onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-slate-500 hover:text-slate-900 disabled:opacity-50">
              {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
            </button>
          </div>
        </div>}
        {error && <p role="alert" className="break-words border-l-2 border-red-500 pl-3 text-sm leading-6 text-red-700">{error}</p>}
        {!error && callbackShown && callbackError && (
          <div role="alert" className="flex flex-col items-start gap-1 border-l-2 border-red-500 pl-3 text-sm leading-6 text-red-700">
            <p className="break-words">{CALLBACK_ERRORS[callbackError].text}</p>
            {CALLBACK_ERRORS[callbackError].action === "new_link" && (
              <button type="button" className="min-h-11 font-medium text-slate-900 underline underline-offset-4" disabled={pending !== null}
                onClick={() => { setCallbackDismissed(true); if (email) void sendMagicLink(); else emailRef.current?.focus(); }}>
                {email ? "Send a new link" : "Enter your email for a new link"}
              </button>
            )}
          </div>
        )}
        {passwordMode ? <>
        <Button type="submit" className={`h-11 ${primaryClass}`} disabled={pending !== null || !email || !password}>
          {pending === "password" && <Loader2 size={16} aria-hidden="true" className="animate-spin" />}
          {pending === "password" ? "Signing in..." : "Sign in with password"}
          {pending !== "password" && <ArrowRight size={16} aria-hidden="true" />}
        </Button>
        <Button type="button" variant="ghost" className="h-11" disabled={pending !== null} onClick={sendMagicLink}>
          {pending === "magic" ? <Loader2 size={16} aria-hidden="true" className="animate-spin" /> : <Mail size={16} aria-hidden="true" />}
          {status === "sending" ? "Sending…" : "Send magic link"}
        </Button>
        </> : <>
        <Button type="submit" className={`h-11 ${primaryClass}`} disabled={pending !== null}>
          {pending === "magic" ? <Loader2 size={16} aria-hidden="true" className="animate-spin" /> : <Mail size={16} aria-hidden="true" />}
          {status === "sending" ? "Sending…" : "Email me a sign-in link"}
        </Button>
        <p className="-mt-2 text-sm leading-6 text-slate-600">No password needed. The link creates your account.</p>
        <Button type="button" variant="ghost" className="h-11" disabled={pending !== null} onClick={() => setUsePassword(true)}>
          I have a password
        </Button>
        </>}
      </form>
    </div>
  );
}
