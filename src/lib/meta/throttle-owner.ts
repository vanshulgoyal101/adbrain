import type { SupabaseClient } from "@supabase/supabase-js";
import { ownerThrottledUntil } from "@/lib/meta/throttle-store";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * #1838 slice 2b: for a page that already proved the owner's business: until when Meta asked us to wait, or null.
 * Never fails the page (a failed read shows no line).
 */
export function metaWaitFor(businessId: string): Promise<string | null> {
  return Promise.resolve()
    .then(() => ownerThrottledUntil(createAdminClient() as unknown as SupabaseClient, businessId))
    .catch(() => null);
}
