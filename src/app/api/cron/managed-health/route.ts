import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { observeRoute } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronAuthError } from "@/lib/security/cron-auth";

export const runtime = "nodejs";

/** States a provisioning run should leave within minutes; `ready` and `offboarded` are final. */
const FINAL = new Set(["ready", "offboarded"]);
const STUCK_AFTER_MS = 30 * 60_000;

/**
 * 2-Tier provisioning watchdog (#527), read-only: managed accounts by state, and each one sitting in
 * a non-final state for over 30 min (including `failed`). Public workflow logs get states, minutes
 * and an opaque key only, never business or Meta IDs. `.github/workflows/scheduled-jobs.yml` opens
 * one issue per stuck key.
 */
export const GET = observeRoute("/api/cron/managed-health", "GET", handleGET);

async function handleGET(request: Request) {
  const unauthorized = cronAuthError(request);
  if (unauthorized) return unauthorized;
  const { data, error } = await createAdminClient().from("managed_meta_accounts")
    .select("business_id, state, updated_at").limit(1000).abortSignal(AbortSignal.timeout(10_000));
  if (error || !Array.isArray(data)) {
    return NextResponse.json({ ok: false, error: "Managed accounts are unavailable." }, { status: 503 });
  }
  const now = Date.now();
  const byState: Record<string, number> = {};
  const stuck: Array<{ state: string; minutes: number; key: string }> = [];
  for (const row of data as Array<{ business_id: string; state: string; updated_at: string }>) {
    byState[row.state] = (byState[row.state] ?? 0) + 1;
    const age = now - Date.parse(row.updated_at);
    if (!FINAL.has(row.state) && age > STUCK_AFTER_MS) {
      const key = createHash("sha256").update(`${row.business_id}:${row.state}:${row.updated_at}`).digest("hex").slice(0, 12);
      stuck.push({ state: row.state, minutes: Math.floor(age / 60_000), key });
    }
  }
  return NextResponse.json({ ok: stuck.length === 0, accounts: data.length, byState, stuck });
}
