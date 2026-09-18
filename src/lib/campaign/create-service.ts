import { createHash } from "node:crypto";
import type { DraftRecord } from "./draft-store";
import type { ReviewDTO } from "./connect-contracts";
import { buildCreativeReviewPayload } from "./preflight";
import { createOperationCheckpoint } from "./operation-store";
import { executeOperation, OperationPhaseError, recordExternalId, type OperationRecord } from "./operations";
import { effectiveDailyBudget } from "./spend";
import { savedCreativeDescription } from "@/lib/creative/concept";
import { splitAgeRange, type CreateCampaignResult } from "@/lib/meta/client";
import { withMetaConnection, type AuthorizedBusiness } from "@/lib/meta/connection-access";
import type { CampaignSupabase } from "./preflight-runtime";
import type { Json } from "@/lib/types";

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
          const { data: business, error: businessError } = await database.from("businesses").select("website, locations").eq("id", actor.businessId).maybeSingle();
          if (businessError || !business) throw new OperationPhaseError("Business could not be loaded before execution.", { transmitted: false });
          const location = review.resolvedLocation!;
          const excludedLocation = review.resolvedExcludedLocation;
          const { data: creatives, error: creativeError } = await database.from("creatives").select("id, image_url, headline, primary_text, cta, generation")
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
          metaResult = await meta.createLeadCampaign({
            name: draft.input.name, dailyBudgetRupees: draft.input.dailyBudgetRupees,
            leadFormId: draft.input.destination === "whatsapp" ? undefined : draft.input.leadFormId ?? undefined,
            destination: draft.input.destination ?? "instant_form", whatsappNumber: review.whatsappNumber ?? undefined,
            link: business.website || "https://facebook.com",
            creatives: creativeInputs.map(creative => ({ imageUrl: creative.image_url!, headline: creative.headline!, message: creative.primary_text ?? "", description: savedCreativeDescription(creative.generation), cta: creative.cta })),
            location, excludedLocation, ageMin: targeting.age?.min, ageMax: targeting.age?.max,
            gender: targeting.gender ?? "all", interests: review.audienceInterests,
            variants: draft.input.abTest ? splitAgeRange(targeting.age?.min ?? 25, targeting.age?.max ?? 60).map(band => ({
              label: band.label, ageMin: band.ageMin, ageMax: band.ageMax, location, excludedLocation,
            })) : undefined,
            onCheckpoint,
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
      const { data: campaign, error } = await database.from("campaigns").insert({
        business_id: actor.businessId, name: draft.input.name,
        objective: metaResult.destination === "whatsapp" ? "OUTCOME_ENGAGEMENT" : "leads",
        destination: metaResult.destination,
        daily_budget: effectiveDailyBudget(draft.input.dailyBudgetRupees, metaResult.adSetIds.length || 1),
        status: "paused", meta_campaign_id: metaResult.campaignId,
        meta_adset_id: metaResult.adSetId, meta_ad_ids: metaResult.adIds,
        meta_ad_account_id: review.selected!.adAccountId, meta_page_id: review.selected!.pageId,
        meta_connection_generation: review.connectionGeneration, creative_ids: draft.input.creativeIds,
        raw: { source: "campaign_operation", metaResult } as unknown as Json,
      }).select("id").single();
      return error || !campaign ? null : { ...current, campaignId: campaign.id };
    },
  });
}