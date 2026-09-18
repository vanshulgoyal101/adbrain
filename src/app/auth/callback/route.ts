import { observeRoute } from "@/lib/observability/logger";
import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeAuthRedirect } from "@/lib/auth-redirect";

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

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
