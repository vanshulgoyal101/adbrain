import { setupBatch } from "@/lib/creative/setup-picks";
import { createClient } from "@/lib/supabase/server";
import type { Creative, CreativePreview } from "@/lib/types";

export async function getCreativePreviews(businessId: string): Promise<CreativePreview[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("creatives")
    .select("id, headline, image_url, status, angle, created_at, variant_group")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

/** Creatives for a business, newest first. */
export async function getCreatives(businessId: string): Promise<Creative[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("creatives")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

/**
 * #1270/#1402 (WS1 step 2): the ads setup made, oldest first: the newest batch (one `variant_group`), plus earlier
 * batches from the last 2 hours while there are fewer than 3 ads, so a "Make another" top-up shows beside its batch.
 * `newest` says when that batch started, so a short one can be checked before anything new is made.
 */
export async function getSetupCreativeBatch(businessId: string): Promise<ReturnType<typeof setupBatch<Creative>>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("creatives").select("*")
    .eq("business_id", businessId).order("created_at", { ascending: false }).limit(12);
  if (error) throw new Error("Ads could not be loaded.");
  return setupBatch(data ?? []);
}

/** Approved creatives for a business, newest first; Home must distinguish an unreadable list from an empty one. */
export async function getApprovedCreatives(
  businessId: string,
  options: { throwOnError?: boolean } = {},
): Promise<Creative[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("creatives")
    .select("*")
    .eq("business_id", businessId)
    .eq("status", "approved")
    .order("created_at", { ascending: false });
  if (options.throwOnError && (error || !data)) throw new Error("Approved ads could not be loaded.");
  return data ?? [];
}
