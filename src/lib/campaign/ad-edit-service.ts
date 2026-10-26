import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { logEvent } from "@/lib/audit";
import { intendedCampaignChildren, reviewableCampaign } from "@/lib/campaign/activation";
import { saveCampaign } from "@/lib/campaign/trusted-write";
import { copyClaimWarnings } from "@/lib/creative/concept";
import { MetaError, friendlyMetaError, type AdCopyEdit } from "@/lib/meta/client";
import { ConnectionAccessError, withMetaConnection, type AuthorizedBusiness } from "@/lib/meta/connection-access";
import { recordProductEvent } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/types";
import { CampaignEditError } from "./edit-service";

/**
 * #775: edit a launched ad's words. Meta gets a new creative made from the stored one and the ad
 * points at it (the old creative stays for rollback), inside the same `campaign_edit_operations`
 * envelope as audience and budget edits (kind `ad_creative`), so one reader reconciles every edit.
 */

export { BACK_TO_REVIEW } from "./ad-edit-copy";
import { BACK_TO_REVIEW } from "./ad-edit-copy";
export const AD_RATE_LIMITED = "Meta needs 30 seconds between ad changes. Try again in a moment.";

const words = (max: number) => z.string().trim().min(1).max(max);
export const adCopyEditSchema = z.object({
  headline: words(255).optional(),
  message: words(2000).optional(),
  description: words(255).optional(),
}).strict().refine((edit) => Boolean(edit.headline || edit.message || edit.description), "Change at least one part of the ad.");
export type AdCopyChange = z.infer<typeof adCopyEditSchema>;

export type AdEditResult = { adId: string; previousCreativeId: string; creativeId: string; consequence: string };

type Row = { id: string; state: string; transmitted: boolean; request_hash: string; result: Json | null };
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export async function editAdCopy(
  context: AuthorizedBusiness,
  campaignId: string,
  adId: string,
  change: AdCopyChange,
  options: { idempotencyKey: string },
): Promise<AdEditResult & { replay: boolean }> {
  const database = createAdminClient() as unknown as SupabaseClient;
  const supabase = await createClient();
  const { data: campaign } = await supabase.from("campaigns").select("*").eq("id", campaignId).eq("business_id", context.businessId).maybeSingle();
  if (!campaign) throw new CampaignEditError("Campaign not found", 404);

  const requestHash = sha256(JSON.stringify(["ad_creative", campaignId, adId, change.headline ?? null, change.message ?? null, change.description ?? null]));
  const { data: existing, error: readError } = await database.from("campaign_edit_operations").select("*")
    .eq("business_id", context.businessId).eq("campaign_id", campaignId).eq("idempotency_key", options.idempotencyKey).maybeSingle();
  if (readError) throw new CampaignEditError("Campaign edits are unavailable. Try again.", 503, true);
  let row = existing as Row | null;
  if (row) {
    if (row.request_hash !== requestHash) throw new CampaignEditError("This idempotency key was used for a different change.", 409);
    if (row.state === "succeeded" && row.result) return { ...(row.result as unknown as AdEditResult), replay: true };
    if (row.state !== "failed" || row.transmitted) {
      throw new CampaignEditError(row.state === "failed" || row.state === "needs_reconciliation"
        ? "An earlier attempt may have changed this ad in Meta. Check the ad before editing it again."
        : "This change is already in progress.", 409);
    }
  }

  const status = String(campaign.status).toLowerCase();
  if (status !== "paused" && status !== "active") throw new CampaignEditError("Only a paused or running campaign's ads can be edited.", 409);
  const review = reviewableCampaign(campaign);
  const children = intendedCampaignChildren(campaign);
  if (!review || !children) throw new CampaignEditError("AdBrain can only edit campaigns it launched.", 409);
  if (!children.adIds.includes(adId)) throw new CampaignEditError("This ad isn't part of the campaign.", 404);

  // Same claim checks as the owner's own copy in Studio (#280, #738), but here they block.
  const { data: business } = await supabase.from("businesses").select("offers, usps, description, vertical").eq("id", context.businessId).maybeSingle();
  const facts = [...(business?.offers ?? []), ...(business?.usps ?? []), business?.description];
  const warning = copyClaimWarnings({ headline: change.headline ?? "", primary_text: change.message ?? "", description: change.description ?? "" }, facts, business?.vertical)[0];
  if (warning) throw new CampaignEditError(warning, 422);

  const touch = async (values: Record<string, unknown>) => {
    if (!row) return;
    const { error } = await database.from("campaign_edit_operations").update({ ...values, updated_at: new Date().toISOString() }).eq("id", row.id);
    if (error) throw new CampaignEditError("Ad edit could not be recorded. Nothing was changed.", 503, true);
  };
  const start = { state: "running", phase: "validate", transmitted: false, sanitized_error: null, change: change as unknown as Json };
  if (row) await touch(start);
  else {
    const { data, error } = await database.from("campaign_edit_operations").insert({
      business_id: context.businessId, campaign_id: campaignId, kind: "ad_creative", idempotency_key: options.idempotencyKey, request_hash: requestHash, ...start,
    }).select("*").single();
    if (error || !data) throw new CampaignEditError(error?.code === "23505" ? "This change is already in progress." : "Campaign edits are unavailable. Try again.", error?.code === "23505" ? 409 : 503, error?.code !== "23505");
    row = data as Row;
  }

  let transmitted = false;
  let createdCreativeId: string | null = null;
  try {
    const edit: AdCopyEdit = change;
    const swapped = await withMetaConnection(context, {
      purpose: "create_paused",
      binding: { adAccountId: review.adAccountId, pageId: review.pageId },
      expectedGeneration: review.generation,
    }, (meta) => meta.replaceAdCreative(adId, edit, {
      beforeWrite: async ({ previousCreativeId }) => {
        await touch({ phase: "edit", transmitted: true, before: { ad_id: adId, previous_creative_id: previousCreativeId } });
        transmitted = true;
      },
      onCreative: async (creativeId) => { createdCreativeId = creativeId; await touch({ result: { new_creative_id: creativeId } }); },
    }));

    await touch({ phase: "mirror" });
    // Re-read `raw` now: other writers (activation, audience/budget edits, the refresh cron) may have
    // changed it during the Meta round trips, and saveCampaign replaces it whole (#258's pattern).
    const mirror = async () => {
      const { data: fresh, error: readError } = await database.from("campaigns").select("raw").eq("business_id", context.businessId).eq("id", campaignId).maybeSingle();
      if (readError || !fresh) return { error: readError ?? new Error("Campaign not found.") };
      const raw = fresh.raw && typeof fresh.raw === "object" && !Array.isArray(fresh.raw) ? fresh.raw as Record<string, Json | undefined> : {};
      const adCreatives = { ...(raw.adCreatives && typeof raw.adCreatives === "object" && !Array.isArray(raw.adCreatives) ? raw.adCreatives as Record<string, Json> : {}), [adId]: swapped.creativeId };
      return saveCampaign({ businessId: context.businessId, userId: context.userId }, { raw: { ...raw, adCreatives } as Json }, campaignId);
    };
    const { error: mirrorError } = await mirror().catch(() => ({ error: new Error("Campaign storage unavailable.") }));
    if (mirrorError) {
      await touch({ state: "needs_reconciliation", sanitized_error: "Meta changed the ad but AdBrain could not record it." }).catch(() => undefined);
      throw new CampaignEditError("Meta changed the ad but AdBrain could not record it. Check the campaign before editing again.", 502);
    }
    const result: AdEditResult = { ...swapped, consequence: BACK_TO_REVIEW };
    await touch({ state: "succeeded", phase: "complete", result: { ...result, new_creative_id: swapped.creativeId } as unknown as Json });
    await logEvent({
      businessId: context.businessId, action: "campaign.edit", entityType: "campaign", entityId: campaignId, metaObjectId: campaign.meta_campaign_id,
      reason: `Changed the words on an ad in "${campaign.name ?? campaignId}"`,
      details: { ad_id: adId, previous_creative_id: swapped.previousCreativeId, creative_id: swapped.creativeId, fields: Object.keys(change) },
    });
    return { ...result, replay: false };
  } catch (error) {
    if (error instanceof CampaignEditError && error.status === 502) throw error;
    // Meta's 30 s limit on the first write means nothing changed.
    if (error instanceof MetaError && error.code === 613 && !createdCreativeId) transmitted = false;
    const mapped = error instanceof CampaignEditError ? error
      : error instanceof ConnectionAccessError ? new CampaignEditError(error.message, error.code === "CONFLICT" ? 409 : 400)
      : error instanceof MetaError && error.code === 613 ? new CampaignEditError(AD_RATE_LIMITED, 429, !transmitted)
      : new CampaignEditError(friendlyMetaError(error, "Meta didn't accept the new words."), error instanceof MetaError && error.status && error.status < 500 ? 422 : 502, !transmitted);
    await touch({ state: transmitted ? "needs_reconciliation" : "failed", transmitted, sanitized_error: mapped.message.slice(0, 500) }).catch(() => undefined);
    recordProductEvent({ kind: "workflow", name: "campaign.edit", outcome: "failed", businessId: context.businessId,
      attributes: { entityType: "campaign", ...error instanceof MetaError && error.code ? { metaCode: error.code } : {} } });
    throw mapped;
  }
}
