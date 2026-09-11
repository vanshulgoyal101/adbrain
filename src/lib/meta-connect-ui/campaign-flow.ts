import type {
  CreateCampaignRequest,
  DraftDTO,
  OperationDTO,
  ReviewDTO,
} from "@/lib/campaign/connect-contracts";

export type OperationKey = {
  reviewKey: string;
  idempotencyKey: string;
};

export function reviewOperationKey(review: ReviewDTO): string {
  return `${review.draftId}:${review.draftVersion}:${review.planHash ?? "blocked"}:${review.connectionGeneration}`;
}

export function stableOperationKey(
  existing: OperationKey | null,
  review: ReviewDTO,
  generate: () => string,
): OperationKey {
  const reviewKey = reviewOperationKey(review);
  if (existing?.reviewKey === reviewKey) return existing;
  return { reviewKey, idempotencyKey: generate() };
}

export function buildCreateCampaignRequest(
  businessId: string,
  draft: DraftDTO,
  review: ReviewDTO,
  idempotencyKey: string,
): CreateCampaignRequest {
  if (!review.planHash) throw new Error("A reviewed plan hash is required before creation.");
  return {
    businessId,
    draftId: draft.draftId,
    draftVersion: draft.version,
    planHash: review.planHash,
    connectionGeneration: review.connectionGeneration,
    idempotencyKey,
  };
}

export function buildActivationPatch(
  confirmationDigest: string,
  connectionGeneration: number,
) {
  if (!/^[a-f0-9]{64}$/.test(confirmationDigest)) {
    throw new Error("A reviewed activation digest is required.");
  }
  return {
    status: "active" as const,
    confirmationDigest,
    connectionGeneration,
  };
}

export function canStartCreate(operation: OperationDTO | null): boolean {
  return !operation || !["pending", "running", "succeeded", "needs_reconciliation"].includes(operation.state);
}

export function isTerminalOperation(operation: OperationDTO): boolean {
  return ["succeeded", "failed", "needs_reconciliation"].includes(operation.state);
}