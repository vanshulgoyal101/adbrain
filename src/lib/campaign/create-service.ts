import { createHash } from "node:crypto";
import { recordProductEvent } from "@/lib/observability/logger";
import { renderStoryAd } from "@/lib/creative/story";
import type { DraftRecord } from "./draft-store";
import type { ReviewDTO } from "./connect-contracts";
import { buildCreativeReviewPayload } from "./preflight";
import { createOperationCheckpoint } from "./operation-store";
import { executeOperation, OperationPhaseError, recordExternalId, type OperationRecord } from "./operations";
import { effectiveDailyBudget } from "./spend";
import { savedCreativeDescription } from "@/lib/creative/concept";
import { splitAgeRange, type CreateCampaignResult } from "@/lib/meta/client";
import { withMetaConnection, type AuthorizedBusiness } from "@/lib/meta/connection-access";
import { boundWhatsAppNumbers } from "@/lib/meta/whatsapp-bindings";
import type { CampaignSupabase } from "./preflight-runtime";
import type { Json } from "@/lib/types";
import { saveCampaign } from "./trusted-write";
import { whatsappGreeting } from "./whatsapp-greeting";
import { draftAreaNames } from "./draft-targeting";
import { savedGenerationSettings } from "@/lib/creative/receipt";
import { normalizeWebsite } from "@/lib/brand/validation";
import { checkPlan, planCheckEvent } from "./plan-check";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildLaunchSnapshot, saveLaunchSnapshot } from "./learnings";
import type { SupabaseClient } from "@supabase/supabase-js";

const STORY_RENDER_BUDGET_MS = 6_000;

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
  let checkpointState = operation;
  const checkpoint = createOperationCheckpoint(operationDatabase, operation);
  const onCheckpoint = async (event: { phase: "campaign" | "adset" | "creative" | "ad"; externalId: string }) => {
    checkpointState = { ...recordExternalId(checkpointState, event.externalId), phase: event.phase };
    const saved = await checkpoint.checkpoint(checkpointState);
    if (!saved) throw new OperationPhaseError("Operation lease was lost after Meta mutation.", { transmitted: true });
    checkpointState = saved;
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
          const { data: business, error: businessError } = await database.from("businesses").select("name, website, locations, offers").eq("id", actor.businessId).maybeSingle();
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
          // Capped well inside the 60 s create lease; a slow photo or logo host just means no 9:16.
          const noStories = creativeInputs.map(() => null);
          const storyFallback = (stage: "render" | "instagram" | "upload" | "creative" | "ad", errorCode: string) => recordProductEvent({
            kind: "workflow", name: "campaign.story_fallback", outcome: "partial", businessId: actor.businessId, attributes: { errorCode: `${stage}:${errorCode}` },
          });
          let storyTimer: ReturnType<typeof setTimeout> | undefined;
          const storyImages = draft.input.destination === "whatsapp"
            ? await Promise.race([
              Promise.all(creativeInputs.map(creative => renderStoryAd(creative.generation).catch(() => {
                storyFallback("render", "error");
                return null;
              }))),
              new Promise<null[]>(resolve => {
                storyTimer = setTimeout(() => {
                  storyFallback("render", "timeout");
                  resolve(noStories);
                }, STORY_RENDER_BUDGET_MS);
              }),
            ]).finally(() => clearTimeout(storyTimer))
            : noStories;
          // #493: the ask names the city only when the campaign targets one (same areas as targeting).
          const areas = draftAreaNames(draft.input, business.locations ?? []);
          const prefill = draft.input.destination === "whatsapp" ? whatsappGreeting(
            business,
            creativeInputs.flatMap(creative => [creative.headline ?? "", creative.primary_text ?? ""]),
            areas,
            creativeInputs.map(creative => savedGenerationSettings(creative.generation).language),
            draft.input.whatsappLanguage ?? "ad",
          ) : null;
          metaResult = await meta.createLeadCampaign({
            name: draft.input.name, dailyBudgetRupees: draft.input.dailyBudgetRupees,
            leadFormId: draft.input.destination === "whatsapp" ? undefined : draft.input.leadFormId ?? undefined,
            destination: draft.input.destination ?? "instant_form", whatsappNumber: review.whatsappNumber ?? undefined,
            // #253: the create step re-checks the number against this business's bindings.
            ...(draft.input.destination === "whatsapp" ? { boundWhatsAppNumbers: await boundWhatsAppNumbers(actor.businessId) } : {}),
            ...(prefill ? { whatsappGreeting: prefill } : {}),
            // Brands saved before #470 may hold a bare domain; Meta needs a full link.
            link: normalizeWebsite(business.website) ?? "https://facebook.com",
            creatives: creativeInputs.map((creative, index) => ({ imageUrl: creative.image_url!, headline: creative.headline!, message: creative.primary_text ?? "", description: savedCreativeDescription(creative.generation), cta: creative.cta, storyImage: storyImages[index] })),
            location, excludedLocation, ageMin: targeting.age?.min, ageMax: targeting.age?.max,
            gender: targeting.gender ?? "all", interests: review.audienceInterests,
            variants: draft.input.abTest ? splitAgeRange(targeting.age?.min ?? 25, targeting.age?.max ?? 60).map(band => ({
              label: band.label, ageMin: band.ageMin, ageMax: band.ageMax, location, excludedLocation,
            })) : undefined,
            onCheckpoint,
            onStoryFallback: storyFallback,
            // #419 item 2(a): the exact payloads sent, checked against Meta's new-advertiser guidance.
            onPlanned: (plan) => recordProductEvent({
              kind: "workflow", name: "campaign.plan_check", businessId: actor.businessId,
              ...planCheckEvent(checkPlan(plan), draft.input.destination ?? "instant_form"),
            }),
          });
          // #588: what this launch tried, for the learning ledger (saved once the campaign row exists).
          launchSnapshot = buildLaunchSnapshot({
            destination: metaResult.destination, objective: metaResult.destination === "whatsapp" ? "OUTCOME_ENGAGEMENT" : "leads",
            dailyBudgetRupees: draft.input.dailyBudgetRupees, adSetCount: metaResult.adSetIds.length || 1, abTest: Boolean(draft.input.abTest),
            areas, ageMin: targeting.age?.min, ageMax: targeting.age?.max, gender: targeting.gender ?? "all",
            interests: (review.audienceInterests ?? []).map(interest => interest.name),
            whatsappLanguage: draft.input.whatsappLanguage ?? null, prefill,
            storyFormat: storyImages.some(Boolean),
            creatives: creativeInputs.map(creative => ({ id: creative.id, angle: creative.angle ?? null, generation: creative.generation })),
          });
          return metaResult;
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
        objective: metaResult.destination === "whatsapp" ? "OUTCOME_ENGAGEMENT" : "leads",
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
      return { ...current, campaignId: campaign.id };
    },
  });
}