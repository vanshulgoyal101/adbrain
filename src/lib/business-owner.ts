import { createAdminClient } from "@/lib/supabase/admin";

/** The business's owner (admin read), or null when it can't be read. The Meta adapter uses it for the smoke account's pause-only mode (#1324, #1649). */
export async function businessOwnerId(businessId: string): Promise<string | null> {
  const { data, error } = await createAdminClient().from("businesses").select("owner_id").eq("id", businessId).maybeSingle();
  return error ? null : ((data as { owner_id?: string } | null)?.owner_id ?? null);
}
