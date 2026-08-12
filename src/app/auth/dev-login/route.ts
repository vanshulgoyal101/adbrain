import { NextResponse } from "next/server";
import { DEV_AUTH_COOKIE, isDevAuthEnabled } from "@/lib/dev-auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Dev-only: log in as the developer. If DEV_LOGIN_EMAIL/PASSWORD are set and
 * Supabase is reachable, it creates a real session (RLS-scoped data). Otherwise
 * it falls back to an offline dev cookie so the app is browsable without any
 * backend. A no-op unless NEXT_PUBLIC_DEV_AUTH_BYPASS=true.
 */
export async function GET(request: Request) {
  const { origin } = new URL(request.url);

  if (!isDevAuthEnabled()) {
    return NextResponse.redirect(`${origin}/login`);
  }

  // Prefer a real session when credentials are configured and the backend is up.
  const email = process.env.DEV_LOGIN_EMAIL;
  const password = process.env.DEV_LOGIN_PASSWORD;
  if (email && password) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (!error) {
        // Real session wins — drop any stale offline dev cookie.
        const res = NextResponse.redirect(`${origin}/dashboard`);
        res.cookies.set(DEV_AUTH_COOKIE, "", { path: "/", maxAge: 0 });
        return res;
      }
    } catch {
      // Backend unreachable — fall through to the offline dev cookie.
    }
  }

  // Offline fallback: mark this browser as the developer.
  const res = NextResponse.redirect(`${origin}/dashboard`);
  res.cookies.set(DEV_AUTH_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
