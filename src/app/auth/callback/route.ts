import { observeRoute, recordProductEvent } from "@/lib/observability/logger";
import { observeVerifiedUser } from "@/lib/observability/context";
import { safeAuthCode, type AuthMethod } from "@/lib/observability/auth-events";
import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeAuthRedirect } from "@/lib/auth-redirect";
import { callbackErrorReason } from "@/lib/auth-callback-error";

/**
 * Handles both auth completion paths:
 *  - OAuth (Google): `?code=...` → exchangeCodeForSession
 *  - Email magic link: `?token_hash=...&type=...` → verifyOtp
 */
export const GET = observeRoute("/auth/callback", "GET", handleGET);

async function handleGET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeAuthRedirect(searchParams.get("redirect"));
  // #1562: email links come back with a `code` too; the login form says which sign-in started this.
  const via = searchParams.get("via") === "email" ? "email" : "google";
  const codeMethod: AuthMethod = via === "email" ? "email_link" : "google";

  const supabase = await createClient();
  let failure: string | null | undefined;

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return signedIn(codeMethod, data?.user, `${origin}${next}`);
    failure = error.code;
    recordFailure(`auth.sign_in.${codeMethod}`, failure);
  } else if (tokenHash && type) {
    const { data, error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) return signedIn("email_link", data?.user, `${origin}${next}`);
    failure = error.code;
    recordFailure("auth.sign_in.email_link", failure);
  } else {
    // A provider error (Google cancelled) or a bare link: this used to be a silent 302 (#451 L4).
    failure = searchParams.get("error_code") ?? searchParams.get("error") ?? "missing_params";
    recordFailure("auth.sign_in", failure);
  }

  // #1414: the login page says what happened (expired link, other browser, cancelled) with one action.
  const back = next === "/dashboard" ? "" : `&redirect=${encodeURIComponent(next)}`;
  return NextResponse.redirect(`${origin}/login?error=${callbackErrorReason(failure, code ? via : "google")}${back}`);
}

type CallbackUser = { id: string; email?: string | null; email_confirmed_at?: string | null; last_sign_in_at?: string | null } | null | undefined;

/** A first sign-in confirms the address in the same moment; a returning owner confirmed it long ago. */
function isFirstSignIn(user: CallbackUser): boolean {
  const confirmed = Date.parse(user?.email_confirmed_at ?? "");
  const signedIn = Date.parse(user?.last_sign_in_at ?? "");
  return Number.isFinite(confirmed) && Number.isFinite(signedIn) && Math.abs(signedIn - confirmed) < 60_000;
}

function signedIn(method: AuthMethod, user: CallbackUser, destination: string) {
  if (user) observeVerifiedUser(user);
  recordProductEvent({ kind: "workflow", name: `auth.${isFirstSignIn(user) ? "sign_up" : "sign_in"}.${method}`, outcome: "success" });
  return NextResponse.redirect(destination);
}

function recordFailure(name: string, code: string | null | undefined) {
  recordProductEvent({ kind: "workflow", name, outcome: "failed", attributes: { errorCode: `AUTH_CALLBACK:${safeAuthCode(code)}` } });
}
