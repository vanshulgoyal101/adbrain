import { campaignDestination } from "@/lib/campaign/outcomes";
import { costPerResultFrom, pickResultEvidence, toEvidenceCampaign, type EvidenceCampaign, type ResultEvidence } from "@/lib/campaign/result-evidence";
import { getLatestResults } from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";

const WINDOW_MS = 60 * 86_400_000;

/**
 * #371: the business's best and weakest recent campaign as evidence for Create. Reads through the
 * owner's session, so RLS keeps it to their own business. No Meta call: stored results only.
 */
/** The business's campaigns that spent in the last 60 days, with their stored results. */
async function recentResults(businessId: string, now: number) {
  const supabase = await createClient();
  const { data: campaigns, error } = await supabase.from("campaigns")
    .select("id, name, destination, raw, objective, creative_ids")
    .eq("business_id", businessId).order("created_at", { ascending: false }).limit(50);
  if (error || !campaigns?.length) return { supabase, recent: [] };
  const results = await getLatestResults(campaigns.map((campaign) => campaign.id));
  const recent = campaigns.flatMap((campaign) => {
    const result = results[campaign.id];
    if (!result || !(Number(result.spend) > 0) || now - Date.parse(result.fetched_at) > WINDOW_MS) return [];
    const destination = campaignDestination(campaign, result);
    return destination === "whatsapp" || destination === "instant_form" ? [{ campaign, result, destination }] : [];
  });
  return { supabase, recent };
}

export async function getResultEvidence(businessId: string, now = Date.now()): Promise<ResultEvidence[]> {
  const { supabase, recent } = await recentResults(businessId, now);
  if (!recent.length) return [];
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

/**
 * #419 2(b): the business's own cost per chat or lead for one kind of campaign, pooled over the
 * last 60 days of stored results; null before any result. Same session and rows as the evidence.
 */
export async function getCostPerResult(businessId: string, destination: EvidenceCampaign["destination"], now = Date.now()): Promise<number | null> {
  const { recent } = await recentResults(businessId, now);
  return costPerResultFrom(recent.map(({ result, destination: kind }) => ({
    destination: kind, spend: Number(result.spend) || 0, results: (kind === "whatsapp" ? result.conversations : result.leads) ?? 0,
  })), destination);
}

