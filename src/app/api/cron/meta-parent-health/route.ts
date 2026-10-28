import { NextResponse } from "next/server";
import { checkParentAccess } from "@/lib/meta/parent";
import { observeRoute } from "@/lib/observability/logger";
import { cronAuthError } from "@/lib/security/cron-auth";

export const runtime = "nodejs";

/**
 * 2-Tier parent token check (#520), read-only: `ok` when the token is missing (nothing to check yet)
 * or works; 503 when it is set but Meta refuses it. Called by the production guard after each deploy.
 */
export const GET = observeRoute("/api/cron/meta-parent-health", "GET", handleGET);

async function handleGET(request: Request) {
  const unauthorized = cronAuthError(request);
  if (unauthorized) return unauthorized;
  const access = await checkParentAccess();
  if (!access.configured) return NextResponse.json({ ok: true, ...access });
  return NextResponse.json(access, { status: access.ok ? 200 : 503 });
}
