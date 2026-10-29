import { observeRoute, recordProductEvent, currentRequestId } from "@/lib/observability/logger";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createCampaignRequestSchema, type OperationDTO } from "@/lib/campaign/connect-contracts";
import { draftRecordFromRow, isDraftExpired } from "@/lib/campaign/draft-store";
import { buildCampaignPreflightLoaders } from "@/lib/campaign/preflight-runtime";
import { prepareCampaignReview } from "@/lib/campaign/preflight-service";
import type { OperationRecord } from "@/lib/campaign/operations";
import { executeReviewedCampaign } from "@/lib/campaign/create-service";
import {
  claimPersistedOperation,
  createOperationRepository,
  enqueueCampaignOperation,
  getPersistedOperationStatus,
  operationToDTO,
} from "@/lib/campaign/operation-store";
import { ConnectionAccessError, requireOwnedBusiness } from "@/lib/meta/connection-access";
import { BUSINESS_ACCESS_ERRORS } from "@/i18n/locale";
import { ownerWords } from "@/i18n/request-locale";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type ErrorCode = "UNAUTHENTICATED" | "NOT_FOUND" | "FORBIDDEN" | "INVALID_INPUT" | "CONFLICT" | "PREFLIGHT_BLOCKED" | "UNAVAILABLE";

function errorResponse(requestId: string, status: number, code: ErrorCode, message: string, retryable = false) {
  return NextResponse.json({ ok: false, error: { code, message, retryable }, requestId }, { status });
}

function operationResponse(requestId: string, operation: OperationRecord, status: number) {
  recordProductEvent({ kind: "workflow", name: `campaign.operation.${operation.state}`, businessId: operation.businessId,
    outcome: operation.state === "failed" ? "failed" : operation.state === "needs_reconciliation" ? "partial" : operation.state === "succeeded" ? "success" : "started",
    attributes: { count: operation.externalIds.length } });
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

export const POST = observeRoute("/api/campaigns/create", "POST", handlePOST);

async function handlePOST(request: Request) {
  const requestId = currentRequestId();
  const say = await ownerWords();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return errorResponse(requestId, 401, "UNAUTHENTICATED", say("signInRequired"));

  const parsed = createCampaignRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(requestId, 400, "INVALID_INPUT", say("createRequestInvalid"));
  const input = parsed.data;
  if (process.env.CAMPAIGN_EXECUTION_MODE && !["inline", "worker"].includes(process.env.CAMPAIGN_EXECUTION_MODE)) {
    return errorResponse(requestId, 503, "UNAVAILABLE", say("executionModeMisconfigured"));
  }

  let actor;
  try {
    actor = await requireOwnedBusiness(input.businessId);
  } catch (error) {
    if (error instanceof ConnectionAccessError) {
      const status = error.code === "UNAUTHENTICATED" ? 401 : error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : 503;
      return errorResponse(requestId, status, status === 401 ? "UNAUTHENTICATED" : status === 403 ? "FORBIDDEN" : status === 404 ? "NOT_FOUND" : "UNAVAILABLE", say(status >= 500 ? "businessAccessUnchecked" : BUSINESS_ACCESS_ERRORS[error.code]), status >= 500);
    }
    return errorResponse(requestId, 503, "UNAVAILABLE", say("businessAccessUnchecked"), true);
  }

  const requestHash = operationRequestHash(input);
  const { data: existingOperationRow, error: existingOperationError } = await supabase
    .from("campaign_operations")
    .select("*")
    .eq("business_id", actor.businessId)
    .eq("kind", "campaign_create")
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();
  if (existingOperationError) return errorResponse(requestId, 503, "UNAVAILABLE", say("operationStorageUnavailable"), true);
  if (existingOperationRow) {
    let existingOperation;
    try {
      existingOperation = await getPersistedOperationStatus(existingOperationRow);
    } catch {
      return errorResponse(requestId, 503, "UNAVAILABLE", say("operationStorageUnavailable"), true);
    }
    if (existingOperation.requestHash !== requestHash || existingOperation.connectionGeneration !== input.connectionGeneration) {
      return errorResponse(requestId, 409, "CONFLICT", say("requestKeyReused"));
    }
    if (["succeeded", "failed", "needs_reconciliation"].includes(existingOperation.state)) {
      return operationResponse(requestId, existingOperation, 200);
    }
    if (existingOperation.leaseUntil !== null && existingOperation.leaseUntil > Date.now()) {
      return errorResponse(requestId, 409, "CONFLICT", say("createAlreadyRunning"), true);
    }
  }

  const { data: draftRow, error: draftError } = await supabase.from("campaign_drafts")
    .select("*")
    .eq("id", input.draftId)
    .eq("business_id", actor.businessId)
    .eq("owner_id", actor.userId)
    .maybeSingle();
  // #2333: a draft that's gone or not theirs says what to do, as on Review (preflight).
  if (draftError || !draftRow) return errorResponse(requestId, 404, "NOT_FOUND", say("draftGone"));
  const draft = draftRecordFromRow(draftRow);
  const now = new Date().toISOString();
  if (isDraftExpired(draft.expiresAt, now)) return errorResponse(requestId, 404, "NOT_FOUND", say("draftGone"));
  if (draft.version !== input.draftVersion) return errorResponse(requestId, 409, "CONFLICT", say("draftChangedElsewhere"), true);

  let reviewResult;
  try {
    reviewResult = await prepareCampaignReview(buildCampaignPreflightLoaders(supabase, actor), {
      actor,
      draftId: input.draftId,
      requestedDraftVersion: input.draftVersion,
      now,
    });
  } catch (error) {
    // #681: a Meta read failing mid-review (Page, WhatsApp number, areas) is a retry, as on the preflight route, not a 500.
    if (error instanceof ConnectionAccessError && error.code === "CONFLICT") return errorResponse(requestId, 409, "CONFLICT", error.message, true);
    return errorResponse(requestId, 503, "UNAVAILABLE", say("reviewCheckFailed"), true);
  }
  if (reviewResult.kind === "not_found") return errorResponse(requestId, 404, "NOT_FOUND", say("draftGone"));
  if (reviewResult.kind === "forbidden") return errorResponse(requestId, 403, "FORBIDDEN", say("draftGone"));
  if (reviewResult.kind === "stale") return errorResponse(requestId, 409, "CONFLICT", say("draftChangedElsewhere"), true);
  const review = reviewResult.review;
  if (!review.canCreatePaused || !review.planHash || !review.selected || !review.resolvedLocation) return errorResponse(requestId, 400, "PREFLIGHT_BLOCKED", say("reviewBlockersFirst"));
  if (review.planHash !== input.planHash) return errorResponse(requestId, 409, "CONFLICT", say("reviewChangedBeforeCreate"), true);
  if (review.connectionGeneration !== input.connectionGeneration) return errorResponse(requestId, 409, "CONFLICT", say("metaConnectionChanged"), true);

  let operationDb;
  try {
    operationDb = createAdminClient();
  } catch {
    return errorResponse(requestId, 503, "UNAVAILABLE", say("operationStorageUnavailable"), true);
  }
  let claim;
  if (process.env.CAMPAIGN_EXECUTION_MODE === "worker") {
    try {
      const queued = await enqueueCampaignOperation(operationDb, input, requestHash);
      if (queued.requestHash !== requestHash || queued.connectionGeneration !== input.connectionGeneration) {
        return errorResponse(requestId, 409, "CONFLICT", say("requestKeyReused"));
      }
      return operationResponse(requestId, queued, 202);
    } catch {
      return errorResponse(requestId, 503, "UNAVAILABLE", say("campaignQueueUnavailable"), true);
    }
  }
  try {
    claim = await claimPersistedOperation(
      createOperationRepository(operationDb, input.draftId, input.draftVersion, input.connectionGeneration),
      { businessId: actor.businessId, idempotencyKey: input.idempotencyKey, requestHash, connectionGeneration: input.connectionGeneration },
      { now: Date.now(), leaseMs: 60_000, operationId: crypto.randomUUID() },
    );
  } catch {
    return errorResponse(requestId, 503, "UNAVAILABLE", say("operationStorageUnavailable"), true);
  }
  if (claim.kind === "conflict") return errorResponse(requestId, 409, "CONFLICT", say("requestKeyReused"));
  if (claim.kind === "busy") return errorResponse(requestId, 409, "CONFLICT", say("createAlreadyRunning"), true);
  if (claim.kind === "replay") return operationResponse(requestId, claim.operation, 200);

  const execution = await executeReviewedCampaign({
    database: supabase, operationDatabase: operationDb, actor, draft, review, operation: claim.operation,
  });

  return operationResponse(requestId, execution.operation, execution.kind === "succeeded" ? 200 : 202);
}
