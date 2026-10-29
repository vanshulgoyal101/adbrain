import type { SupabaseClient } from "@supabase/supabase-js";
import type { MetaThrottledError } from "@/lib/meta/client";

/**
 * #1838 slice 2: what the scheduled jobs remember about Meta's throttling (migration 20261029_meta_throttle.sql).
 * Crons only: a person's pause or activation is always tried. Every read fails open (no skip) and every write is best
 * effort, so a missing table or a slow database never stops a run.
 */
type Admin = Pick<SupabaseClient, "from" | "rpc">;

/** Until when the whole app is throttled (Graph 4), or null. */
export async function appThrottledUntil(admin: Admin): Promise<string | null> {
  try {
    const { data, error } = await admin.rpc("meta_app_throttled_until");
    return !error && typeof data === "string" ? data : null;
  } catch {
    return null;
  }
}

/** The businesses whose ad account or Page is still throttled, with until when. */
export async function throttledBusinesses(admin: Admin, businessIds: string[], now = new Date()): Promise<Map<string, string>> {
  if (!businessIds.length) return new Map();
  try {
    const { data, error } = await admin.from("meta_connections").select("business_id, throttled_until")
      .in("business_id", [...new Set(businessIds)]).gt("throttled_until", now.toISOString());
    if (error || !Array.isArray(data)) return new Map();
    return new Map((data as { business_id: string; throttled_until: string }[]).map((row) => [row.business_id, row.throttled_until]));
  } catch {
    return new Map();
  }
}

/** Remembers Meta's throttle for the next runs. */
export async function recordThrottle(admin: Admin, businessId: string, error: MetaThrottledError, now = Date.now()): Promise<void> {
  try {
    await admin.rpc("meta_throttle_record", { p_business_id: businessId, p_scope: error.scope, p_until: new Date(now + error.retryAfterMs).toISOString() });
  } catch {}
}

/** #1838 slice 2b: until when the owner's numbers can't be refreshed (their account/Page or the whole app), or null. */
export async function ownerThrottledUntil(admin: Admin, businessId: string, now = new Date()): Promise<string | null> {
  const [app, business] = await Promise.all([appThrottledUntil(admin), throttledBusinesses(admin, [businessId], now)]);
  const until = [app, business.get(businessId) ?? null].filter((value): value is string => Boolean(value) && Date.parse(value!) > now.getTime());
  return until.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
}
