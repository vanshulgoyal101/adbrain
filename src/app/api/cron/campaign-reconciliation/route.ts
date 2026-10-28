import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { observeRoute } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronAuthError } from "@/lib/security/cron-auth";

export const runtime = "nodejs";

const STUCK_AFTER_MS = 30 * 60_000;

/** The opaque key the alert issue names (sha256 of the id, 12 hex); `scripts/reconcile-operation.mjs --key` finds the row by it. */
function operationKey(id: string): string {
  return createHash("sha256").update(id).digest("hex").slice(0, 12);
}

/**
 * Launch reconciliation watchdog (#734), read-only: each campaign operation left in
 * `needs_reconciliation` for over 30 min (Meta may hold a partial campaign AdBrain doesn't track).
 * Public workflow logs get minutes and an opaque key only. `.github/workflows/scheduled-jobs.yml`
 * opens one issue per key.
 */
export const GET = observeRoute("/api/cron/campaign-reconciliation", "GET", handleGET);

async function handleGET(request: Request) {
  const unauthorized = cronAuthError(request);
  if (unauthorized) return unauthorized;
  const { data, error } = await createAdminClient().from("campaign_operations")
    .select("id, updated_at").eq("state", "needs_reconciliation").limit(1000).abortSignal(AbortSignal.timeout(10_000));
  if (error || !Array.isArray(data)) {
    return NextResponse.json({ ok: false, error: "Campaign operations are unavailable." }, { status: 503 });
  }
  const now = Date.now();
  const stuck = (data as Array<{ id: string; updated_at: string }>)
    .map((row) => ({ key: operationKey(row.id), minutes: Math.floor((now - Date.parse(row.updated_at)) / 60_000) }))
    .filter((row) => row.minutes * 60_000 > STUCK_AFTER_MS)
    .sort((a, b) => b.minutes - a.minutes);
  return NextResponse.json({ ok: stuck.length === 0, waiting: data.length, stuck });
}
