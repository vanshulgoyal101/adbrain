import type { Blocker } from "@/lib/meta/connect-contracts";
import type { OperationDTO, CreateCampaignRequest } from "@/lib/campaign/connect-contracts";
import type { Database, Json } from "@/lib/types";
import { createAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";
import {
  claimOperation,
  type OperationCheckpointPort,
  type OperationRecord,
} from "@/lib/campaign/operations";

export type OperationRequest = Pick<
  OperationRecord,
  "businessId" | "idempotencyKey" | "requestHash" | "connectionGeneration"
>;

export interface OperationClaimRepository {
  findByBusinessKey(
    request: OperationRequest,
  ): Promise<OperationRecord | null>;
  insert(operation: OperationRecord): Promise<OperationRecord | null>;
  reclaim(operation: OperationRecord): Promise<OperationRecord | null>;
}

export type OperationClaimResult =
  | { kind: "claimed"; operation: OperationRecord }
  | { kind: "replay"; operation: OperationRecord }
  | { kind: "busy"; operation: OperationRecord }
  | { kind: "conflict"; operation: OperationRecord };

type OperationRow = Database["public"]["Tables"]["campaign_operations"]["Row"];

type OperationDatabase = Awaited<ReturnType<typeof createClient>>;

export async function enqueueCampaignOperation(database: OperationDatabase, input: CreateCampaignRequest, requestHash: string) {
  const { data, error } = await database.rpc("enqueue_campaign_operation", {
    p_operation_id: crypto.randomUUID(), p_input: input as unknown as Json, p_request_hash: requestHash,
  });
  if (error || !data?.[0]) throw new Error("Campaign queue is unavailable.");
  return operationRecordFromRow(data[0]);
}

export function createOperationRepository(
  database: OperationDatabase,
  draftId: string,
  draftVersion: number,
  connectionGeneration: number,
): OperationClaimRepository {
  const findByBusinessKey = async (request: OperationRequest) => {
    const { data, error } = await database.from("campaign_operations").select("*")
      .eq("business_id", request.businessId).eq("kind", "campaign_create")
      .eq("idempotency_key", request.idempotencyKey).maybeSingle();
    if (error) throw new Error("Campaign operation storage is unavailable.");
    return data ? operationRecordFromRow(data) : null;
  };
  const persistClaim = async (operation: OperationRecord) => {
    const { data, error } = await database.rpc("claim_campaign_operation", {
      p_operation_id: operation.operationId, p_business_id: operation.businessId,
      p_draft_id: draftId, p_draft_version: draftVersion,
      p_connection_generation: connectionGeneration, p_kind: "campaign_create",
      p_idempotency_key: operation.idempotencyKey, p_request_hash: operation.requestHash,
      p_lease_until: new Date(operation.leaseUntil ?? Date.now() + 60_000).toISOString(),
      p_payload: {} as Json, p_now: new Date().toISOString(),
    });
    return error || !data?.[0] ? null : operationRecordFromRow(data[0]);
  };
  return { findByBusinessKey, insert: persistClaim, reclaim: persistClaim };
}

export function createOperationCheckpoint(database: OperationDatabase, initial: OperationRecord): OperationCheckpointPort {
  let latest = initial;
  const phaseRank: Record<OperationRecord["phase"], number> = {
    campaign: 0, adset: 1, creative: 2, ad: 3, reconcile: 4, complete: 5,
  };
  function merge(operation: OperationRecord): OperationRecord {
    return {
      ...operation,
      externalIds: [...new Set([...operation.externalIds, ...latest.externalIds])],
      phase: operation.state === "running" && phaseRank[latest.phase] > phaseRank[operation.phase] ? latest.phase : operation.phase,
      campaignId: operation.campaignId ?? latest.campaignId,
    };
  }
  return {
    checkpoint: async operation => {
      const durable = merge(operation);
      latest = durable;
      const result = durable.state === "succeeded"
        ? await database.rpc("finish_campaign_operation", {
          p_operation_id: durable.operationId, p_business_id: durable.businessId,
          p_connection_generation: durable.connectionGeneration, p_campaign_id: durable.campaignId!,
          p_result: { externalIds: durable.externalIds, campaignId: durable.campaignId }, p_now: new Date().toISOString(),
        })
        : durable.state === "failed" || durable.state === "needs_reconciliation"
          ? await database.rpc("fail_campaign_operation", {
            p_operation_id: durable.operationId, p_business_id: durable.businessId,
            p_connection_generation: durable.connectionGeneration, p_state: durable.state,
            p_external_ids: durable.externalIds, p_campaign_id: durable.campaignId, p_error: durable.sanitizedError,
          })
          : await database.rpc("checkpoint_campaign_operation", {
            p_operation_id: durable.operationId, p_business_id: durable.businessId,
            p_connection_generation: durable.connectionGeneration, p_phase: durable.phase,
            p_lease_until: durable.leaseUntil === null ? null : new Date(durable.leaseUntil).toISOString(),
            p_external_ids: durable.externalIds, p_now: new Date().toISOString(),
          });
      if (result.error || !result.data?.[0]) return null;
      latest = merge(operationRecordFromRow(result.data[0]));
      return latest;
    },
  };
}

function stringArray(value: Json): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function operationRecordFromRow(row: OperationRow): OperationRecord {
  return {
    operationId: row.id,
    businessId: row.business_id,
    kind: row.kind,
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    connectionGeneration: row.connection_generation,
    state: row.state,
    phase: row.phase,
    leaseUntil: row.lease_until ? Date.parse(row.lease_until) : null,
    attemptCount: row.attempt_count,
    campaignId: row.campaign_id,
    externalIds: stringArray(row.external_ids),
    sanitizedError: row.sanitized_error,
  };
}

export async function claimPersistedOperation(
  repository: OperationClaimRepository,
  request: OperationRequest,
  options: { now: number; leaseMs: number; operationId: string },
): Promise<OperationClaimResult> {
  const existing = await repository.findByBusinessKey(request);
  const decision = claimOperation(
    existing,
    request,
    options.now,
    options.leaseMs,
    options.operationId,
  );
  if (decision.kind !== "claimed") return decision;

  const persisted = existing
    ? await repository.reclaim(decision.operation)
    : await repository.insert(decision.operation);
  if (persisted) {
    const persistedDecision = claimOperation(persisted, request, options.now, options.leaseMs, options.operationId);
    if (persistedDecision.kind === "conflict" || persistedDecision.kind === "replay") return persistedDecision;
    if (persisted.operationId !== decision.operation.operationId
      || persisted.attemptCount !== decision.operation.attemptCount
      || persisted.state !== "running") {
      return { kind: "busy", operation: persisted };
    }
    return { kind: "claimed", operation: persisted };
  }

  const latest = await repository.findByBusinessKey(request);
  if (latest) {
    const retryDecision = claimOperation(
      latest,
      request,
      options.now,
      options.leaseMs,
      options.operationId,
    );
    return retryDecision.kind === "claimed" ? { kind: "busy", operation: latest } : retryDecision;
  }
  return { kind: "conflict", operation: decision.operation };
}

export async function getPersistedOperationStatus(row: OperationRow): Promise<OperationRecord> {
  const operation = operationRecordFromRow(row);
  if (!["pending", "running"].includes(operation.state)
    || (operation.leaseUntil !== null && operation.leaseUntil > Date.now())) return operation;
  const { data, error } = await createAdminClient().rpc("expire_campaign_operation", {
    p_operation_id: operation.operationId,
    p_business_id: operation.businessId,
  });
  if (error || !data?.[0]) throw new Error("Campaign operation status could not be recovered.");
  return operationRecordFromRow(data[0]);
}

export function operationToDTO(
  operation: OperationRecord,
  blockers: Blocker[] = operation.state === "needs_reconciliation" ? [{
    code: "RECONCILIATION_REQUIRED",
    message: "Campaign creation needs reconciliation before it can be retried.",
    action: { kind: "contact_admin" },
  }] : [],
): OperationDTO {
  return {
    operationId: operation.operationId,
    businessId: operation.businessId,
    state: operation.state,
    campaignId: operation.campaignId,
    blockers,
  };
}