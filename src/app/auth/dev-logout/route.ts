import { NextResponse } from "next/server";
import { DEV_AUTH_COOKIE } from "@/lib/dev-auth";

/** Clears the offline dev session cookie and returns to the login page. */
export async function GET(request: Request) {
  const { origin } = new URL(request.url);
  const res = NextResponse.redirect(`${origin}/login`);
  res.cookies.set(DEV_AUTH_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
