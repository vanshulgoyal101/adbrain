import type { SupabaseClient } from "@supabase/supabase-js";
import type { MetaThrottledError } from "@/lib/meta/client";
import { recordProductEvent } from "@/lib/observability/logger";

/**
 * #1838 slice 2: what the scheduled jobs remember about Meta's throttling (migration 20261029_meta_throttle.sql).
 * Crons only: a person's pause or activation is always tried. Every read fails open (no skip) and every write is best
 * effort, so a missing table or a slow database never stops a run, but each failure is logged (QA, #1950) so a
 * missing migration or grant doesn't leave the feature silently off.
 */
type Admin = Pick<SupabaseClient, "from" | "rpc">;

function storeFailed(errorCode: "THROTTLE_APP_READ_FAILED" | "THROTTLE_READ_FAILED" | "THROTTLE_WRITE_FAILED", businessId?: string) {
  recordProductEvent({ kind: "system", name: "meta.throttle_store", outcome: "failed", businessId, attributes: { errorCode } });
}

/** Until when the whole app is throttled (Graph 4), or null. */
export async function appThrottledUntil(admin: Admin): Promise<string | null> {
  try {
    const { data, error } = await admin.rpc("meta_app_throttled_until");
    if (error) { storeFailed("THROTTLE_APP_READ_FAILED"); return null; }
    return typeof data === "string" ? data : null;
  } catch {
    storeFailed("THROTTLE_APP_READ_FAILED");
    return null;
  }
}

/** The businesses whose ad account or Page is still throttled, with until when. */
export async function throttledBusinesses(admin: Admin, businessIds: string[], now = new Date()): Promise<Map<string, string>> {
  if (!businessIds.length) return new Map();
  try {
    const { data, error } = await admin.from("meta_connections").select("business_id, throttled_until")
      .in("business_id", [...new Set(businessIds)]).gt("throttled_until", now.toISOString());
    if (error || !Array.isArray(data)) { storeFailed("THROTTLE_READ_FAILED"); return new Map(); }
    return new Map((data as { business_id: string; throttled_until: string }[]).map((row) => [row.business_id, row.throttled_until]));
  } catch {
    storeFailed("THROTTLE_READ_FAILED");
    return new Map();
  }
}

/** Remembers Meta's throttle for the next runs. */
export async function recordThrottle(admin: Admin, businessId: string, error: MetaThrottledError, now = Date.now()): Promise<void> {
  try {
    const result = await admin.rpc("meta_throttle_record", { p_business_id: businessId, p_scope: error.scope, p_until: new Date(now + error.retryAfterMs).toISOString() });
    if (result?.error) storeFailed("THROTTLE_WRITE_FAILED", businessId);
  } catch {
    storeFailed("THROTTLE_WRITE_FAILED", businessId);
  }
}
