import { NextResponse } from "next/server";
import { campaignsOwnedElsewhere, type CampaignClaim } from "@/lib/campaign/sync-ownership";
import { createAdminClient } from "@/lib/supabase/admin";

export const OWNED_ELSEWHERE = "This campaign belongs to another of your AdBrain businesses. Change it from that business; deleting it here only removes this copy.";

/**
 * #1138: the Meta campaign ids, among `metaCampaignIds`, that another AdBrain business owns (#1057's rule: the one
 * that launched it, else the first to import it). A duplicate row from before #1062, or from two concurrent syncs,
 * must never write to Meta or count toward this business's spend. Other businesses' rows are hidden by RLS, so
 * claims are read with the service role (ids only). Throws when storage can't answer, so callers fail closed.
 */
export async function metaCampaignsOwnedElsewhere(businessId: string, metaCampaignIds: readonly (string | null | undefined)[]): Promise<Set<string>> {
  const ids = [...new Set(metaCampaignIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return new Set();
  const { data, error } = await createAdminClient().from("campaigns")
    .select("meta_campaign_id,business_id,created_at,source:raw->>source").in("meta_campaign_id", ids);
  if (error || !data) throw new Error("Campaign storage unavailable.");
  return campaignsOwnedElsewhere(data as unknown as CampaignClaim[], businessId);
}

export async function campaignOwnedElsewhere(businessId: string, metaCampaignId: string | null | undefined): Promise<boolean> {
  return metaCampaignId ? (await metaCampaignsOwnedElsewhere(businessId, [metaCampaignId])).has(metaCampaignId) : false;
}

/** This business's own campaigns among `campaigns`: rows duplicating another business's Meta campaign are left out. */
export async function withoutDuplicates<T extends { meta_campaign_id: string | null }>(businessId: string, campaigns: T[]): Promise<T[]> {
  const elsewhere = await metaCampaignsOwnedElsewhere(businessId, campaigns.map(campaign => campaign.meta_campaign_id));
  return campaigns.filter(campaign => !campaign.meta_campaign_id || !elsewhere.has(campaign.meta_campaign_id));
}

/** The response that stops a Meta write on a duplicate row (409), or on unreadable ownership (503); null when the business owns it. */
export async function ownerRefusal(businessId: string, metaCampaignId: string | null | undefined): Promise<NextResponse | null> {
  const elsewhere = await campaignOwnedElsewhere(businessId, metaCampaignId).catch(() => null);
  if (elsewhere === false) return null;
  return elsewhere
    ? NextResponse.json({ error: OWNED_ELSEWHERE, code: "owned_elsewhere" }, { status: 409 })
    : NextResponse.json({ error: "Campaign storage unavailable. Try again.", retryable: true }, { status: 503 });
}
