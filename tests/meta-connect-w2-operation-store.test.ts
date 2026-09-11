import { describe, expect, it } from "vitest";
import {
  claimPersistedOperation,
  operationToDTO,
  type OperationClaimRepository,
} from "@/lib/campaign/operation-store";
import { claimOperation, type OperationRecord } from "@/lib/campaign/operations";

const request = {
  businessId: "b-1",
  idempotencyKey: "idem-1234",
  requestHash: "hash-abc",
  connectionGeneration: 2,
};

class MemoryOperationRepository implements OperationClaimRepository {
  operation: OperationRecord | null = null;
  insertCalls = 0;
  reclaimCalls = 0;
  persistInsert = true;
  persistReclaim = true;

  async findByBusinessKey(): Promise<OperationRecord | null> {
    return this.operation;
  }

  async insert(operation: OperationRecord): Promise<OperationRecord | null> {
    this.insertCalls += 1;
    if (!this.persistInsert) return null;
    this.operation = operation;
    return operation;
  }

  async reclaim(operation: OperationRecord): Promise<OperationRecord | null> {
    this.reclaimCalls += 1;
    if (!this.persistReclaim) return null;
    this.operation = operation;
    return operation;
  }
}

describe("persisted operation claim port", () => {
  it("never executes an expired row when persisting the claim failed", async () => {
    const repository = new MemoryOperationRepository();
    repository.persistReclaim = false;
    repository.operation = claimOperation(null, request, 0, 1, "op-expired").operation;
    const result = await claimPersistedOperation(repository, request, { now: 2, leaseMs: 100, operationId: "retry" });
    expect(result.kind).toBe("busy");
  });

  it("replays reconciliation returned by the database without executing", async () => {
    const operation = claimOperation(null, request, 0, 1, "op-expired").operation;
    const repository: OperationClaimRepository = {
      findByBusinessKey: async () => operation,
      insert: async () => null,
      reclaim: async () => ({ ...operation, state: "needs_reconciliation", phase: "reconcile", leaseUntil: null }),
    };
    const result = await claimPersistedOperation(repository, request, { now: 2, leaseMs: 100, operationId: "retry" });
    expect(result.kind).toBe("replay");
    expect(result.operation.state).toBe("needs_reconciliation");
  });

  it("does not adopt another caller's running claim", async () => {
    const repository: OperationClaimRepository = {
      findByBusinessKey: async () => null,
      insert: async operation => ({ ...operation, operationId: "other-owner" }),
      reclaim: async () => null,
    };
    const result = await claimPersistedOperation(repository, request, { now: 2, leaseMs: 100, operationId: "new-owner" });
    expect(result.kind).toBe("busy");
  });

  it("inserts a new claim and returns a browser-safe DTO", async () => {
    const repository = new MemoryOperationRepository();
    const result = await claimPersistedOperation(repository, request, {
      now: 1000,
      leaseMs: 30_000,
      operationId: "op-123",
    });

    expect(result.kind).toBe("claimed");
    expect(repository.insertCalls).toBe(1);
    if (result.kind !== "claimed") throw new Error("expected claim");
    expect(operationToDTO(result.operation)).toMatchObject({
      operationId: "op-123",
      businessId: "b-1",
      state: "running",
      campaignId: null,
    });
  });

  it("reclaims an expired operation through the repository port", async () => {
    const repository = new MemoryOperationRepository();
    const initial = claimOperation(null, request, 0, 100, "op-123");
    if (initial.kind !== "claimed") throw new Error("expected claim");
    repository.operation = { ...initial.operation, leaseUntil: 1 };

    const result = await claimPersistedOperation(repository, request, {
      now: 2,
      leaseMs: 30_000,
      operationId: "op-retry",
    });

    expect(result.kind).toBe("claimed");
    expect(repository.reclaimCalls).toBe(1);
    if (result.kind !== "claimed") throw new Error("expected reclaim");
    expect(result.operation.attemptCount).toBe(2);
  });

  it("returns the latest persisted decision when an atomic insert loses a race", async () => {
    const repository = new MemoryOperationRepository();
    repository.persistInsert = false;
    const existing = claimOperation(null, request, 0, 30_000, "op-existing");
    if (existing.kind !== "claimed") throw new Error("expected claim");
    repository.operation = existing.operation;

    const result = await claimPersistedOperation(repository, request, {
      now: 1,
      leaseMs: 30_000,
      operationId: "op-new",
    });

    expect(result.kind).toBe("busy");
  });
});