"use client";

import { useState } from "react";
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
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [pending, setPending] = useState<"magic" | "password" | "google" | null>(null);
  const [error, setError] = useState<string | null>(
    authError ? "Sign-in failed. Please try again." : null,
  );

  function callbackUrl() {
    return `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(redirect)}`;
  }

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
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
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-5 text-center">
        <p className="font-medium text-blue-800">Check your email</p>
        <p className="mt-1 text-sm text-blue-700">
          We sent a magic link to <span className="font-medium">{email}</span>.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
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

      <form onSubmit={sendMagicLink} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={pending !== null}>
          {status === "sending" ? "Sending…" : "Send magic link"}
        </Button>
      </form>

      <div className="flex items-center gap-3 text-xs text-slate-400">
        <div className="h-px flex-1 bg-slate-200" />
        or use password
        <div className="h-px flex-1 bg-slate-200" />
      </div>

      <form onSubmit={signInWithPassword} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <Button type="submit" variant="outline" disabled={pending !== null || !email || !password}>
          {pending === "password" ? "Signing in..." : "Sign in with password"}
        </Button>
      </form>

      <div className="flex items-center gap-3 text-xs text-slate-400">
        <div className="h-px flex-1 bg-slate-200" />
        or
        <div className="h-px flex-1 bg-slate-200" />
      </div>

      <Button type="button" variant="outline" disabled={pending !== null} onClick={signInWithGoogle}>
        {pending === "google" ? "Connecting..." : "Continue with Google"}
      </Button>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
