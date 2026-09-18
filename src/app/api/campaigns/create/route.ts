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
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return errorResponse(requestId, 401, "UNAUTHENTICATED", "Sign in required.");

  const parsed = createCampaignRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(requestId, 400, "INVALID_INPUT", "Campaign creation request is invalid.");
  const input = parsed.data;
  if (process.env.CAMPAIGN_EXECUTION_MODE && !["inline", "worker"].includes(process.env.CAMPAIGN_EXECUTION_MODE)) {
    return errorResponse(requestId, 503, "UNAVAILABLE", "Campaign execution mode is not configured correctly.");
  }

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
  if (!review.canCreatePaused || !review.planHash || !review.selected || !review.resolvedLocation) return errorResponse(requestId, 400, "PREFLIGHT_BLOCKED", "Campaign preparation is blocked. Resolve the review blockers before creating.");
  if (review.planHash !== input.planHash) return errorResponse(requestId, 409, "CONFLICT", "Campaign review changed. Review again before creating.", true);
  if (review.connectionGeneration !== input.connectionGeneration) return errorResponse(requestId, 409, "CONFLICT", "Meta connection changed. Review again before creating.", true);

  let operationDb;
  try {
    operationDb = createAdminClient();
  } catch {
    return errorResponse(requestId, 503, "UNAVAILABLE", "Campaign operation storage is unavailable.", true);
  }
  let claim;
  if (process.env.CAMPAIGN_EXECUTION_MODE === "worker") {
    try {
      const queued = await enqueueCampaignOperation(operationDb, input, requestHash);
      if (queued.requestHash !== requestHash || queued.connectionGeneration !== input.connectionGeneration) {
        return errorResponse(requestId, 409, "CONFLICT", "This idempotency key was used for a different campaign request.");
      }
      return operationResponse(requestId, queued, 202);
    } catch {
      return errorResponse(requestId, 503, "UNAVAILABLE", "Campaign queue is unavailable. No inline fallback was attempted.", true);
    }
  }
  try {
    claim = await claimPersistedOperation(
      createOperationRepository(operationDb, input.draftId, input.draftVersion, input.connectionGeneration),
      { businessId: actor.businessId, idempotencyKey: input.idempotencyKey, requestHash, connectionGeneration: input.connectionGeneration },
      { now: Date.now(), leaseMs: 60_000, operationId: crypto.randomUUID() },
    );
  } catch {
    return errorResponse(requestId, 503, "UNAVAILABLE", "Campaign operation storage is unavailable.", true);
  }
  if (claim.kind === "conflict") return errorResponse(requestId, 409, "CONFLICT", "This idempotency key was used for a different campaign request.");
  if (claim.kind === "busy") return errorResponse(requestId, 409, "CONFLICT", "This campaign operation is already running.", true);
  if (claim.kind === "replay") return operationResponse(requestId, claim.operation, 200);

  const execution = await executeReviewedCampaign({
    database: supabase, operationDatabase: operationDb, actor, draft, review, operation: claim.operation,
  });

  return operationResponse(requestId, execution.operation, execution.kind === "succeeded" ? 200 : 202);
}
