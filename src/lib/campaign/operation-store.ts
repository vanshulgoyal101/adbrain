import type { Blocker } from "@/lib/meta/connect-contracts";
import type { OperationDTO } from "@/lib/campaign/connect-contracts";
import type { Database, Json } from "@/lib/types";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  claimOperation,
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