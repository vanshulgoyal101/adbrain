import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types";

export async function creativeReferences(
  supabase: SupabaseClient<Database>,
  businessId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("brand_assets")
    .select("url, type")
    .eq("business_id", businessId)
    .in("type", ["product_photo", "past_ad"])
    .order("created_at", { ascending: false })
    .limit(12);
  if (error)
    throw new Error(
      "Could not load brand references. Generation has not started.",
    );
  return [...(data ?? [])]
    .sort(
      (left, right) =>
        Number(right.type === "product_photo") -
        Number(left.type === "product_photo"),
    )
    .slice(0, 3)
    .map((asset) => asset.url);
}
