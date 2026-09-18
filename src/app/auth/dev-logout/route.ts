import { observeRoute } from "@/lib/observability/logger";
import { NextResponse } from "next/server";
import { DEV_AUTH_COOKIE } from "@/lib/dev-auth";

/** Clears the offline dev session cookie and returns to the login page. */
export const GET = observeRoute("/auth/dev-logout", "GET", handleGET);

async function handleGET(request: Request) {
  const { origin } = new URL(request.url);
  const res = NextResponse.redirect(`${origin}/login`);
  res.cookies.set(DEV_AUTH_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
