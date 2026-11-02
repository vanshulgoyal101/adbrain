import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { observeRoute, recordProductEvent } from "@/lib/observability/logger";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const POST = observeRoute("/api/internal/test-session", "POST", handlePOST);

const bodySchema = z.object({ email: z.string().trim().toLowerCase().email().max(320) }).strict();
const noStore = { "Cache-Control": "no-store" };

const digest = (value: string) => createHash("sha256").update(value).digest();

function reject(status: 401 | 403 | 422 | 502, error: string) {
  recordProductEvent({ kind: "workflow", name: "auth.test_session", outcome: status === 502 ? "failed" : "rejected", attributes: { status } });
  return NextResponse.json({ error }, { status, headers: noStore });
}

/**
 * #2574: smokes and test scripts sign in here instead of with a password, so Supabase CAPTCHA (#1777) can stay on.
 * The service key never leaves the server: a caller holds only `TEST_SESSION_SECRET`, and a session is minted only
 * for an email in `TEST_SESSION_EMAILS` (smoke/QA logins). The app's own server client verifies the one-time token,
 * so the response sets the same session cookie a browser sign-in would.
 */
async function handlePOST(request: Request) {
  const { TEST_SESSION_SECRET: secret, TEST_SESSION_EMAILS: emails } = getEnv();
  if (!secret || !emails.length) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // The platform sets x-real-ip and appends the caller to x-forwarded-for; a script can only prepend.
  const address = request.headers.get("x-real-ip")?.trim()
    || request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "unknown";
  const limited = await rateLimitResponse(`test-session:${address}`, { limit: 10, windowMs: 10 * 60_000 });
  if (limited) return limited;
  if (!timingSafeEqual(digest(request.headers.get("authorization") ?? ""), digest(`Bearer ${secret}`))) {
    return reject(401, "Unauthorized");
  }
  // Counted only after the secret, so strangers can't spend it and fail the production guard into a rollback.
  const overall = await rateLimitResponse("test-session:all", { limit: 60, windowMs: 10 * 60_000 });
  if (overall) return overall;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return reject(422, "Send { email }.");
  const { email } = parsed.data;
  if (!emails.some((allowed) => allowed.toLowerCase() === email)) return reject(403, "Forbidden");

  // `recovery`, not `magiclink`: for an unknown email GoTrue answers 404 instead of signing a new user up.
  const link = await createAdminClient().auth.admin.generateLink({ type: "recovery", email });
  const tokenHash = link.data?.properties?.hashed_token;
  if (link.error || !tokenHash) return reject(502, "No sign-in token.");
  const { data, error } = await (await createClient()).auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
  if (error || !data.session) return reject(502, "Sign-in token not accepted.");

  recordProductEvent({ kind: "workflow", name: "auth.test_session", outcome: "success" });
  return NextResponse.json({
    user: { id: data.session.user.id, email: data.session.user.email },
    accessToken: data.session.access_token,
    supabase: process.env.NEXT_PUBLIC_SUPABASE_URL,
    apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  }, { headers: noStore });
}
