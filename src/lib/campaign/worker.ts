import { createHash } from "node:crypto";
import { z } from "zod";
import { createCampaignRequestSchema } from "./connect-contracts";
import { draftRecordFromRow } from "./draft-store";
import { executeReviewedCampaign } from "./create-service";
import { createOperationCheckpoint, operationRecordFromRow } from "./operation-store";
import { markFailed } from "./operations";
import { buildCampaignPreflightLoaders, type CampaignSupabase } from "./preflight-runtime";
import { prepareCampaignReview } from "./preflight-service";
import { requireCampaignWorkerActor } from "@/lib/meta/connection-access";
import type { Database } from "@/lib/types";

const jobSchema = z.object({ execution: z.literal("worker"), request: createCampaignRequestSchema }).strict();
type OperationRow = Database["public"]["Tables"]["campaign_operations"]["Row"];

export async function runCampaignJob(database: CampaignSupabase, row: OperationRow, signal: AbortSignal) {
  const operation = operationRecordFromRow(row);
  let executionStarted = false;
  try {
    signal.throwIfAborted();
    const { request } = jobSchema.parse(row.payload);
    if (request.businessId !== row.business_id || request.draftId !== row.draft_id || request.draftVersion !== row.draft_version || request.connectionGeneration !== row.connection_generation
      || request.idempotencyKey !== row.idempotency_key || createHash("sha256").update(JSON.stringify(request)).digest("hex") !== row.request_hash) {
      throw new Error("Queued request does not match the claimed operation.");
    }
    const actor = await requireCampaignWorkerActor(operation.operationId);
    const { data: draftRow, error } = await database.from("campaign_drafts").select("*")
      .eq("id", request.draftId).eq("business_id", actor.businessId).eq("owner_id", actor.userId).maybeSingle();
    if (error || !draftRow) throw new Error("Queued draft could not be loaded.");
    const result = await prepareCampaignReview(buildCampaignPreflightLoaders(database, actor), {
      actor, draftId: request.draftId, requestedDraftVersion: request.draftVersion, now: new Date().toISOString(),
    });
    signal.throwIfAborted();
    if (result.kind !== "review" || !result.review.canCreatePaused || !result.review.selected || !result.review.resolvedLocation
      || result.review.planHash !== request.planHash || result.review.connectionGeneration !== request.connectionGeneration) {
      throw new Error("Queued campaign review is stale or blocked. Review again before creating.");
    }
    executionStarted = true;
    return await executeReviewedCampaign({
      database, operationDatabase: database, actor, draft: draftRecordFromRow(draftRow),
      review: result.review, operation, signal,
    });
  } catch (error) {
    if (executionStarted) throw error;
    const failed = markFailed(operation, "Queued campaign could not pass current ownership and review checks. Review again before creating.");
    const saved = await createOperationCheckpoint(database, operation).checkpoint(failed);
    if (!saved) throw new Error("Worker could not persist the rejected operation.");
    return { kind: "failed" as const, operation: saved };
  }
}

export async function runNextCampaignJob(database: CampaignSupabase, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted();
  const { data, error } = await database.rpc("claim_next_campaign_job", {});
  if (error) throw new Error("Campaign worker queue is unavailable.");
  const row = data?.[0];
  if (!row) return false;
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(8 * 60_000)]);
  const result = await runCampaignJob(database, row, deadline);
  console.info(JSON.stringify({ event: "campaign.worker.completed", operationId: row.id, state: result.operation.state }));
  return true;
}