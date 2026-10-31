import type { SupabaseClient } from "@supabase/supabase-js";
import { logEvent } from "@/lib/audit";
import { intendedCampaignChildren, reviewableCampaign } from "@/lib/campaign/activation";
import { recordAdPause, type AdPauseEntry } from "@/lib/campaign/ad-pause";
import { saveCampaign } from "@/lib/campaign/trusted-write";
import { friendlyMetaError, metaErrorCode, MetaWriteUncertainError } from "@/lib/meta/client";
import { withMetaConnection, type AuthorizedBusiness } from "@/lib/meta/connection-access";
import { recordProductEvent } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/types";
import { CampaignEditError, refuseWhileSwitchPending } from "./edit-service";

export type AdPauseAction = "pause" | "undo";
export type AdPauseResult = { adId: string; status: string | null; effectiveStatus: string | null; changed: boolean };

function adPauses(raw: unknown): AdPauseEntry[] {
  const entries = (raw as { adPauses?: unknown } | null)?.adPauses;
  return Array.isArray(entries) ? entries.filter((entry): entry is AdPauseEntry => typeof (entry as AdPauseEntry)?.adId === "string") : [];
}

const UNCONFIRMED = "Meta didn't confirm the change. Refresh the campaign before trying again.";
/** How long an unconfirmed change of AdBrain's can still be recognised on a retry (#2395). */
const INTENT_TTL_MS = 24 * 60 * 60 * 1000;

/** #2395: changes AdBrain sent to Meta but hasn't confirmed (`campaigns.raw.adPauseIntents`), at most one per ad. */
function adPauseIntents(raw: unknown): AdPauseEntry[] {
  const entries = (raw as { adPauseIntents?: unknown } | null)?.adPauseIntents;
  return Array.isArray(entries) ? entries.filter((entry): entry is AdPauseEntry => typeof (entry as AdPauseEntry)?.adId === "string" && typeof (entry as AdPauseEntry)?.at === "string") : [];
}
const withoutIntent = (raw: unknown, adId: string) => adPauseIntents(raw).filter((intent) => intent.adId !== adId);

/** Re-reads `raw` (other writers may have changed it during the Meta round trip, #258's pattern) and saves the change. */
async function updateRaw(context: AuthorizedBusiness, campaignId: string, change: (raw: Record<string, Json | undefined>) => Record<string, Json | undefined>): Promise<boolean> {
  const database = createAdminClient() as unknown as SupabaseClient;
  const { data: fresh } = await database.from("campaigns").select("raw").eq("business_id", context.businessId).eq("id", campaignId).maybeSingle();
  const raw = fresh?.raw && typeof fresh.raw === "object" && !Array.isArray(fresh.raw) ? fresh.raw as Record<string, Json | undefined> : {};
  const { error } = await saveCampaign({ businessId: context.businessId, userId: context.userId }, { raw: change(raw) as unknown as Json }, campaignId)
    .catch(() => ({ error: new Error("Campaign storage unavailable.") }));
  return !error;
}

/**
 * #1045: pause one ad of a running campaign from the card, or undo that pause. Only the ad's status
 * changes in Meta. Undo is allowed only for an ad AdBrain paused here (the campaign row records it),
 * so this never turns on an ad the owner switched off themselves.
 */
export async function setAdDelivery(context: AuthorizedBusiness, campaignId: string, adId: string, action: AdPauseAction, reason?: string): Promise<AdPauseResult> {
  const supabase = await createClient();
  const { data: campaign } = await supabase.from("campaigns").select("*").eq("id", campaignId).eq("business_id", context.businessId).maybeSingle();
  if (!campaign) throw new CampaignEditError("Campaign not found", 404);
  if (String(campaign.status).toLowerCase() !== "active") throw new CampaignEditError("Only a running campaign's ads can be paused here.", 409);
  const review = reviewableCampaign(campaign);
  if (!review || !campaign.meta_campaign_id) throw new CampaignEditError("AdBrain can only change campaigns it launched.", 409);
  // The card's ads (#783's stored results, which include a capped run's copies) or the launched ones.
  const { data: listed } = await (supabase as unknown as SupabaseClient).from("ad_results").select("meta_ad_id").eq("campaign_id", campaignId).eq("meta_ad_id", adId).limit(1);
  const known = new Set([...(intendedCampaignChildren(campaign)?.adIds ?? []), ...(campaign.meta_ad_ids ?? []), ...((listed ?? []) as { meta_ad_id: string }[]).map((row) => row.meta_ad_id)]);
  if (!known.has(adId)) throw new CampaignEditError("This ad isn't part of the campaign.", 404);
  // #1146: a waiting new-audience copy has its own copy of this ad; switch or cancel it first.
  await refuseWhileSwitchPending(createAdminClient() as unknown as SupabaseClient, campaignId);
  const history = adPauses(campaign.raw);
  if (action === "undo" && history.filter((entry) => entry.adId === adId).at(-1)?.action !== "paused") {
    throw new CampaignEditError("AdBrain didn't pause this ad, so it won't turn it on. Use Meta if you want it back.", 409);
  }

  const status = action === "pause" ? "PAUSED" : "ACTIVE";
  const entryAction: AdPauseEntry["action"] = action === "pause" ? "paused" : "resumed";
  // #2395: a pause of AdBrain's whose answer from Meta was lost. If Meta did make it, the retry finds the ad
  // already so and records it, so Undo still works.
  const pending = adPauseIntents(campaign.raw).find((intent) => intent.adId === adId && intent.action === entryAction
    && Date.now() - Date.parse(intent.at) <= INTENT_TTL_MS);
  const intent: AdPauseEntry = { adId, action: entryAction, at: new Date().toISOString(), ...(reason ? { reason: reason.slice(0, 200) } : pending?.reason ? { reason: pending.reason } : {}) };
  // Best effort: a pause is never held back because the note about it couldn't be saved.
  await updateRaw(context, campaignId, (raw) => ({ ...raw, adPauseIntents: [...withoutIntent(raw, adId), intent].slice(-50) as unknown as Json }));
  const dropIntent = () => updateRaw(context, campaignId, (raw) => ({ ...raw, adPauseIntents: withoutIntent(raw, adId) as unknown as Json }));
  let result: AdPauseResult;
  try {
    result = await withMetaConnection(context, {
      purpose: action === "pause" ? "pause" : "activate",
      binding: { adAccountId: review.adAccountId, pageId: review.pageId },
      expectedGeneration: review.generation,
    }, async (meta) => {
      const read = await meta.setAdStatus(campaign.meta_campaign_id!, adId, status);
      return { adId: read.id, status: read.status, effectiveStatus: read.effectiveStatus, changed: read.changed };
    });
  } catch (error) {
    recordProductEvent({ kind: "workflow", name: `campaign.ad_${action}`, outcome: "failed", businessId: context.businessId, attributes: { errorCode: metaErrorCode(error) } });
    if (error instanceof MetaWriteUncertainError) throw new CampaignEditError(UNCONFIRMED, 502, false);
    await dropIntent();
    if (error instanceof CampaignEditError) throw error;
    throw new CampaignEditError(friendlyMetaError(error, "Meta didn't change the ad. Nothing changed."), 502, true);
  }
  if (result.status !== status) throw new CampaignEditError(UNCONFIRMED, 502, true);
  // Reviewer on #1048: an ad that already had this status wasn't changed by AdBrain, so nothing is recorded,
  // unless it is AdBrain's own unconfirmed change from a moment ago (#2395).
  if (!result.changed) {
    if (!pending) { await dropIntent(); return result; }
    result = { ...result, changed: true };
  }

  const entry: AdPauseEntry = { ...intent, at: new Date().toISOString() };
  const database = createAdminClient() as unknown as SupabaseClient;
  const saved = await updateRaw(context, campaignId, (raw) => ({ ...raw, adPauseIntents: withoutIntent(raw, adId) as unknown as Json, adPauses: [...adPauses(raw), entry].slice(-50) as unknown as Json }));
  if (!saved) throw new CampaignEditError("Meta changed the ad but AdBrain could not record it. Check the campaign before changing it again.", 502);
  await recordAdPause(database, { campaignId, entry });
  await logEvent({
    businessId: context.businessId, action: "campaign.edit", entityType: "campaign", entityId: campaignId, metaObjectId: campaign.meta_campaign_id,
    reason: action === "pause" ? `Paused one ad in "${campaign.name ?? campaignId}"` : `Turned an ad back on in "${campaign.name ?? campaignId}"`,
    details: { ad_id: adId, status, ...(reason ? { why: reason.slice(0, 200) } : {}) },
  });
  recordProductEvent({ kind: "workflow", name: `campaign.ad_${action}`, outcome: "success", businessId: context.businessId });
  return result;
}
