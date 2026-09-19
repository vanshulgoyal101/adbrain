"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Eye, EyeOff, Loader2, Mail, MailCheck } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { safeAuthRedirect } from "@/lib/auth-redirect";

export function LoginForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const redirect = safeAuthRedirect(searchParams.get("redirect"));
  const authError = searchParams.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const restoreEmailFocus = useRef(false);
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [pending, setPending] = useState<"magic" | "password" | "google" | null>(null);
  const [error, setError] = useState<string | null>(
    authError ? "Sign-in failed. Please try again." : null,
  );

  useEffect(() => {
    if (status === "idle" && restoreEmailFocus.current) {
      emailRef.current?.focus();
      restoreEmailFocus.current = false;
    }
  }, [status]);

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
      if (error) throw new Error(error.message);
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
      if (error) throw new Error(error.message);
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
      if (error) throw new Error(error.message);
      router.replace(redirect);
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not sign in. Please try again.");
    } finally {
      setPending(null);
    }
  }

  if (status === "sent") {
    return (
      <div className="flex flex-col gap-6">
        <div role="status" className="border-l-2 border-blue-600 pl-4">
          <MailCheck size={24} aria-hidden="true" className="mb-3 text-blue-600" />
          <h2 className="text-lg font-semibold text-slate-900">Check your email</h2>
          <p className="mt-2 break-words text-sm leading-6 text-slate-600">
            We sent a sign-in link to <span className="font-medium text-slate-900">{email}</span>.
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

      <form onSubmit={signInWithPassword} className="flex flex-col gap-5">
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
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              required
              autoComplete="current-password"
              disabled={pending !== null}
              className="h-11 pr-12"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} title={showPassword ? "Hide password" : "Show password"} disabled={pending !== null} onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-slate-500 hover:text-slate-900 disabled:opacity-50">
              {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
            </button>
          </div>
        </div>
        {error && <p role="alert" className="break-words border-l-2 border-red-500 pl-3 text-sm leading-6 text-red-700">{error}</p>}
        <Button type="submit" className="h-11" disabled={pending !== null || !email || !password}>
          {pending === "password" && <Loader2 size={16} aria-hidden="true" className="animate-spin" />}
          {pending === "password" ? "Signing in..." : "Sign in with password"}
          {pending !== "password" && <ArrowRight size={16} aria-hidden="true" />}
        </Button>
        <Button type="button" variant="ghost" className="h-11" disabled={pending !== null} onClick={sendMagicLink}>
          {pending === "magic" ? <Loader2 size={16} aria-hidden="true" className="animate-spin" /> : <Mail size={16} aria-hidden="true" />}
          {status === "sending" ? "Sending…" : "Send magic link"}
        </Button>
      </form>
    </div>
  );
}
