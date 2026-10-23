import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { DEV_AUTH_COOKIE, isDevAuthEnabled } from "@/lib/dev-auth";
import { isSignedOutClaimsError } from "@/lib/supabase/auth-error";

// Every route under src/app/(app). Keep in sync with that folder — the layout
// also redirects, but guarding at the edge avoids a wasted render and keeps the
// post-login ?redirect= target.
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/brand",
  "/studio",
  "/campaigns",
  "/leads",
  "/assets",
  "/create",
  "/settings",
];

/**
 * Refreshes the Supabase auth session on every request and guards protected
 * routes. Must run in middleware so Server Components always see a fresh token.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do not run code between createServerClient and getClaims() — it must be the
  // first await so the session refresh cookies are attached to the response.
  // getClaims() verifies the JWT locally against the cached JWKS (no Auth round
  // trip) and only calls the network to refresh an expired session. Pages, server
  // actions and API routes still call getUser() for their own identity checks.
  const { data, error } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some((p) => path.startsWith(p));

  const devAuthed =
    isDevAuthEnabled() &&
    request.cookies.get(DEV_AUTH_COOKIE)?.value === "1";

  if (!signedIn && !devAuthed && isProtected && (!error || isSignedOutClaimsError(error))) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("redirect", path);
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}
