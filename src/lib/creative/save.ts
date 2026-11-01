import type { SupabaseClient } from "@supabase/supabase-js";
import { recordProductEvent } from "@/lib/observability/logger";
import type { Creative, Database } from "@/lib/types";

type CreativeRow = Omit<Database["public"]["Tables"]["creatives"]["Insert"], "id">;

/** #2494: a finished ad (words checked, picture stored) the database would not take; `code` is Postgres's or PostgREST's. */
export class CreativeSaveError extends Error {
  constructor(public code: string) {
    super("Could not save the creative. Check the generation schema migration.");
    this.name = "CreativeSaveError";
  }
}

// Data (22…), constraint (23…) and schema/permission (42…, PGRST2…) errors fail again the same way.
const deterministic = (code: string) => /^(22|23|42|PGRST2)/.test(code);

/**
 * Saves a finished ad. #2494: one failed insert threw away an ad whose words and picture were already made (Create run
 * 41306939001), so a failure is retried once under the same id, and an insert that landed but lost its reply is read
 * back instead of saved twice. Each failed attempt records its database code, never the row.
 */
export async function saveCreative(supabase: SupabaseClient<Database>, row: CreativeRow, attempts = 2): Promise<Creative> {
  const id = crypto.randomUUID();
  let code = "UNKNOWN";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const { data, error } = await supabase.from("creatives").insert({ ...row, id }).select("*").single();
    if (data && !error) return data;
    code = /^[A-Za-z0-9_]{1,40}$/.test(error?.code ?? "") ? error!.code : "UNKNOWN";
    recordProductEvent({ kind: "system", name: "creative.save", outcome: "failed", businessId: row.business_id,
      attributes: { entityType: "creative", errorCode: code, attempt } });
    const { data: landed } = await supabase.from("creatives").select("*").eq("id", id).maybeSingle();
    if (landed) return landed;
    if (deterministic(code)) break;
  }
  throw new CreativeSaveError(code);
}
