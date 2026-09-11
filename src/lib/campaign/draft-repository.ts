import type { createClient } from "@/lib/supabase/server";
import { draftRecordFromRow, draftRecordToDTO } from "./draft-store";

export async function listEditableDrafts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actor: { businessId: string; userId: string },
) {
  const { data: drafts, error } = await supabase.from("campaign_drafts").select("*")
    .eq("business_id", actor.businessId).eq("owner_id", actor.userId)
    .gt("expires_at", new Date().toISOString()).order("updated_at", { ascending: false });
  if (error) throw new Error("Saved drafts could not be loaded.");
  if (!drafts?.length) return [];
  const { data: operations, error: operationError } = await supabase.from("campaign_operations")
    .select("draft_id").eq("business_id", actor.businessId).in("draft_id", drafts.map((draft) => draft.id));
  if (operationError) throw new Error("Saved draft operations could not be checked.");
  const usedDrafts = new Set((operations ?? []).map((operation) => operation.draft_id));
  return drafts.filter((draft) => !usedDrafts.has(draft.id)).map((draft) => draftRecordToDTO(draftRecordFromRow(draft)));
}