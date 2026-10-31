/**
 * #1057: several AdBrain businesses can share one Meta ad account (one owner's demo and real business, or an
 * agency). A Meta campaign belongs to one business only, or a pause from one would stop the other's spend and
 * results would count twice.
 */
export type CampaignClaim = { meta_campaign_id: string; business_id: string; created_at: string; source: string | null };

/** The business a Meta campaign belongs to: the one that launched it, else the one that imported it first. */
function owningBusiness(claims: readonly CampaignClaim[]): string | null {
  const launched = claims.filter(claim => claim.source === "campaign_operation");
  const pool = launched.length ? launched : claims;
  return [...pool].sort((a, b) => a.created_at.localeCompare(b.created_at))[0]?.business_id ?? null;
}

/** Meta campaign ids, among `claims`, that belong to a business other than `businessId`. */
export function campaignsOwnedElsewhere(claims: readonly CampaignClaim[], businessId: string): Set<string> {
  const byCampaign = new Map<string, CampaignClaim[]>();
  for (const claim of claims) byCampaign.set(claim.meta_campaign_id, [...byCampaign.get(claim.meta_campaign_id) ?? [], claim]);
  return new Set([...byCampaign].filter(([, list]) => {
    const owner = owningBusiness(list);
    return owner !== null && owner !== businessId;
  }).map(([id]) => id));
}
