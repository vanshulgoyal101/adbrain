import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/lib/types";

type Actor = { businessId: string; userId: string };
type Store = ReturnType<typeof createAdminClient>;
type CampaignInsert = Database["public"]["Tables"]["campaigns"]["Insert"];
type ResultInsert = Database["public"]["Tables"]["campaign_results"]["Insert"];

async function checkOwner(database: Store, actor: Actor) {
  const { data, error } = await database.from("businesses").select("id")
    .eq("id", actor.businessId).eq("owner_id", actor.userId).maybeSingle();
  if (error || !data) throw new Error("Campaign write ownership could not be verified.");
}

export async function saveCampaign(
  actor: Actor, values: Partial<Omit<CampaignInsert, "business_id" | "id" | "created_at">>,
  campaignId?: string, database: Store = createAdminClient(),
) {
  await checkOwner(database, actor);
  return campaignId
    ? database.from("campaigns").update({ ...values, business_id: actor.businessId }).eq("business_id", actor.businessId).eq("id", campaignId).select("*").single()
    : database.from("campaigns").insert({ objective: "leads", ...values, business_id: actor.businessId }).select("*").single();
}

export async function saveCampaignResult(actor: Actor, values: ResultInsert, database: Store = createAdminClient()) {
  await checkOwner(database, actor);
  const { data, error } = await database.from("campaigns").select("id")
    .eq("business_id", actor.businessId).eq("id", values.campaign_id).maybeSingle();
  if (error || !data) throw new Error("Result campaign ownership could not be verified.");
  return database.from("campaign_results").insert(values).select("*").single();
}

/** #258: merge `raw.health` into a still-active campaign, re-reading `raw` so stored children and caps are kept. */
export async function saveCampaignHealth(actor: Actor, campaignId: string, health: Json, database: Store = createAdminClient()) {
  await checkOwner(database, actor);
  const { data, error } = await database.from("campaigns").select("raw")
    .eq("business_id", actor.businessId).eq("id", campaignId).eq("status", "active").maybeSingle();
  if (error || !data) return { error };
  const raw = data.raw && typeof data.raw === "object" && !Array.isArray(data.raw) ? data.raw : {};
  return database.from("campaigns").update({ raw: { ...raw, health } })
    .eq("business_id", actor.businessId).eq("id", campaignId).eq("status", "active").select("id").maybeSingle();
}

export async function deleteVerifiedCampaign(actor: Actor, campaignId: string, database: Store = createAdminClient()) {
  await checkOwner(database, actor);
  return database.from("campaigns").delete().eq("business_id", actor.businessId).eq("id", campaignId).select("id").single();
}