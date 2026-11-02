import type { SupabaseClient } from "@supabase/supabase-js";

/** #1476: Cloudflare's free 10,000 neurons a day ÷ 172.8 per FLUX-1-schnell picture, shared by all customers and smokes. */
export const CLOUDFLARE_FREE_PICTURES_A_DAY = 57;
/** #2404: alert while there is still room to act, before Create falls to Pollinations. */
export const CLOUDFLARE_ALERT_AT = 45;

export type CloudflareToday = { day: string; pictures: number; capped: boolean; alertAt: number; dailyCap: number; near: boolean };

/**
 * #2404: today's Cloudflare free pictures (UTC day, as Cloudflare resets) from our own image usage rows, and whether
 * Cloudflare already refused one for its daily limit. Null when the rows can't be read, so a read failure never alerts.
 */
export async function cloudflareToday(supabase: SupabaseClient, now = new Date()): Promise<CloudflareToday | null> {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  try {
    const rows = () => supabase.from("llm_usage_events").select("id", { count: "exact", head: true })
      .eq("usage_kind", "image").eq("provider", "cloudflare").gte("created_at", since);
    const [made, refused] = await Promise.all([
      rows().in("status", ["success", "fallback"]),
      rows().eq("error_code", "IMAGE_FREE_DAILY_LIMIT"),
    ]);
    if (made.error || refused.error || made.count === null || refused.count === null) return null;
    const capped = refused.count > 0;
    return { day: since.slice(0, 10), pictures: made.count, capped, alertAt: CLOUDFLARE_ALERT_AT, dailyCap: CLOUDFLARE_FREE_PICTURES_A_DAY,
      near: capped || made.count >= CLOUDFLARE_ALERT_AT };
  } catch {
    return null;
  }
}
