import { campaignDestination } from "@/lib/campaign/outcomes";
import { pickResultEvidence, toEvidenceCampaign, type EvidenceCampaign, type ResultEvidence } from "@/lib/campaign/result-evidence";
import { getLatestResults } from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";

const WINDOW_MS = 60 * 86_400_000;

/**
 * #371: the business's best and weakest recent campaign as evidence for Create. Reads through the
 * owner's session, so RLS keeps it to their own business. No Meta call: stored results only.
 */
export async function getResultEvidence(businessId: string, now = Date.now()): Promise<ResultEvidence[]> {
  const supabase = await createClient();
  const { data: campaigns, error } = await supabase.from("campaigns")
    .select("id, name, destination, raw, objective, creative_ids")
    .eq("business_id", businessId).order("created_at", { ascending: false }).limit(50);
  if (error || !campaigns?.length) return [];
  const results = await getLatestResults(campaigns.map((campaign) => campaign.id));
  const recent = campaigns.flatMap((campaign) => {
    const result = results[campaign.id];
    if (!result || !(Number(result.spend) > 0) || now - Date.parse(result.fetched_at) > WINDOW_MS) return [];
    const destination = campaignDestination(campaign, result);
    return destination === "whatsapp" || destination === "instant_form" ? [{ campaign, result, destination }] : [];
  });
  const ids = [...new Set(recent.flatMap(({ campaign }) => campaign.creative_ids ?? []))];
  if (!ids.length) return [];
  const { data: creatives, error: creativeError } = await supabase.from("creatives")
    .select("id, headline, brief, angle, generation").eq("business_id", businessId).in("id", ids);
  if (creativeError || !creatives) return [];
  return pickResultEvidence(recent.flatMap(({ campaign, result, destination }) => {
    const evidence: EvidenceCampaign | null = toEvidenceCampaign(campaign, result, destination, creatives);
    return evidence ? [evidence] : [];
  }));
}
