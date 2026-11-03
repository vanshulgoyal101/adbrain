import { createHash } from "node:crypto";
import { recordProductEvent } from "@/lib/observability/logger";
import { renderStoriesWithin } from "@/lib/creative/story";
import { TargetingExclusionsMissingError } from "@/lib/meta/service-area";
import type { DraftRecord } from "./draft-store";
import type { ReviewDTO } from "./connect-contracts";
import { buildCreativeReviewPayload, isReviewedWhatsAppMessage } from "./preflight";
import { createOperationCheckpoint } from "./operation-store";
import { executeOperation, OperationPhaseError, OperationRolledBackError, recordExternalId, type OperationRecord } from "./operations";
import { effectiveDailyBudget } from "./spend";
import { savedCreativeDescription } from "@/lib/creative/concept";
import { MetaCreateRolledBackError, splitAgeRange, type CampaignMutationCheckpoint, type CreateCampaignResult } from "@/lib/meta/client";
import { withMetaConnection, type AuthorizedBusiness } from "@/lib/meta/connection-access";
import { boundWhatsAppNumbers } from "@/lib/meta/whatsapp-bindings";
import type { CampaignSupabase } from "./preflight-runtime";
import type { Json } from "@/lib/types";
import { saveCampaign } from "./trusted-write";
import { campaignWhatsAppMessage } from "./campaign-whatsapp-message";
import { draftAreaNames } from "./draft-targeting";
import { normalizeWebsite } from "@/lib/brand/validation";
import { websiteGoalObjective } from "./website-review";
import { checkPlan, planCheckEvent } from "./plan-check";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildLaunchSnapshot, readCreativeMedia, saveLaunchSnapshot } from "./learnings";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adResultsEnabled } from "./ad-results-store";
import { buildAdAssetLinks } from "./asset-results";
import { recordAdAssetLinks } from "./asset-results-store";

/**
 * The stored objective label; website visits match what sync maps OUTCOME_TRAFFIC to, so they never read as a form
 * campaign. #2714: a website ad's signup or sales goal is the one Review hashed, never re-read from the draft.
 */
function campaignObjective(destination: string, review: Pick<ReviewDTO, "websiteGoal">): string {
  if (destination === "whatsapp") return "OUTCOME_ENGAGEMENT";
  return destination === "website" ? websiteGoalObjective(review.websiteGoal ?? "visits") : "leads";
}

const STORY_RENDER_BUDGET_MS = 15_000;

export async function executeReviewedCampaign(input: {
  database: CampaignSupabase;
  operationDatabase: CampaignSupabase;
  actor: AuthorizedBusiness;
  draft: DraftRecord;
  review: ReviewDTO;
  operation: OperationRecord;
  signal?: AbortSignal;
}) {
  const { database, operationDatabase, actor, draft, review, operation, signal } = input;
  let metaResult: CreateCampaignResult | null = null;
  let launchSnapshot: ReturnType<typeof buildLaunchSnapshot> | null = null;
  const assetCheckpoints: CampaignMutationCheckpoint[] = [];
  let checkpointState = operation;
  const checkpoint = createOperationCheckpoint(operationDatabase, operation);
  const onCheckpoint = async (event: CampaignMutationCheckpoint) => {
    checkpointState = { ...recordExternalId(checkpointState, event.externalId), phase: event.phase };
    const saved = await checkpoint.checkpoint(checkpointState);
    if (!saved) throw new OperationPhaseError("Operation lease was lost after Meta mutation.", { transmitted: true });
    checkpointState = saved;
    assetCheckpoints.push(event);
    signal?.throwIfAborted();
  };
  return executeOperation(operation, [
    {
      phase: "campaign",
      run: async () => {
        if (signal?.aborted) throw new OperationPhaseError("Campaign execution was stopped before transmission.", { transmitted: false });
        const targeting = draft.input.targeting;
        const created = await withMetaConnection(actor, {
          purpose: "create_paused",
          binding: { adAccountId: review.selected!.adAccountId, pageId: review.selected!.pageId },
          expectedGeneration: review.connectionGeneration,
          signal,
        }, async meta => {
          const { data: business, error: businessError } = await database.from("businesses").select("name, website, locations, offers, whatsapp_template").eq("id", actor.businessId).maybeSingle();
          if (businessError || !business) throw new OperationPhaseError("Business could not be loaded before execution.", { transmitted: false });
          const location = review.resolvedLocation!;
          const excludedLocation = review.resolvedExcludedLocation;
          const { data: creatives, error: creativeError } = await database.from("creatives").select("id, image_url, headline, primary_text, cta, generation, angle")
            .in("id", draft.input.creativeIds).eq("business_id", actor.businessId).eq("status", "approved");
          if (creativeError) throw new OperationPhaseError("Creatives could not be loaded before execution.", { transmitted: false });
          const byId = new Map((creatives ?? []).map(creative => [creative.id, creative]));
          const creativeInputs = draft.input.creativeIds.map(id => byId.get(id)).filter((creative): creative is NonNullable<typeof creative> => Boolean(creative?.image_url && creative.headline));
          if (creativeInputs.length !== draft.input.creativeIds.length) throw new OperationPhaseError("Selected creative changed before execution.", { transmitted: false });
          const creativeHash = createHash("sha256").update(JSON.stringify(buildCreativeReviewPayload(creativeInputs.map(creative => ({
            id: creative.id, businessId: actor.businessId, approved: true, imageUrl: creative.image_url,
            headline: creative.headline, primaryText: creative.primary_text, cta: creative.cta,
            description: savedCreativeDescription(creative.generation),
          }))))).digest("hex");
          if (creativeHash !== review.creativeHash) throw new OperationPhaseError("Selected creative changed since review.", { transmitted: false });
          // #333: Stories and Reels get a 9:16 layout of the same reviewed design; on any failure they keep the 4:5.
          // The renders run alongside Meta's campaign create and 4:5 uploads (#499: three 9:16s never fit a
          // separate 6 s wait in production). Capped inside the 60 s create lease; a slow host just means no 9:16.
          const storyFallback = (stage: "render" | "instagram" | "upload" | "creative" | "ad", errorCode: string) => recordProductEvent({
            kind: "workflow", name: "campaign.story_fallback", outcome: "partial", businessId: actor.businessId, attributes: { errorCode: `${stage}:${errorCode}` },
          });
          const storyImages = draft.input.destination === "whatsapp" || draft.input.destination === "instant_form"
            ? renderStoriesWithin(creativeInputs.map(creative => creative.generation), STORY_RENDER_BUDGET_MS, code => storyFallback("render", code))
            : creativeInputs.map(() => null);
          let storyRendered = false;
          let sentTargetings: string[] | undefined;
          for (const story of storyImages) void Promise.resolve(story).then(image => { if (image) storyRendered = true; });
          // #493: the ask names the city only when the campaign targets one (same areas as targeting).
          const areas = draftAreaNames(draft.input, business.locations ?? []);
          // #840: this campaign's edit, else the saved message, else AdBrain's suggestion: what Review showed.
          const message = draft.input.destination === "whatsapp" ? campaignWhatsAppMessage({ draft: draft.input, business, creatives: creativeInputs }) : null;
          // #2452: rebuilt from this launch's own reads; anything but the reviewed message is refused before Meta sees it.
          if (message && !isReviewedWhatsAppMessage(message, review)) throw new OperationPhaseError("WhatsApp message changed since review.", { transmitted: false });
          const prefill = message?.opening ?? null;
          // #2599: a website ad sends the link Review opened and hashed, not a Brand read taken after it.
          const websiteLink = draft.input.destination === "website" ? review.websiteUrl : undefined;
          if (draft.input.destination === "website" && !websiteLink) throw new OperationPhaseError("Website link missing from review.", { transmitted: false });
          // #2714: Meta's signup and sales payload is B2's (#2713); until it lands, a conversion review never reaches Meta as traffic.
          if (draft.input.destination === "website" && review.websiteGoal && review.websiteGoal !== "visits") {
            throw new OperationPhaseError("Website signup and sales goals can't launch yet.", { transmitted: false });
          }
          // #789: for the ledger, read alongside Meta's create; never rejects.
          const mediaRead = readCreativeMedia(database as unknown as SupabaseClient, actor.businessId, creativeInputs.map(creative => creative.id));
          metaResult = await meta.createLeadCampaign({
            name: draft.input.name, dailyBudgetRupees: draft.input.dailyBudgetRupees,
            leadFormId: (draft.input.destination ?? "instant_form") === "instant_form" ? draft.input.leadFormId ?? undefined : undefined,
            destination: draft.input.destination ?? "instant_form", whatsappNumber: review.whatsappNumber ?? undefined,
            // #253: the create step re-checks the number against this business's bindings.
            ...(draft.input.destination === "whatsapp" ? { boundWhatsAppNumbers: await boundWhatsAppNumbers(actor.businessId) } : {}),
            ...(prefill ? { whatsappGreeting: prefill } : {}),
            // Brands saved before #470 may hold a bare domain; Meta needs a full link.
            link: websiteLink ?? normalizeWebsite(business.website) ?? "https://facebook.com",
            creatives: creativeInputs.map((creative, index) => ({ imageUrl: creative.image_url!, headline: creative.headline!, message: creative.primary_text ?? "", description: savedCreativeDescription(creative.generation), cta: creative.cta, storyImage: storyImages[index] })),
            location, excludedLocation, ageMin: targeting.age?.min, ageMax: targeting.age?.max,
            gender: targeting.gender ?? "all", interests: review.audienceInterests,
            variants: draft.input.abTest ? splitAgeRange(targeting.age?.min ?? 25, targeting.age?.max ?? 60).map(band => ({
              label: band.label, ageMin: band.ageMin, ageMax: band.ageMax, location, excludedLocation,
            })) : undefined,
            excludeFacebookReels: draft.input.excludeFacebookReels === true,
            onCheckpoint,
            onStoryFallback: storyFallback,
            // #419 item 2(a): the exact payloads sent, checked against Meta's new-advertiser guidance.
            onPlanned: (plan) => {
              sentTargetings = plan.adSets.map(form => form.targeting ?? "");
              recordProductEvent({
                kind: "workflow", name: "campaign.plan_check", businessId: actor.businessId,
                ...planCheckEvent(checkPlan(plan), draft.input.destination ?? "instant_form"),
              });
            },
          }).catch((error: unknown) => {
            // #741: refused before any POST, so Meta holds nothing; the owner can simply retry.
            if (error instanceof TargetingExclusionsMissingError) throw new OperationPhaseError(error.message, { transmitted: false });
            throw error;
          });
          // #588: what this launch tried, for the learning ledger (saved once the campaign row exists). Never fails the launch (#603).
          const media = await mediaRead;
          try {
            launchSnapshot = buildLaunchSnapshot({
              destination: metaResult.destination, objective: campaignObjective(metaResult.destination, review),
              dailyBudgetRupees: draft.input.dailyBudgetRupees, adSetCount: metaResult.adSetIds.length || 1, abTest: Boolean(draft.input.abTest),
              areas, ageMin: targeting.age?.min, ageMax: targeting.age?.max, gender: targeting.gender ?? "all",
              interests: (review.audienceInterests ?? []).map(interest => interest.name),
              whatsappLanguage: draft.input.whatsappLanguage ?? null, prefill, prefillSource: message?.source,
              storyFormat: storyRendered, sentTargetings, metaCreativeIds: metaResult.creativeIds,
              creatives: creativeInputs.map(creative => ({ id: creative.id, angle: creative.angle ?? null, generation: creative.generation, media: media?.get(creative.id) ?? null })),
              mediaUnknown: !media,
            });
          } catch {
            launchSnapshot = null;
          }
          return metaResult;
        }).catch((error: unknown) => {
          // #735: Meta confirmed the empty campaign is gone, so this attempt simply failed.
          throw error instanceof MetaCreateRolledBackError ? new OperationRolledBackError(error.message) : error;
        });
        return { externalIds: [created.campaignId, ...created.adSetIds, ...created.adIds] };
      },
    },
    { phase: "adset", run: async () => ({ externalIds: [] }) },
    { phase: "creative", run: async () => ({ externalIds: [] }) },
    { phase: "ad", run: async () => ({ externalIds: [] }) },
  ], checkpoint, {
    finalize: async current => {
      if (!metaResult) return null;
      const { data: campaign, error } = await saveCampaign(actor, {
        name: draft.input.name,
        objective: campaignObjective(metaResult.destination, review),
        destination: metaResult.destination,
        daily_budget: effectiveDailyBudget(draft.input.dailyBudgetRupees, metaResult.adSetIds.length || 1),
        status: "paused", meta_campaign_id: metaResult.campaignId,
        meta_adset_id: metaResult.adSetId, meta_ad_ids: metaResult.adIds,
        meta_ad_account_id: review.selected!.adAccountId, meta_page_id: review.selected!.pageId,
        meta_connection_generation: review.connectionGeneration, creative_ids: draft.input.creativeIds,
        raw: { source: "campaign_operation", metaResult } as unknown as Json,
      }, undefined, operationDatabase);
      if (error || !campaign) return null;
      if (launchSnapshot && !(await saveLaunchSnapshot(createAdminClient() as unknown as SupabaseClient, { campaignId: campaign.id, businessId: actor.businessId, snapshot: launchSnapshot }))) {
        recordProductEvent({ kind: "workflow", name: "campaign.learning_snapshot", outcome: "failed", businessId: actor.businessId });
      }
      // #789: an unverified photo is never stored as "no photo"; the next results refresh links these ads instead.
      if (adResultsEnabled()) {
        if (!launchSnapshot || launchSnapshot.mediaUnknown) {
          recordProductEvent({ kind: "workflow", name: "campaign.ad_attribution", outcome: "partial", businessId: actor.businessId, attributes: { errorCode: "media_unverified" } });
        } else try {
          await recordAdAssetLinks(createAdminClient() as unknown as SupabaseClient, buildAdAssetLinks({
            businessId: actor.businessId, campaignId: campaign.id, creativeIds: draft.input.creativeIds,
            mediaByCreative: new Map(launchSnapshot.creatives.map(creative => [creative.id, creative.mediaAssetId])),
            events: assetCheckpoints,
          }));
        } catch {
          recordProductEvent({ kind: "workflow", name: "campaign.ad_attribution", outcome: "failed", businessId: actor.businessId });
        }
      }
      return { ...current, campaignId: campaign.id };
    },
  });
}