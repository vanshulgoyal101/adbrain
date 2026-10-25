import { campaignDestination } from "@/lib/campaign/outcomes";
import { getCostPerResult } from "@/lib/campaign/result-evidence-store";
import { createClient } from "@/lib/supabase/server";

export type ActivationLearning = { costPerResultRupees: number | null; pausedAt: string | null };

type LearningCampaign = { id: string; business_id: string; status: string; destination?: string | null; raw?: unknown; objective?: string };

async function quietly<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

/** When AdBrain last paused this campaign, if that is its latest pause or resume (owner's session, RLS). */
async function lastPausedAt(businessId: string, campaignId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("audit_log").select("action, created_at")
    .eq("business_id", businessId).eq("entity_type", "campaign").eq("entity_id", campaignId)
    .in("action", ["campaign.pause", "campaign.resume"])
    .order("created_at", { ascending: false }).limit(1);
  const last = error ? null : data?.[0];
  return last?.action === "campaign.pause" ? last.created_at : null;
}

/**
 * #419 item 2: what the activation review needs to warn about edits that restart Meta's learning:
 * the business's own cost per result and when AdBrain paused this campaign. A pause made in Meta
 * isn't in AdBrain's audit log, so it gives no warning rather than a guess. Never throws.
 */
export async function getActivationLearning(campaign: LearningCampaign): Promise<ActivationLearning> {
  const destination = campaignDestination(campaign);
  const [costPerResultRupees, pausedAt] = await Promise.all([
    destination === "whatsapp" || destination === "instant_form" ? quietly(() => getCostPerResult(campaign.business_id, destination)) : null,
    campaign.status === "paused" ? quietly(() => lastPausedAt(campaign.business_id, campaign.id)) : null,
  ]);
  return { costPerResultRupees, pausedAt };
}
