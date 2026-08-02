import { createClient } from "@/lib/supabase/server";
import type {
  BrandAsset,
  Business,
  Campaign,
  CampaignResult,
  Creative,
} from "@/lib/types";

/** Current authenticated user, or null. */
export async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** All businesses owned by the current user (RLS-scoped). */
export async function getBusinesses(): Promise<Business[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("businesses")
    .select("*")
    .order("created_at", { ascending: true });
  return data ?? [];
}

/** The user's first business (v1 is single-business per user). */
export async function getPrimaryBusiness(): Promise<Business | null> {
  const businesses = await getBusinesses();
  return businesses[0] ?? null;
}

export async function getBusinessById(id: string): Promise<Business | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("businesses")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data ?? null;
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

/** Brand assets for a business, newest first. */
export async function getBrandAssets(
  businessId: string,
): Promise<BrandAsset[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("brand_assets")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

/** Approved creatives for a business, newest first. */
export async function getApprovedCreatives(
  businessId: string,
): Promise<Creative[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("creatives")
    .select("*")
    .eq("business_id", businessId)
    .eq("status", "approved")
    .order("created_at", { ascending: false });
  return data ?? [];
}

/** Campaigns for a business, newest first. */
export async function getCampaigns(businessId: string): Promise<Campaign[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("campaigns")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

/** Latest result row per campaign, keyed by campaign id. */
export async function getLatestResults(
  campaignIds: string[],
): Promise<Record<string, CampaignResult>> {
  if (!campaignIds.length) return {};
  const supabase = await createClient();
  const { data } = await supabase
    .from("campaign_results")
    .select("*")
    .in("campaign_id", campaignIds)
    .order("fetched_at", { ascending: false });
  const map: Record<string, CampaignResult> = {};
  for (const row of data ?? []) {
    if (!map[row.campaign_id]) map[row.campaign_id] = row;
  }
  return map;
}
