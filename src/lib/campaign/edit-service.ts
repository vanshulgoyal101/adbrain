import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { logEvent } from "@/lib/audit";
import { intendedCampaignChildren, reviewableCampaign } from "@/lib/campaign/activation";
import { saveCampaignChildren } from "@/lib/campaign/trusted-write";
import { CampaignDeliveryError, MetaError, friendlyMetaError, needsRebuild, type AudienceChanges, type AudienceEdit, type GeoTargeting } from "@/lib/meta/client";
import { ConnectionAccessError, withMetaConnection, type AuthorizedBusiness } from "@/lib/meta/connection-access";
import { mergeExclusions, TargetingExclusionsMissingError } from "@/lib/meta/service-area";
import { recordProductEvent } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Campaign, Json } from "@/lib/types";

/** #773: the shared path for editing a launched campaign. Audience now; Dev 4 adds budgets (#774) as another kind. */

export const RESTARTS_LEARNING = "This restarts Meta's learning; results may be slower for 2–3 days.";
export const PAUSE_FIRST = "Pause the campaign first; editing a running campaign comes next.";
export const RATE_LIMITED = "Meta needs 30 seconds between audience changes. Try again in a moment.";

const metaKey = z.string().regex(/^\d{1,20}$/);
const geoSchema = z.object({
  countries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(250).optional(),
  regions: z.array(z.object({ key: metaKey })).max(250).optional(),
  cities: z.array(z.object({ key: metaKey, radius: z.number().finite().min(1).max(80).optional(), distance_unit: z.enum(["kilometer", "mile"]).optional() })).max(250).optional(),
}).strict().refine(geo => Boolean(geo.countries?.length || geo.regions?.length || geo.cities?.length), "Pick at least one place.");

export const audienceChangeSchema = z.object({
  location: geoSchema.optional(),
  excludedLocation: geoSchema.optional(),
  age: z.object({ min: z.number().int().min(18).max(65), max: z.number().int().min(18).max(65) }).strict().refine(age => age.min <= age.max, "Minimum age is above maximum.").optional(),
  gender: z.enum(["all", "men", "women"]).optional(),
}).strict().refine(change => Boolean(change.location || change.excludedLocation || change.age || change.gender), "Change something about the audience.");
export type AudienceChange = z.infer<typeof audienceChangeSchema>;

export type AudienceEditResult = {
  adSets: Array<{ adSetId: string; previousAdSetId: string | null; mode: "patch" | "rebuild" }>;
  count: number;
  consequence: string | null;
};
export type AudienceEditPreview = { adSets: Array<{ adSetId: string; mode: "patch" | "rebuild"; validated: boolean }>; consequence: string | null };

export class CampaignEditError extends Error {
  constructor(message: string, readonly status: number, readonly retryable = false) {
    super(message);
    this.name = "CampaignEditError";
  }
}

type Row = { id: string; state: string; phase: string; transmitted: boolean; request_hash: string; result: Json | null; sanitized_error: string | null };
type Options = { preview?: boolean; idempotencyKey: string };

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

export const audienceChangeDigest = (change: AudienceChange) => sha256(JSON.stringify(canonical(change)));

/** Only the audience fields of an ad set's targeting, kept as the "before" of an edit. */
function audienceOf(targeting: unknown): Json {
  const value = (targeting && typeof targeting === "object" ? targeting : {}) as Record<string, Json | undefined>;
  const pick: Record<string, Json> = {};
  for (const key of ["geo_locations", "excluded_geo_locations", "age_min", "age_max", "age_range", "genders"]) if (value[key] !== undefined) pick[key] = value[key]!;
  return pick;
}

function describeChange(change: AudienceChange): string {
  const parts = [change.location && "area", change.age && "age", change.gender && "gender", change.excludedLocation && "excluded places"].filter(Boolean);
  return parts.join(", ");
}

/**
 * The ids the mirror keeps after the edits: a rebuilt ad set takes the new id in the same position, its
 * ads their copies, and a capped ad set stays capped under its new id.
 */
export function mirroredChildren(
  campaign: Pick<Campaign, "meta_campaign_id" | "meta_adset_id" | "meta_ad_ids" | "raw">,
  edits: Array<{ from: { adSetId: string; adIds: string[] }; to: AudienceEdit }>,
): Pick<Campaign, "meta_adset_id" | "meta_ad_ids" | "raw"> {
  const children = intendedCampaignChildren(campaign);
  if (!children) throw new Error("Stored campaign children are not valid.");
  const adSetMap = new Map<string, string>();
  const adMap = new Map<string, string>();
  for (const { from, to } of edits) {
    if (to.mode !== "rebuild") continue;
    adSetMap.set(from.adSetId, to.adSetId);
    from.adIds.forEach((adId, index) => adMap.set(adId, to.adIds[index]));
  }
  const adSet = (id: string) => adSetMap.get(id) ?? id;
  const ad = (id: string) => adMap.get(id) ?? id;
  const raw = campaign.raw && typeof campaign.raw === "object" && !Array.isArray(campaign.raw) ? campaign.raw as Record<string, Json | undefined> : {};
  const metaResult = { ...raw.metaResult as Record<string, Json>, adSetIds: children.adSetIds.map(adSet), adIds: children.adIds.map(ad) };
  const next: Record<string, Json | undefined> = { ...raw, metaResult };
  if (Array.isArray(raw.cappedAdSetIds)) next.cappedAdSetIds = (raw.cappedAdSetIds as string[]).map(adSet);
  const cap = raw.cap;
  if (cap && typeof cap === "object" && !Array.isArray(cap) && typeof cap.adSetId === "string") next.cap = { ...cap, adSetId: adSet(cap.adSetId) };
  const mirrored = { meta_adset_id: adSet(campaign.meta_adset_id ?? children.adSetIds[0]), meta_ad_ids: campaign.meta_ad_ids.map(ad), raw: next as Json };
  if (!intendedCampaignChildren({ meta_campaign_id: campaign.meta_campaign_id, ...mirrored })) throw new Error("The edited campaign children would not validate.");
  return mirrored;
}

export async function editCampaignAudience(
  context: AuthorizedBusiness,
  campaignId: string,
  change: AudienceChange,
  options: Options & { preview: true },
): Promise<AudienceEditPreview>;
export async function editCampaignAudience(
  context: AuthorizedBusiness,
  campaignId: string,
  change: AudienceChange,
  options: Options & { preview?: false },
): Promise<AudienceEditResult & { replay: boolean }>;
export async function editCampaignAudience(context: AuthorizedBusiness, campaignId: string, change: AudienceChange, options: Options) {
  const database = createAdminClient() as unknown as SupabaseClient;
  const { data: campaign } = await (await createClient()).from("campaigns").select("*").eq("id", campaignId).eq("business_id", context.businessId).maybeSingle();
  if (!campaign) throw new CampaignEditError("Campaign not found", 404);

  const requestHash = sha256(JSON.stringify(["audience", campaignId, audienceChangeDigest(change)]));
  let row: Row | null = null;
  if (!options.preview) {
    const { data, error } = await database.from("campaign_edit_operations").select("*")
      .eq("business_id", context.businessId).eq("campaign_id", campaignId).eq("idempotency_key", options.idempotencyKey).maybeSingle();
    if (error) throw new CampaignEditError("Campaign edits are unavailable. Try again.", 503, true);
    row = data as Row | null;
    if (row) {
      if (row.request_hash !== requestHash) throw new CampaignEditError("This idempotency key was used for a different change.", 409);
      if (row.state === "succeeded" && row.result) return { ...(row.result as unknown as AudienceEditResult), replay: true };
      if (row.state !== "failed" || row.transmitted) {
        throw new CampaignEditError(row.state === "failed" || row.state === "needs_reconciliation"
          ? "An earlier attempt may have partly changed Meta. Check the campaign in Meta before editing it again."
          : "This change is already in progress.", 409);
      }
    }
  }

  const status = String(campaign.status).toLowerCase();
  if (status === "active") throw new CampaignEditError(PAUSE_FIRST, 409);
  if (status !== "paused") throw new CampaignEditError("Only a paused campaign can be edited.", 409);
  const review = reviewableCampaign(campaign);
  if (!review) throw new CampaignEditError("AdBrain can only edit campaigns it launched.", 409);

  const touch = async (values: Record<string, unknown>) => {
    if (!row) return;
    const { error } = await database.from("campaign_edit_operations").update({ ...values, updated_at: new Date().toISOString() }).eq("id", row.id);
    if (error) throw new CampaignEditError("Campaign edit could not be recorded. Nothing was changed.", 503, true);
  };
  if (!options.preview) {
    const values = { state: "running", phase: "validate", transmitted: false, sanitized_error: null, change: change as unknown as Json };
    if (row) await touch(values);
    else {
      const { data, error } = await database.from("campaign_edit_operations").insert({
        business_id: context.businessId, campaign_id: campaignId, kind: "audience", idempotency_key: options.idempotencyKey, request_hash: requestHash, ...values,
      }).select("*").single();
      if (error || !data) throw new CampaignEditError(error?.code === "23505" ? "This change is already in progress." : "Campaign edits are unavailable. Try again.", error?.code === "23505" ? 409 : 503, error?.code !== "23505");
      row = data as Row;
    }
  }

  const done: Array<{ from: { adSetId: string; adIds: string[] }; to: AudienceEdit }> = [];
  let transmitted = false;
  const fail = async (state: "failed" | "needs_reconciliation", message: string) => {
    await touch({ state, transmitted, sanitized_error: message.slice(0, 500) }).catch(() => undefined);
  };
  try {
    const outcome = await withMetaConnection(context, {
      purpose: "create_paused",
      binding: { adAccountId: review.adAccountId, pageId: review.pageId },
      expectedGeneration: review.generation,
    }, async meta => {
      // The tree comes from Meta, not the mirror; a campaign whose children changed is refused here.
      const tree = await meta.readCampaignDelivery(review.metaCampaignId, {
        dailyBudgetRupees: review.dailyBudgetRupees, status: "paused", adSetIds: review.children.adSetIds, adIds: review.children.adIds, cappedAdSetIds: review.children.cappedAdSetIds,
      });
      if (tree.adSets.some(adSet => adSet.status !== "PAUSED")) throw new CampaignEditError(PAUSE_FIRST, 409);
      const targets = tree.adSets.map(adSet => ({
        adSetId: adSet.id, adIds: tree.ads.filter(ad => ad.adSetId === adSet.id).map(ad => ad.id),
        mode: needsRebuild({ targeting: adSet.targeting, destination_type: adSet.destinationType }) ? "rebuild" as const : "patch" as const, targeting: adSet.targeting,
      }));
      if (targets.some(target => !target.adIds.length)) throw new CampaignDeliveryError("An ad set has no ads. Reconcile the campaign in Meta first.");

      // Exclusions only grow: the new area's #741 exclusions are added to the owner's own and the ad set's existing ones.
      const changes: AudienceChanges = { ...change.age ? { age: change.age } : {}, ...change.gender ? { gender: change.gender } : {} };
      if (change.location) {
        const area = await meta.serviceAreaExclusionsFor(change.location as GeoTargeting);
        changes.location = change.location as GeoTargeting;
        changes.excludedLocation = mergeExclusions(change.excludedLocation as GeoTargeting | undefined, area) ?? {};
      } else if (change.excludedLocation) changes.excludedLocation = change.excludedLocation as GeoTargeting;

      const validated = new Map<string, boolean>();
      for (const target of targets.filter(item => item.mode === "rebuild")) {
        await meta.editAdSetTargeting(review.metaCampaignId, { adSetId: target.adSetId, adIds: target.adIds, changes }, { validateOnly: true });
        validated.set(target.adSetId, true);
      }
      const consequence = targets.some(target => target.mode === "rebuild") ? RESTARTS_LEARNING : null;
      if (options.preview) return { preview: { adSets: targets.map(target => ({ adSetId: target.adSetId, mode: target.mode, validated: validated.has(target.adSetId) })), consequence } };

      await touch({ phase: "edit", transmitted: true, before: { adSets: targets.map(target => ({ id: target.adSetId, mode: target.mode, audience: audienceOf(target.targeting) })) } as unknown as Json });
      transmitted = true;
      let failure: unknown = null;
      for (const target of targets) {
        try {
          done.push({ from: { adSetId: target.adSetId, adIds: target.adIds }, to: await meta.editAdSetTargeting(review.metaCampaignId, { adSetId: target.adSetId, adIds: target.adIds, changes }) });
        } catch (error) {
          failure = error;
          // Meta refused the very first in-place patch for its 30 s limit: nothing was written.
          if (!done.length && target.mode === "patch" && error instanceof MetaError && error.code === 613) transmitted = false;
          break;
        }
      }
      return { consequence, failure };
    });

    if ("preview" in outcome) return outcome.preview;
    const { consequence, failure } = outcome;

    if (done.length) {
      // Mirror only what Meta confirmed, even when a later ad set failed, so the stored ids stay honest.
      await touch({ phase: "mirror" });
      try {
        const { error } = await saveCampaignChildren({ businessId: context.businessId, userId: context.userId }, campaignId, current => mirroredChildren(current, done));
        if (error) throw error;
      } catch {
        await fail("needs_reconciliation", "Meta changed the audience but AdBrain could not record it. Check the campaign.");
        recordProductEvent({ kind: "workflow", name: "campaign.edit", outcome: "failed", businessId: context.businessId, attributes: { entityType: "campaign", count: done.length, errorCode: "EDIT_MIRROR_FAILED" } });
        throw new CampaignEditError("Meta changed the audience but AdBrain could not record it. Check the campaign before editing again.", 502);
      }
    }
    if (failure) throw failure;

    const result: AudienceEditResult = {
      adSets: done.map(({ from, to }) => ({ adSetId: to.adSetId, previousAdSetId: to.retiredAdSetId ?? (to.adSetId === from.adSetId ? null : from.adSetId), mode: to.mode })),
      count: done.length, consequence,
    };
    await touch({ state: "succeeded", phase: "complete", result: result as unknown as Json });
    await logEvent({
      businessId: context.businessId, action: "campaign.edit", entityType: "campaign", entityId: campaignId, metaObjectId: campaign.meta_campaign_id,
      reason: `Changed the audience of "${campaign.name ?? campaignId}" (${describeChange(change)})`,
      details: { ad_sets: result.adSets.map(adSet => ({ id: adSet.adSetId, mode: adSet.mode })) },
    });
    return { ...result, replay: false };
  } catch (error) {
    if (options.preview) throw toEditError(error);
    const mapped = toEditError(error);
    if (!(error instanceof CampaignEditError && error.status === 502)) {
      await fail(transmitted ? "needs_reconciliation" : "failed", mapped.message);
      recordProductEvent({ kind: "workflow", name: "campaign.edit", outcome: done.length ? "partial" : "failed", businessId: context.businessId,
        attributes: { entityType: "campaign", count: done.length, ...error instanceof MetaError && error.code ? { metaCode: error.code } : {} } });
    }
    throw mapped;
  }
}

function toEditError(error: unknown): CampaignEditError {
  if (error instanceof CampaignEditError) return error;
  if (error instanceof MetaError && error.code === 613) return new CampaignEditError(RATE_LIMITED, 429, true);
  if (error instanceof CampaignDeliveryError) return new CampaignEditError(error.message, 409);
  if (error instanceof TargetingExclusionsMissingError) return new CampaignEditError(error.message, 409, true);
  if (error instanceof ConnectionAccessError) return new CampaignEditError(error.message, error.code === "UNAUTHENTICATED" ? 401 : error.code === "CONFLICT" ? 409 : 400);
  if (error instanceof MetaError) return new CampaignEditError(friendlyMetaError(error), error.status && error.status >= 500 ? 502 : 400);
  console.error("[campaign.edit]", error);
  return new CampaignEditError("Could not change the audience.", 500);
}
