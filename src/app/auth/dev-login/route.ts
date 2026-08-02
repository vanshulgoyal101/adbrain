import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Dev-only: signs in a seeded dev user (email/password from env) so the app is
 * usable locally without Google or magic-link. Guarded by
 * NEXT_PUBLIC_DEV_AUTH_BYPASS — a no-op unless explicitly enabled.
 */
export async function GET(request: Request) {
  const { origin } = new URL(request.url);

  if (process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS !== "true") {
    return NextResponse.redirect(`${origin}/login`);
  }

  const email = process.env.DEV_LOGIN_EMAIL;
  const password = process.env.DEV_LOGIN_PASSWORD;
  if (!email || !password) {
    return NextResponse.redirect(`${origin}/login?error=devconfig`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=dev`);
  }

  return NextResponse.redirect(`${origin}/dashboard`);
}
