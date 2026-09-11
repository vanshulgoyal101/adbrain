import type { OperationDTO } from "@/lib/campaign/connect-contracts";

export type OperationState = OperationDTO["state"];

export interface OperationRecord {
  operationId: string;
  businessId: string;
  kind: "campaign_create";
  idempotencyKey: string;
  requestHash: string;
  connectionGeneration: number;
  state: OperationState;
  phase: "campaign" | "adset" | "creative" | "ad" | "reconcile" | "complete";
  leaseUntil: number | null;
  attemptCount: number;
  campaignId: string | null;
  externalIds: string[];
  sanitizedError: string | null;
}

export type OperationDecision =
  | { kind: "claimed"; operation: OperationRecord }
  | { kind: "replay"; operation: OperationRecord }
  | { kind: "conflict"; operation: OperationRecord }
  | { kind: "busy"; operation: OperationRecord };

export type OperationPhase = OperationRecord["phase"];

export class OperationPhaseError extends Error {
  readonly transmitted: boolean;

  constructor(message: string, options: { transmitted: boolean }) {
    super(message);
    this.name = "OperationPhaseError";
    this.transmitted = options.transmitted;
  }
}

export type OperationStepResult = {
  externalIds: string[];
  campaignId?: string;
};

export type OperationStep = {
  phase: Exclude<OperationPhase, "reconcile" | "complete">;
  run: () => Promise<OperationStepResult>;
};

export interface OperationCheckpointPort {
  checkpoint(operation: OperationRecord): Promise<OperationRecord | null>;
}

export type OperationExecutionResult =
  | { kind: "succeeded" | "failed" | "needs_reconciliation" | "replay" | "blocked"; operation: OperationRecord };

export type OperationFinalize = (
  operation: OperationRecord,
) => Promise<OperationRecord | null>;

export function claimOperation(
  existing: OperationRecord | null,
  request: Pick<OperationRecord, "businessId" | "idempotencyKey" | "requestHash" | "connectionGeneration">,
  now: number,
  leaseMs: number,
  operationId: string,
): OperationDecision {
  if (existing) {
    if (existing.businessId !== request.businessId || existing.idempotencyKey !== request.idempotencyKey || existing.requestHash !== request.requestHash || existing.connectionGeneration !== request.connectionGeneration) {
      return { kind: "conflict", operation: existing };
    }
    if (["succeeded", "failed", "needs_reconciliation"].includes(existing.state)) {
      return { kind: "replay", operation: existing };
    }
    if (existing.leaseUntil !== null && existing.leaseUntil > now) {
      return { kind: "busy", operation: existing };
    }
    return {
      kind: "claimed",
      operation: { ...existing, state: "running", leaseUntil: now + leaseMs, attemptCount: existing.attemptCount + 1 },
    };
  }

  return {
    kind: "claimed",
    operation: {
      operationId,
      businessId: request.businessId,
      kind: "campaign_create",
      idempotencyKey: request.idempotencyKey,
      requestHash: request.requestHash,
      connectionGeneration: request.connectionGeneration,
      state: "running",
      phase: "campaign",
      leaseUntil: now + leaseMs,
      attemptCount: 1,
      campaignId: null,
      externalIds: [],
      sanitizedError: null,
    },
  };
}

export function recordExternalId(operation: OperationRecord, externalId: string): OperationRecord {
  if (!externalId || operation.externalIds.includes(externalId)) return operation;
  return { ...operation, externalIds: [...operation.externalIds, externalId] };
}

export function sanitizeOperationError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(access[_ -]?token|api[_ -]?key|password|secret|credential)([=: ]+)[^\s&]+/gi, "$1$2[redacted]")
    .slice(0, 240);
}

export function markNeedsReconciliation(operation: OperationRecord, error: string): OperationRecord {
  return { ...operation, state: "needs_reconciliation", phase: "reconcile", leaseUntil: null, sanitizedError: sanitizeOperationError(error) };
}

export function markFailed(operation: OperationRecord, error: string): OperationRecord {
  return { ...operation, state: "failed", phase: "complete", leaseUntil: null, sanitizedError: sanitizeOperationError(error) };
}

export function finishOperation(operation: OperationRecord, campaignId: string): OperationRecord {
  return { ...operation, state: "succeeded", phase: "complete", leaseUntil: null, campaignId, sanitizedError: null };
}

const executablePhases: Array<Exclude<OperationPhase, "reconcile" | "complete">> = [
  "campaign",
  "adset",
  "creative",
  "ad",
];

function nextPhase(phase: OperationStep["phase"]): OperationPhase {
  const index = executablePhases.indexOf(phase);
  return executablePhases[index + 1] ?? "complete";
}

async function persistCheckpoint(
  checkpoint: OperationCheckpointPort,
  operation: OperationRecord,
): Promise<OperationRecord | null> {
  try {
    return await checkpoint.checkpoint(operation);
  } catch {
    return null;
  }
}

export async function executeOperation(
  operation: OperationRecord,
  steps: readonly OperationStep[],
  checkpoint: OperationCheckpointPort,
  options: { finalize?: OperationFinalize } = {},
): Promise<OperationExecutionResult> {
  if (operation.state === "succeeded" || operation.state === "failed" || operation.state === "needs_reconciliation") {
    return { kind: "replay", operation };
  }
  if (operation.state !== "running" || operation.phase === "reconcile" || operation.phase === "complete") {
    return { kind: "blocked", operation };
  }

  const startIndex = executablePhases.indexOf(operation.phase);
  if (startIndex < 0) {
    const failed = markFailed(operation, "Operation phase is invalid.");
    return { kind: "failed", operation: (await persistCheckpoint(checkpoint, failed)) ?? failed };
  }

  let current = operation;
  for (const step of executablePhases.slice(startIndex).map((phase) => steps.find((candidate) => candidate.phase === phase))) {
    if (!step) {
      const reconciled = markNeedsReconciliation(current, "Operation phase transport is unavailable.");
      return { kind: "needs_reconciliation", operation: (await persistCheckpoint(checkpoint, reconciled)) ?? reconciled };
    }
    try {
      const result = await step.run();
      current = {
        ...current,
        campaignId: result.campaignId ?? current.campaignId,
        phase: step.phase,
      };
      for (const externalId of result.externalIds) {
        current = recordExternalId(current, externalId);
        const saved = await persistCheckpoint(checkpoint, current);
        if (!saved) {
          const reconciled = markNeedsReconciliation(current, "Operation lease was lost while saving an external ID.");
          return { kind: "needs_reconciliation", operation: reconciled };
        }
        current = saved;
      }
      current = { ...current, phase: nextPhase(step.phase) };
      const saved = await persistCheckpoint(checkpoint, current);
      if (!saved) {
        const reconciled = markNeedsReconciliation(current, "Operation lease was lost before the next phase.");
        return { kind: "needs_reconciliation", operation: reconciled };
      }
      current = saved;
    } catch (error) {
      const reconciled = error instanceof OperationPhaseError && !error.transmitted && current.externalIds.length === 0
        ? markFailed(current, error.message)
        : markNeedsReconciliation(current, sanitizeOperationError(error));
      const saved = await persistCheckpoint(checkpoint, reconciled);
      return {
        kind: reconciled.state === "failed" ? "failed" : "needs_reconciliation",
        operation: saved ?? reconciled,
      };
    }
  }

  let finalized = current;
  if (options.finalize) {
    try {
      finalized = (await options.finalize(current)) ?? current;
    } catch {
      const reconciled = markNeedsReconciliation(current, "Local campaign save could not be persisted.");
      return { kind: "needs_reconciliation", operation: (await persistCheckpoint(checkpoint, reconciled)) ?? reconciled };
    }
    if (!finalized.campaignId) {
      const reconciled = markNeedsReconciliation(finalized, "Local campaign save could not be persisted.");
      return { kind: "needs_reconciliation", operation: (await persistCheckpoint(checkpoint, reconciled)) ?? reconciled };
    }
  }
  if (!finalized.campaignId) {
    const reconciled = markNeedsReconciliation(finalized, "Campaign creation returned no campaign ID.");
    return { kind: "needs_reconciliation", operation: (await persistCheckpoint(checkpoint, reconciled)) ?? reconciled };
  }
  const finished = finishOperation(finalized, finalized.campaignId);
  const saved = await persistCheckpoint(checkpoint, finished);
  if (!saved) {
    const reconciled = markNeedsReconciliation(finished, "Final operation result could not be persisted.");
    return { kind: "needs_reconciliation", operation: (await persistCheckpoint(checkpoint, reconciled)) ?? reconciled };
  }
  return { kind: "succeeded", operation: saved };
}