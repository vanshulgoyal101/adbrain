import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { logEvent } from "@/lib/audit";
import { intendedCampaignChildren, reviewableCampaign } from "@/lib/campaign/activation";
import { pausedAdIds } from "@/lib/campaign/ad-pause";
import { saveCampaignChildren } from "@/lib/campaign/trusted-write";
import { AdSetSwitchStuckError, CampaignDeliveryError, MetaError, friendlyMetaError, needsRebuild, type AudienceChanges, type AudienceEdit, type GeoTargeting } from "@/lib/meta/client";
import { ConnectionAccessError, withMetaConnection, type AuthorizedBusiness } from "@/lib/meta/connection-access";
import { mergeExclusions, TargetingExclusionsMissingError } from "@/lib/meta/service-area";
import { AD_LANGUAGE_KEYS } from "@/lib/meta/locales";
import { recordProductEvent } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Campaign, Json } from "@/lib/types";
import { OWNER_ERRORS } from "@/lib/copy/owner-words";

/** #773: the shared path for editing a launched campaign. Audience now; Dev 4 adds budgets (#774) as another kind. */

const RESTARTS_LEARNING = "This restarts Meta's learning; results may be slower for 2–3 days.";
const PAUSE_FIRST = "Part of this campaign is still running in Meta. Pause the campaign, then edit the audience.";
/** #765: Meta refuses an in-place audience change on these ad sets; the owner confirms a PAUSED copy instead (CPO's words). */
const RUNNING_NEEDS_COPY = "Meta doesn't allow this change on a running campaign. We'll make a fresh copy with your change (paused, back to review, learning restarts) and stop the old one when you turn the new one on.";
const SWITCH_PENDING = "A new audience is waiting for this campaign. Turn it on or cancel it first.";
const NO_AREA_EXCLUSIONS = "This campaign covers a whole country, so there are no out-of-area places to leave out.";
const ALREADY_EXCLUDED = "Every ad set already leaves out the places outside its area. Nothing to change.";
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
  languages: z.array(z.number().int().refine(key => AD_LANGUAGE_KEYS.has(key), "Pick a listed language."))
    .max(AD_LANGUAGE_KEYS.size).refine(keys => new Set(keys).size === keys.length, "Each language once.").optional(),
  /** Add #741's out-of-area exclusions for each ad set's current area (campaigns built before the rule). */
  areaExclusions: z.literal(true).optional(),
}).strict()
  .refine(change => !(change.areaExclusions && change.location), "A new area already brings its own exclusions.")
  .refine(change => Boolean(change.location || change.excludedLocation || change.age || change.gender || change.languages || change.areaExclusions), "Change something about the audience.");
export type AudienceChange = z.infer<typeof audienceChangeSchema>;

/** #765 (b): a running ad set's PAUSED copy, waiting for the owner to switch to it or cancel it. */
export type PendingCopy = { from: { adSetId: string; adIds: string[] }; to: { adSetId: string; adIds: string[] } };
export type AudienceEditResult = {
  adSets: Array<{ adSetId: string; previousAdSetId: string | null; mode: "patch" | "rebuild" | "copy" }>;
  count: number;
  consequence: string | null;
  /** Set when copies wait for the owner: switch or cancel with this operation id. */
  awaitingSwitch?: { operationId: string; pending: PendingCopy[] };
};
export type AudienceEditPreview = { adSets: Array<{ adSetId: string; mode: "patch" | "rebuild" | "copy"; validated: boolean }>; consequence: string | null };

export class CampaignEditError extends Error {
  constructor(message: string, readonly status: number, readonly retryable = false, readonly code?: "needs_copy" | "switch_pending") {
    super(message);
    this.name = "CampaignEditError";
  }
}

type Row = { id: string; state: string; phase: string; transmitted: boolean; request_hash: string; result: Json | null; sanitized_error: string | null };
/** `copy`: the owner confirmed a PAUSED copy for running ad sets Meta can't change in place (#765 b). */
type Options = { preview?: boolean; idempotencyKey: string; copy?: boolean };

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

const audienceChangeDigest = (change: AudienceChange) => sha256(JSON.stringify(canonical(change)));

/** Only the audience fields of an ad set's targeting, kept as the "before" of an edit. */
function audienceOf(targeting: unknown): Json {
  const value = (targeting && typeof targeting === "object" ? targeting : {}) as Record<string, Json | undefined>;
  const pick: Record<string, Json> = {};
  for (const key of ["geo_locations", "excluded_geo_locations", "age_min", "age_max", "age_range", "genders", "locales"]) if (value[key] !== undefined) pick[key] = value[key]!;
  return pick;
}

/** The area an ad set targets now, in the shape the #741 builder reads (Meta adds names and regions on read). */
function currentArea(targeting: unknown): GeoTargeting | undefined {
  const geo = (targeting && typeof targeting === "object" ? (targeting as { geo_locations?: unknown }).geo_locations : undefined) as {
    countries?: string[]; regions?: Array<{ key: string }>; cities?: Array<{ key: string; radius?: number; distance_unit?: "kilometer" | "mile" }>;
  } | undefined;
  if (!geo) return undefined;
  return {
    ...geo.countries?.length ? { countries: geo.countries } : {},
    ...geo.regions?.length ? { regions: geo.regions.map(region => ({ key: String(region.key) })) } : {},
    ...geo.cities?.length ? { cities: geo.cities.map(city => ({ key: String(city.key), ...city.radius !== undefined ? { radius: city.radius, distance_unit: city.distance_unit ?? "kilometer" } : {} })) } : {},
  };
}

/** True when the ad set's own exclusions already hold every region and city of `area`. */
function excludesAll(targeting: unknown, area: GeoTargeting): boolean {
  const excluded = (targeting && typeof targeting === "object" ? (targeting as { excluded_geo_locations?: unknown }).excluded_geo_locations : undefined) as {
    regions?: Array<{ key: string | number }>; cities?: Array<{ key: string | number }>;
  } | undefined;
  const has = (list: Array<{ key: string | number }> | undefined) => new Set((list ?? []).map(item => String(item.key)));
  const regions = has(excluded?.regions), cities = has(excluded?.cities);
  return (area.regions ?? []).every(region => regions.has(String(region.key))) && (area.cities ?? []).every(city => cities.has(String(city.key)));
}

function describeChange(change: AudienceChange): string {
  const parts = [change.location && "area", change.age && "age", change.gender && "gender", change.languages && "language", change.excludedLocation && "excluded places", change.areaExclusions && "out-of-area exclusions"].filter(Boolean);
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
  // #1146: an ad paused from the card stays paused under its copy's id, so Resume (#1055) and the card's Undo keep track.
  const carried = pausedAdIds(raw).flatMap(adId => adMap.has(adId) ? [{ adId: adMap.get(adId)!, action: "paused" as const, at: new Date().toISOString(), reason: "Kept paused on the new audience" }] : []);
  if (carried.length) next.adPauses = [...(Array.isArray(raw.adPauses) ? raw.adPauses : []), ...carried].slice(-50) as Json;
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
  if (!campaign) throw new CampaignEditError(OWNER_ERRORS.campaignNotFound, 404);

  const requestHash = sha256(JSON.stringify(["audience", campaignId, audienceChangeDigest(change)]));
  let row: Row | null = null;
  if (!options.preview) {
    const { data, error } = await database.from("campaign_edit_operations").select("*")
      .eq("business_id", context.businessId).eq("campaign_id", campaignId).eq("idempotency_key", options.idempotencyKey).maybeSingle();
    if (error) throw new CampaignEditError("Campaign edits are unavailable. Try again.", 503, true);
    row = data as Row | null;
    if (row) {
      if (row.request_hash !== requestHash) throw new CampaignEditError("This idempotency key was used for a different change.", 409);
      if ((row.state === "succeeded" || row.state === "awaiting_switch") && row.result) return { ...(row.result as unknown as AudienceEditResult), replay: true };
      if (row.state !== "failed" || row.transmitted) {
        throw new CampaignEditError(row.state === "failed" || row.state === "needs_reconciliation"
          ? "An earlier attempt may have partly changed Meta. Check the campaign in Meta before editing it again."
          : "This change is already in progress.", 409);
      }
    }
  }

  const status = String(campaign.status).toLowerCase();
  if (status !== "paused" && status !== "active") throw new CampaignEditError("Only a paused or running campaign can be edited.", 409);
  const review = reviewableCampaign(campaign);
  if (!review) throw new CampaignEditError("AdBrain can only edit campaigns it launched.", 409);
  await refuseWhileSwitchPending(database, campaignId);

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
  const built: PendingCopy[] = [];
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
        dailyBudgetRupees: review.dailyBudgetRupees, status, adSetIds: review.children.adSetIds, adIds: review.children.adIds, cappedAdSetIds: review.children.cappedAdSetIds,
      });
      // A paused campaign's whole tree is paused (pauseCampaignTree); a running one may keep paused siblings (a capped run).
      if (status === "paused" && tree.adSets.some(adSet => adSet.status !== "PAUSED")) throw new CampaignEditError(PAUSE_FIRST, 409);
      const treeTargets = tree.adSets.map(adSet => ({
        adSetId: adSet.id, adIds: tree.ads.filter(ad => ad.adSetId === adSet.id).map(ad => ad.id), running: adSet.status === "ACTIVE",
        mode: needsRebuild({ targeting: adSet.targeting, destination_type: adSet.destinationType }) ? "rebuild" as const : "patch" as const, targeting: adSet.targeting,
      }));
      if (treeTargets.some(target => !target.adIds.length)) throw new CampaignDeliveryError("Part of this campaign has no ads left on Meta, so it can't be changed here. Open it in Meta Ads Manager to fix it.");

      // Exclusions only grow: the new area's #741 exclusions are added to the owner's own and the ad set's existing ones.
      const changes: AudienceChanges = { ...change.age ? { age: change.age } : {}, ...change.gender ? { gender: change.gender } : {}, ...change.languages ? { languages: change.languages } : {} };
      if (change.location) {
        const area = await meta.serviceAreaExclusionsFor(change.location as GeoTargeting);
        changes.location = change.location as GeoTargeting;
        changes.excludedLocation = mergeExclusions(change.excludedLocation as GeoTargeting | undefined, area) ?? {};
      } else if (change.excludedLocation) changes.excludedLocation = change.excludedLocation as GeoTargeting;
      // #746: each ad set gets the exclusions of its own current area, as launch would have built them.
      // An ad set that already has them is left alone: rebuilding it would send its ads back to review for nothing.
      const onlyAreaExclusions = change.areaExclusions && !change.age && !change.gender && !change.languages && !change.excludedLocation;
      const changesFor = new Map<string, AudienceChanges>();
      for (const target of treeTargets) {
        if (!change.areaExclusions) { changesFor.set(target.adSetId, changes); continue; }
        const area = await meta.serviceAreaExclusionsFor(currentArea(target.targeting));
        if (!area) throw new CampaignEditError(NO_AREA_EXCLUSIONS, 409);
        if (onlyAreaExclusions && excludesAll(target.targeting, area)) continue;
        changesFor.set(target.adSetId, { ...changes, excludedLocation: mergeExclusions(changes.excludedLocation, area) });
      }
      const targets = treeTargets.filter(target => changesFor.has(target.adSetId));
      if (!targets.length) throw new CampaignEditError(ALREADY_EXCLUDED, 409);
      // #765 (b): Meta can't change a running WhatsApp or interest-based ad set in place. With the owner's OK it gets
      // a PAUSED copy and keeps running until the owner switches; without it, nothing is written.
      const copies = (target: (typeof targets)[number]) => target.running && target.mode === "rebuild";
      if (!options.preview && !options.copy && targets.some(copies)) throw new CampaignEditError(RUNNING_NEEDS_COPY, 409, false, "needs_copy");
      const changesOf = (adSetId: string) => changesFor.get(adSetId)!;

      const validated = new Map<string, boolean>();
      for (const target of targets.filter(item => item.mode === "rebuild")) {
        await meta.editAdSetTargeting(review.metaCampaignId, { adSetId: target.adSetId, adIds: target.adIds, changes: changesOf(target.adSetId) }, { validateOnly: true, copyOnly: copies(target) });
        validated.set(target.adSetId, true);
      }
      const consequence = targets.some(target => target.mode === "rebuild" || target.running) ? RESTARTS_LEARNING : null;
      if (options.preview) return { preview: { adSets: targets.map(target => ({ adSetId: target.adSetId, mode: copies(target) ? "copy" as const : target.mode, validated: validated.has(target.adSetId) })), consequence } };

      await touch({ phase: "edit", transmitted: true, before: { adSets: targets.map(target => ({ id: target.adSetId, mode: target.mode, audience: audienceOf(target.targeting) })) } as unknown as Json });
      transmitted = true;
      let failure: unknown = null;
      for (const target of targets) {
        try {
          const to = await meta.editAdSetTargeting(review.metaCampaignId, { adSetId: target.adSetId, adIds: target.adIds, changes: changesOf(target.adSetId) }, { copyOnly: copies(target) });
          if (copies(target)) built.push({ from: { adSetId: target.adSetId, adIds: target.adIds }, to: { adSetId: to.adSetId, adIds: to.adIds } });
          else done.push({ from: { adSetId: target.adSetId, adIds: target.adIds }, to });
        } catch (error) {
          failure = error;
          // Meta refused the very first in-place patch for its 30 s limit: nothing was written.
          if (!done.length && target.mode === "patch" && error instanceof MetaError && error.code === 613) transmitted = false;
          break;
        }
      }
      // A copy is only useful with the rest of the change: on a failure, the copies built so far are deleted.
      if (failure) for (const copy of built.splice(0)) await meta.deleteAdSetCopy(review.metaCampaignId, copy.to.adSetId).catch(() => undefined);
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
      adSets: [
        ...done.map(({ from, to }) => ({ adSetId: to.adSetId, previousAdSetId: to.retiredAdSetId ?? (to.adSetId === from.adSetId ? null : from.adSetId), mode: to.mode })),
        ...built.map(({ from, to }) => ({ adSetId: to.adSetId, previousAdSetId: from.adSetId, mode: "copy" as const })),
      ],
      count: done.length + built.length, consequence,
      ...built.length ? { awaitingSwitch: { operationId: row!.id, pending: built } } : {},
    };
    if (built.length) {
      // The partial unique index keeps one waiting copy per campaign; losing that race deletes this one.
      const { error } = await database.from("campaign_edit_operations")
        .update({ state: "awaiting_switch", phase: "copy", result: result as unknown as Json, updated_at: new Date().toISOString() }).eq("id", row!.id);
      if (error) {
        await removeCopies(context, review, built);
        await fail("failed", SWITCH_PENDING);
        throw new CampaignEditError(error.code === "23505" ? SWITCH_PENDING : "Campaign edit could not be recorded. The copy was removed.", 409, error.code !== "23505", error.code === "23505" ? "switch_pending" : undefined);
      }
    } else await touch({ state: "succeeded", phase: "complete", result: result as unknown as Json });
    await logEvent({
      businessId: context.businessId, action: "campaign.edit", entityType: "campaign", entityId: campaignId, metaObjectId: campaign.meta_campaign_id,
      reason: built.length
        ? `Made a paused copy of "${campaign.name ?? campaignId}" with a new audience (${describeChange(change)}), waiting to be turned on`
        : `Changed the audience of "${campaign.name ?? campaignId}" (${describeChange(change)})`,
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

type Review = NonNullable<ReturnType<typeof reviewableCampaign>>;

/** #1146: the copies of ads the owner paused from the card, which stay paused on the new audience (copies keep the ads' order). */
export function keptPausedCopies(copy: PendingCopy, raw: unknown): string[] {
  const paused = new Set(pausedAdIds(raw));
  return copy.from.adIds.flatMap((adId, index) => paused.has(adId) && copy.to.adIds[index] ? [copy.to.adIds[index]] : []);
}

/** #765 (b): while a copy waits, the Meta tree has an extra ad set; other edits wait until it is switched or cancelled. */
export async function refuseWhileSwitchPending(database: Pick<SupabaseClient, "from">, campaignId: string) {
  const { data, error } = await database.from("campaign_edit_operations").select("id").eq("campaign_id", campaignId).eq("state", "awaiting_switch").limit(1);
  if (error) throw new CampaignEditError("Campaign edits are unavailable. Try again.", 503, true);
  if (data?.length) throw new CampaignEditError(SWITCH_PENDING, 409, false, "switch_pending");
}

/** Deletes waiting copies (only the copies; the running ad sets are never written). */
async function removeCopies(context: AuthorizedBusiness, review: Review, copies: PendingCopy[]) {
  await withMetaConnection(context, { purpose: "delete", binding: { adAccountId: review.adAccountId, pageId: review.pageId }, expectedGeneration: review.generation }, async meta => {
    for (const copy of copies) await meta.deleteAdSetCopy(review.metaCampaignId, copy.to.adSetId);
  });
}

export type AudienceSwitchResult = { action: "switch" | "cancel"; adSets: Array<{ adSetId: string; previousAdSetId: string }>; replay: boolean };

/** A switch or cancel holds the row this long; one cut off (route timeout) can be retried after it. */
const SWITCH_LEASE_MS = 120_000;
const SWITCH_IN_PROGRESS = "This new audience is already being switched. Try again in a minute.";

/**
 * #765 (b): the owner turns a waiting copy on (the old ad set is paused first and then retired; the mirror moves to
 * the copy) or cancels it (only the copy is deleted). One request at a time holds the row (compare-and-set with a
 * lease). Any Meta failure leaves the row waiting with its last error, so the card keeps a retry: switchAdSet
 * finishes a switch Meta already made and carries on one that was cut off.
 */
export async function switchCampaignAudience(context: AuthorizedBusiness, campaignId: string, operationId: string, action: "switch" | "cancel"): Promise<AudienceSwitchResult> {
  const database = createAdminClient() as unknown as SupabaseClient;
  const { data: campaign } = await (await createClient()).from("campaigns").select("*").eq("id", campaignId).eq("business_id", context.businessId).maybeSingle();
  if (!campaign) throw new CampaignEditError(OWNER_ERRORS.campaignNotFound, 404);
  const { data, error } = await database.from("campaign_edit_operations").select("*")
    .eq("id", operationId).eq("business_id", context.businessId).eq("campaign_id", campaignId).eq("kind", "audience").maybeSingle();
  if (error) throw new CampaignEditError("Campaign edits are unavailable. Try again.", 503, true);
  const row = data as (Row & { id: string; updated_at?: string }) | null;
  if (!row) throw new CampaignEditError("This new audience was not found.", 404);
  const stored = row.result as unknown as (AudienceEditResult & { switch?: AudienceSwitchResult }) | null;
  const finished = action === "switch" ? "succeeded" : "cancelled";
  if (row.state === finished && stored?.switch) return { ...stored.switch, replay: true };
  if (row.state !== "awaiting_switch" || !stored?.awaitingSwitch?.pending.length) throw new CampaignEditError("This new audience is no longer waiting.", 409);
  const pending = stored.awaitingSwitch.pending;
  const status = String(campaign.status).toLowerCase();
  if (status !== "paused" && status !== "active") throw new CampaignEditError("Only a paused or running campaign can be switched.", 409);
  const review = reviewableCampaign(campaign);
  if (!review) throw new CampaignEditError("AdBrain can only edit campaigns it launched.", 409);

  // Hold the row: only from "copy" (waiting), or from a "switch" whose holder was cut off past the lease.
  const stale = row.phase === "switch" && Date.parse(row.updated_at ?? "") < Date.now() - SWITCH_LEASE_MS;
  if (row.phase !== "copy" && !stale) throw new CampaignEditError(SWITCH_IN_PROGRESS, 409, true);
  let claim = database.from("campaign_edit_operations").update({ phase: "switch", sanitized_error: null, updated_at: new Date().toISOString() })
    .eq("id", row.id).eq("state", "awaiting_switch").eq("phase", row.phase);
  if (row.updated_at) claim = claim.eq("updated_at", row.updated_at);
  const claimed = await claim.select("id");
  if (claimed.error) throw new CampaignEditError("Campaign edits are unavailable. Try again.", 503, true);
  if (claimed.data?.length !== 1) throw new CampaignEditError(SWITCH_IN_PROGRESS, 409, true);
  const touch = async (values: Record<string, unknown>) => {
    const { error: updateError } = await database.from("campaign_edit_operations").update({ ...values, updated_at: new Date().toISOString() }).eq("id", row.id);
    if (updateError) throw new CampaignEditError("Campaign edit could not be recorded.", 503, true);
  };
  /** Back to waiting with the reason, so the card shows it with a retry and other edits stay blocked. */
  const release = (message: string) => touch({ phase: "copy", sanitized_error: message.slice(0, 500) }).catch(() => undefined);
  const binding = { adAccountId: review.adAccountId, pageId: review.pageId };

  if (action === "cancel") {
    try {
      await withMetaConnection(context, { purpose: "delete", binding, expectedGeneration: review.generation }, async meta => {
        for (const copy of pending) {
          await meta.deleteAdSetCopy(review.metaCampaignId, copy.to.adSetId, status === "active" ? { runningAdSetId: copy.from.adSetId } : {});
        }
      });
    } catch (cause) {
      const mapped = toEditError(cause);
      await release(mapped.message);
      throw new CampaignEditError(mapped.message, mapped.status, true);
    }
    const result = { action, adSets: pending.map(copy => ({ adSetId: copy.to.adSetId, previousAdSetId: copy.from.adSetId })), replay: false } satisfies AudienceSwitchResult;
    await touch({ state: "cancelled", phase: "complete", result: { ...stored, switch: result } as unknown as Json });
    await logEvent({ businessId: context.businessId, action: "campaign.edit", entityType: "campaign", entityId: campaignId, metaObjectId: campaign.meta_campaign_id,
      reason: `Cancelled the new audience for "${campaign.name ?? campaignId}"; the current one keeps running`, details: { deleted_ad_sets: pending.map(copy => copy.to.adSetId) } });
    return result;
  }

  const switched: Array<{ from: { adSetId: string; adIds: string[] }; to: AudienceEdit }> = [];
  try {
    // Turning the copy on starts delivery, so a running campaign needs the activation capability.
    await withMetaConnection(context, { purpose: status === "active" ? "activate" : "create_paused", binding, expectedGeneration: review.generation }, async meta => {
      for (const copy of pending) {
        const keepPausedAdIds = keptPausedCopies(copy, campaign.raw);
        const done = await meta.switchAdSet(review.metaCampaignId, { fromAdSetId: copy.from.adSetId, toAdSetId: copy.to.adSetId, toAdIds: copy.to.adIds, running: status === "active", keepPausedAdIds });
        switched.push({ from: copy.from, to: { mode: "rebuild", validated: false, adSetId: done.adSetId, adIds: done.adIds, retiredAdSetId: copy.from.adSetId } });
      }
    });
  } catch (cause) {
    const mapped = toEditError(cause);
    if (cause instanceof AdSetSwitchStuckError) {
      recordProductEvent({ kind: "workflow", name: "campaign.edit", outcome: "failed", businessId: context.businessId, attributes: { entityType: "campaign", count: switched.length, errorCode: "EDIT_SWITCH_STUCK" } });
    }
    // Ad sets already switched are mirrored now; the retry finishes the rest (switchAdSet completes a done switch).
    if (switched.length) await saveCampaignChildren({ businessId: context.businessId, userId: context.userId }, campaignId, current => mirroredChildren(current, switched)).catch(() => undefined);
    await release(mapped.message);
    throw new CampaignEditError(mapped.message, mapped.status, true);
  }

  try {
    const { error: mirrorError } = await saveCampaignChildren({ businessId: context.businessId, userId: context.userId }, campaignId, current => mirroredChildren(current, switched));
    if (mirrorError) throw mirrorError;
  } catch {
    const message = "Meta switched the audience but AdBrain could not record it. Try again to finish.";
    await release(message);
    throw new CampaignEditError(message, 502, true);
  }
  const result = { action, adSets: switched.map(edit => ({ adSetId: edit.to.adSetId, previousAdSetId: edit.from.adSetId })), replay: false } satisfies AudienceSwitchResult;
  await touch({ state: "succeeded", phase: "complete", sanitized_error: null, result: { ...stored, switch: result } as unknown as Json });
  await logEvent({ businessId: context.businessId, action: "campaign.edit", entityType: "campaign", entityId: campaignId, metaObjectId: campaign.meta_campaign_id,
    reason: `Turned on the new audience for "${campaign.name ?? campaignId}"; the old one is stopped`, details: { ad_sets: result.adSets } });
  return result;
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
