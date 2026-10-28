import { NextResponse } from "next/server";
import { owningBusiness, type CampaignClaim } from "@/lib/campaign/sync-ownership";
import { createAdminClient } from "@/lib/supabase/admin";

export const OWNED_ELSEWHERE = "This campaign belongs to another of your AdBrain businesses. Change it from that business; deleting it here only removes this copy.";

/**
 * #1138: true when another AdBrain business owns this Meta campaign (#1057's rule: the one that launched it, else
 * the first to import it). A duplicate row from before #1062, or from two concurrent syncs, must never write to Meta.
 * Other businesses' rows are hidden by RLS, so claims are read with the service role (ids only). Throws when
 * storage can't answer, so callers fail closed.
 */
export async function campaignOwnedElsewhere(businessId: string, metaCampaignId: string | null | undefined): Promise<boolean> {
  if (!metaCampaignId) return false;
  const { data, error } = await createAdminClient().from("campaigns")
    .select("meta_campaign_id,business_id,created_at,raw").eq("meta_campaign_id", metaCampaignId);
  if (error || !data) throw new Error("Campaign storage unavailable.");
  const claims: CampaignClaim[] = (data as { meta_campaign_id: string; business_id: string; created_at: string; raw: unknown }[]).map(row => {
    const source = (row.raw as { source?: unknown } | null)?.source;
    return { meta_campaign_id: row.meta_campaign_id, business_id: row.business_id, created_at: row.created_at, source: typeof source === "string" ? source : null };
  });
  const owner = owningBusiness(claims);
  return owner !== null && owner !== businessId;
}

/** The response that stops a Meta write on a duplicate row (409), or on unreadable ownership (503); null when the business owns it. */
export async function ownerRefusal(businessId: string, metaCampaignId: string | null | undefined): Promise<NextResponse | null> {
  const elsewhere = await campaignOwnedElsewhere(businessId, metaCampaignId).catch(() => null);
  if (elsewhere === false) return null;
  return elsewhere
    ? NextResponse.json({ error: OWNED_ELSEWHERE, code: "owned_elsewhere" }, { status: 409 })
    : NextResponse.json({ error: "Campaign storage unavailable. Try again.", retryable: true }, { status: 503 });
}
