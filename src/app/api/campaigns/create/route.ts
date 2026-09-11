import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createCampaignRequestSchema, type OperationDTO } from "@/lib/campaign/connect-contracts";
import { draftRecordFromRow, isDraftExpired } from "@/lib/campaign/draft-store";
import { buildCampaignPreflightLoaders } from "@/lib/campaign/preflight-runtime";
import { prepareCampaignReview } from "@/lib/campaign/preflight-service";
import {
  executeOperation,
  OperationPhaseError,
  recordExternalId,
  type OperationCheckpointPort,
  type OperationRecord,
} from "@/lib/campaign/operations";
import {
  claimPersistedOperation,
  getPersistedOperationStatus,
  operationRecordFromRow,
  operationToDTO,
  type OperationClaimRepository,
} from "@/lib/campaign/operation-store";
import { effectiveDailyBudget } from "@/lib/campaign/spend";
import { splitAgeRange, type CreateCampaignResult } from "@/lib/meta/client";
import { resolveDraftTargeting } from "@/lib/campaign/draft-targeting";
import { ConnectionAccessError, requireOwnedBusiness, withMetaConnection } from "@/lib/meta/connection-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

type ErrorCode = "UNAUTHENTICATED" | "NOT_FOUND" | "FORBIDDEN" | "INVALID_INPUT" | "CONFLICT" | "PREFLIGHT_BLOCKED" | "UNAVAILABLE";

function errorResponse(requestId: string, status: number, code: ErrorCode, message: string, retryable = false) {
  return NextResponse.json({ ok: false, error: { code, message, retryable }, requestId }, { status });
}

function operationResponse(requestId: string, operation: OperationRecord, status: number) {
  const blockers = operation.state === "needs_reconciliation"
    ? [{ code: "RECONCILIATION_REQUIRED" as const, message: "Campaign creation needs reconciliation before it can be retried.", action: { kind: "contact_admin" as const } }]
    : [];
  const data: OperationDTO = operationToDTO(operation, blockers);
  return NextResponse.json({ ok: true, data, requestId }, { status });
}

function operationRequestHash(input: {
  businessId: string;
  draftId: string;
  draftVersion: number;
  planHash: string;
  connectionGeneration: number;
  idempotencyKey: string;
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function operationRepository(
  supabase: Awaited<ReturnType<typeof createClient>>,
  draftId: string,
  draftVersion: number,
  connectionGeneration: number,
): OperationClaimRepository {
  const findByBusinessKey = async (request: {
    businessId: string;
    idempotencyKey: string;
    requestHash: string;
    connectionGeneration: number;
  }) => {
    const { data } = await supabase.from("campaign_operations")
      .select("*")
      .eq("business_id", request.businessId)
      .eq("kind", "campaign_create")
      .eq("idempotency_key", request.idempotencyKey)
      .maybeSingle();
    return data ? operationRecordFromRow(data) : null;
  };

  const persistClaim = async (operation: OperationRecord) => {
    const { data, error } = await supabase.rpc("claim_campaign_operation", {
      p_operation_id: operation.operationId,
      p_business_id: operation.businessId,
      p_draft_id: draftId,
      p_draft_version: draftVersion,
      p_connection_generation: connectionGeneration,
      p_kind: "campaign_create",
      p_idempotency_key: operation.idempotencyKey,
      p_request_hash: operation.requestHash,
      p_lease_until: new Date(operation.leaseUntil ?? Date.now() + 60_000).toISOString(),
      p_payload: {} as Json,
      p_now: new Date().toISOString(),
    });
    if (error || !data?.[0]) return null;
    return operationRecordFromRow(data[0]);
  };

  return { findByBusinessKey, insert: persistClaim, reclaim: persistClaim };
}

function operationResultJson(operation: OperationRecord): Json {
  return { externalIds: operation.externalIds, campaignId: operation.campaignId };
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return errorResponse(requestId, 401, "UNAUTHENTICATED", "Sign in required.");

  const parsed = createCampaignRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(requestId, 400, "INVALID_INPUT", "Campaign creation request is invalid.");
  const input = parsed.data;

  let actor;
  try {
    actor = await requireOwnedBusiness(input.businessId);
  } catch (error) {
    if (error instanceof ConnectionAccessError) {
      const status = error.code === "UNAUTHENTICATED" ? 401 : error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : 503;
      return errorResponse(requestId, status, status === 401 ? "UNAUTHENTICATED" : status === 403 ? "FORBIDDEN" : status === 404 ? "NOT_FOUND" : "UNAVAILABLE", status >= 500 ? "Business access could not be checked." : error.message, status >= 500);
    }
    return errorResponse(requestId, 503, "UNAVAILABLE", "Business access could not be checked.", true);
  }

  const requestHash = operationRequestHash(input);
  const { data: existingOperationRow, error: existingOperationError } = await supabase
    .from("campaign_operations")
    .select("*")
    .eq("business_id", actor.businessId)
    .eq("kind", "campaign_create")
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();
  if (existingOperationError) return errorResponse(requestId, 503, "UNAVAILABLE", "Campaign operation storage is unavailable.", true);
  if (existingOperationRow) {
    let existingOperation;
    try {
      existingOperation = await getPersistedOperationStatus(existingOperationRow);
    } catch {
      return errorResponse(requestId, 503, "UNAVAILABLE", "Campaign operation storage is unavailable.", true);
    }
    if (existingOperation.requestHash !== requestHash || existingOperation.connectionGeneration !== input.connectionGeneration) {
      return errorResponse(requestId, 409, "CONFLICT", "This idempotency key was used for a different campaign request.");
    }
    if (["succeeded", "failed", "needs_reconciliation"].includes(existingOperation.state)) {
      return operationResponse(requestId, existingOperation, 200);
    }
    if (existingOperation.leaseUntil !== null && existingOperation.leaseUntil > Date.now()) {
      return errorResponse(requestId, 409, "CONFLICT", "This campaign operation is already running.", true);
    }
  }

  const { data: draftRow, error: draftError } = await supabase.from("campaign_drafts")
    .select("*")
    .eq("id", input.draftId)
    .eq("business_id", actor.businessId)
    .eq("owner_id", actor.userId)
    .maybeSingle();
  if (draftError || !draftRow) return errorResponse(requestId, 404, "NOT_FOUND", "Draft not found.");
  const draft = draftRecordFromRow(draftRow);
  const now = new Date().toISOString();
  if (isDraftExpired(draft.expiresAt, now)) return errorResponse(requestId, 404, "NOT_FOUND", "Draft not found.");
  if (draft.version !== input.draftVersion) return errorResponse(requestId, 409, "CONFLICT", "Draft changed in another tab. Review the latest version.", true);

  const reviewResult = await prepareCampaignReview(buildCampaignPreflightLoaders(supabase, actor), {
    actor,
    draftId: input.draftId,
    requestedDraftVersion: input.draftVersion,
    now,
  });
  if (reviewResult.kind === "not_found") return errorResponse(requestId, 404, "NOT_FOUND", "Draft not found.");
  if (reviewResult.kind === "forbidden") return errorResponse(requestId, 403, "FORBIDDEN", "Draft access is not allowed.");
  if (reviewResult.kind === "stale") return errorResponse(requestId, 409, "CONFLICT", "Draft changed in another tab. Review the latest version.", true);
  const review = reviewResult.review;
  if (!review.canCreatePaused || !review.planHash || !review.selected) return errorResponse(requestId, 400, "PREFLIGHT_BLOCKED", "Campaign preparation is blocked. Resolve the review blockers before creating.");
  if (review.planHash !== input.planHash) return errorResponse(requestId, 409, "CONFLICT", "Campaign review changed. Review again before creating.", true);
  if (review.connectionGeneration !== input.connectionGeneration) return errorResponse(requestId, 409, "CONFLICT", "Meta connection changed. Review again before creating.", true);

  let operationDb;
  try {
    operationDb = createAdminClient();
  } catch {
    return errorResponse(requestId, 503, "UNAVAILABLE", "Campaign operation storage is unavailable.", true);
  }
  const claim = await claimPersistedOperation(
    operationRepository(operationDb, input.draftId, input.draftVersion, input.connectionGeneration),
    { businessId: actor.businessId, idempotencyKey: input.idempotencyKey, requestHash, connectionGeneration: input.connectionGeneration },
    { now: Date.now(), leaseMs: 60_000, operationId: crypto.randomUUID() },
  );
  if (claim.kind === "conflict") return errorResponse(requestId, 409, "CONFLICT", "This idempotency key was used for a different campaign request.");
  if (claim.kind === "busy") return errorResponse(requestId, 409, "CONFLICT", "This campaign operation is already running.", true);
  if (claim.kind === "replay") return operationResponse(requestId, claim.operation, 200);

  let metaResult: CreateCampaignResult | null = null;
  let checkpointState = claim.operation;
  const phaseRank: Record<OperationRecord["phase"], number> = {
    campaign: 0,
    adset: 1,
    creative: 2,
    ad: 3,
    reconcile: 4,
    complete: 5,
  };
  const mergeCheckpointState = (operation: OperationRecord): OperationRecord => {
    const externalIds = [...new Set([...operation.externalIds, ...checkpointState.externalIds])];
    const phase = operation.state === "running" && phaseRank[checkpointState.phase] > phaseRank[operation.phase]
      ? checkpointState.phase
      : operation.phase;
    return {
      ...operation,
      externalIds,
      phase,
      campaignId: operation.campaignId ?? checkpointState.campaignId,
    };
  };
  const checkpoint: OperationCheckpointPort = {
    checkpoint: async (operation) => {
      const durableOperation = mergeCheckpointState(operation);
      if (operation.state === "succeeded") {
        const { data, error } = await operationDb.rpc("finish_campaign_operation", {
          p_operation_id: durableOperation.operationId,
          p_business_id: durableOperation.businessId,
          p_connection_generation: durableOperation.connectionGeneration,
          p_campaign_id: durableOperation.campaignId!,
          p_result: operationResultJson(durableOperation),
          p_now: new Date().toISOString(),
        });
        return error || !data?.[0] ? null : mergeCheckpointState(operationRecordFromRow(data[0]));
      }
      if (operation.state === "failed" || operation.state === "needs_reconciliation") {
        const { data, error } = await operationDb.rpc("fail_campaign_operation", {
          p_operation_id: durableOperation.operationId,
          p_business_id: durableOperation.businessId,
          p_connection_generation: durableOperation.connectionGeneration,
          p_state: durableOperation.state,
          p_external_ids: durableOperation.externalIds,
          p_campaign_id: durableOperation.campaignId,
          p_error: durableOperation.sanitizedError,
        });
        return error || !data?.[0] ? null : mergeCheckpointState(operationRecordFromRow(data[0]));
      }
      const { data, error } = await operationDb.rpc("checkpoint_campaign_operation", {
        p_operation_id: operation.operationId,
        p_business_id: operation.businessId,
        p_connection_generation: operation.connectionGeneration,
        p_phase: durableOperation.phase,
        p_lease_until: durableOperation.leaseUntil === null ? null : new Date(durableOperation.leaseUntil).toISOString(),
        p_external_ids: durableOperation.externalIds as unknown as Json,
        p_now: new Date().toISOString(),
      });
      return error || !data?.[0] ? null : mergeCheckpointState(operationRecordFromRow(data[0]));
    },
  };

  const onCheckpoint = async (event: { phase: "campaign" | "adset" | "creative" | "ad"; externalId: string }) => {
    checkpointState = { ...recordExternalId(checkpointState, event.externalId), phase: event.phase };
    const saved = await checkpoint.checkpoint(checkpointState);
    if (!saved) throw new OperationPhaseError("Operation lease was lost after Meta mutation.", { transmitted: true });
    checkpointState = saved;
  };

  const execution = await executeOperation(
    claim.operation,
    [
      {
        phase: "campaign",
        run: async () => {
          const targeting = draft.input.targeting;
          const created = await withMetaConnection(actor, {
            purpose: "create_paused",
            binding: { adAccountId: review.selected!.adAccountId, pageId: review.selected!.pageId },
            expectedGeneration: review.connectionGeneration,
          }, async (meta) => {
            const { data: business } = await supabase.from("businesses").select("website, locations").eq("id", actor.businessId).maybeSingle();
            const resolved = await resolveDraftTargeting(draft.input, business?.locations ?? [], meta.resolveGeoTargeting.bind(meta));
            if (resolved.unresolvedNames.length || !resolved.resolvedAreaLabel) throw new OperationPhaseError("Campaign geography could not be resolved.", { transmitted: false });
            const { location, excludedLocation } = resolved;
            const { data: creatives } = await supabase.from("creatives").select("id, image_url, headline, primary_text, cta").in("id", draft.input.creativeIds).eq("business_id", actor.businessId).eq("status", "approved");
            const byId = new Map((creatives ?? []).map((creative) => [creative.id, creative]));
            const creativeInputs = draft.input.creativeIds.map((id) => byId.get(id)).filter((creative): creative is NonNullable<typeof creative> => Boolean(creative?.image_url && creative.headline));
            if (creativeInputs.length !== draft.input.creativeIds.length) throw new OperationPhaseError("Selected creative changed before execution.", { transmitted: false });
            metaResult = await meta.createLeadCampaign({
              name: draft.input.name,
              dailyBudgetRupees: draft.input.dailyBudgetRupees,
              leadFormId: draft.input.leadFormId!,
              link: business?.website || "https://facebook.com",
              creatives: creativeInputs.map((creative) => ({ imageUrl: creative.image_url!, headline: creative.headline!, message: creative.primary_text ?? "", cta: creative.cta })),
              location,
              excludedLocation,
              ageMin: targeting.age?.min,
              ageMax: targeting.age?.max,
              variants: draft.input.abTest ? splitAgeRange(targeting.age?.min ?? 25, targeting.age?.max ?? 60).map((band) => ({ label: band.label, ageMin: band.ageMin, ageMax: band.ageMax, location, excludedLocation })) : undefined,
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
    ],
    checkpoint,
    {
      finalize: async (operation) => {
        if (!metaResult) return null;
        const adSetCount = metaResult.adSetIds.length || 1;
        const { data: campaign, error } = await supabase.from("campaigns").insert({
          business_id: actor.businessId,
          name: draft.input.name,
          objective: "leads",
          daily_budget: effectiveDailyBudget(draft.input.dailyBudgetRupees, adSetCount),
          status: "paused",
          meta_campaign_id: metaResult.campaignId,
          meta_adset_id: metaResult.adSetId,
          meta_ad_ids: metaResult.adIds,
          meta_ad_account_id: review.selected!.adAccountId,
          meta_page_id: review.selected!.pageId,
          meta_connection_generation: review.connectionGeneration,
          creative_ids: draft.input.creativeIds,
          raw: { source: "campaign_operation", metaResult } as unknown as Json,
        }).select("id").single();
        return error || !campaign ? null : { ...operation, campaignId: campaign.id };
      },
    },
  );

  return operationResponse(requestId, execution.operation, execution.kind === "succeeded" ? 200 : 202);
}
