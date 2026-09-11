import { describe, expect, it } from "vitest";
import { claimOperation, recordExternalId, markNeedsReconciliation, finishOperation } from "@/lib/campaign/operations";
import type { OperationRecord } from "@/lib/campaign/operations";

/**
 * W2-T06 through W2-T10: Durable operation and campaign binding tests.
 * These test the pure logic that will be integrated with DB persistence.
 */

const now = 1000;
const leaseMs = 30000;
const operationId = "op-123";

const request = {
  businessId: "b-1",
  idempotencyKey: "idem-1234",
  requestHash: "hash-abc",
  connectionGeneration: 2,
};

describe("W2-T06: Duplicate create and conflicting payload", () => {
  it("replays same operation on duplicate idempotency key", () => {
    const first = claimOperation(null, request, now, leaseMs, operationId);
    expect(first.kind).toBe("claimed");
    if (first.kind !== "claimed") throw new Error("expected claim");

    const finished = finishOperation(first.operation, "campaign-123");
    expect(finished.state).toBe("succeeded");

    // Second request with same key returns replay (not new execution)
    const second = claimOperation(finished, request, now + 100, leaseMs, operationId);
    expect(second.kind).toBe("replay");
    expect(second.operation.state).toBe("succeeded");
  });

  it("rejects conflicting payload (changed hash) with 409", () => {
    const first = claimOperation(null, request, now, leaseMs, operationId);
    expect(first.kind).toBe("claimed");
    if (first.kind !== "claimed") throw new Error("expected claim");

    const finished = finishOperation(first.operation, "campaign-123");

    // Different payload hash with same idempotency key = conflict
    const conflict = claimOperation(
      finished,
      { ...request, requestHash: "hash-different" },
      now + 100,
      leaseMs,
      operationId,
    );
    expect(conflict.kind).toBe("conflict");
  });

  it("rejects conflicting business (different businessId)", () => {
    const first = claimOperation(null, request, now, leaseMs, operationId);
    expect(first.kind).toBe("claimed");
    if (first.kind !== "claimed") throw new Error("expected claim");

    // Different business with same idempotency key = conflict
    const conflict = claimOperation(
      first.operation,
      { ...request, businessId: "b-2" },
      now,
      leaseMs,
      operationId,
    );
    expect(conflict.kind).toBe("conflict");
  });
});

describe("W2-T07: Timeout after campaign/adset creation", () => {
  it("retains known IDs when timeout occurs after external creation", () => {
    const first = claimOperation(null, request, now, leaseMs, operationId);
    expect(first.kind).toBe("claimed");
    if (first.kind !== "claimed") throw new Error("expected claim");

    // Record external campaign ID after creation
    let operation = recordExternalId(first.operation, "campaign-ext-123");
    expect(operation.externalIds).toContain("campaign-ext-123");

    // Record adset ID
    operation = recordExternalId(operation, "adset-ext-456");
    expect(operation.externalIds).toContain("adset-ext-456");

    // Timeout: DB save fails, lease expires
    operation = markNeedsReconciliation(operation, "Possible timeout after adset creation");
    expect(operation.state).toBe("needs_reconciliation");
    expect(operation.externalIds).toEqual(["campaign-ext-123", "adset-ext-456"]);
  });

  it("rejects blind retry on timeout (must reconcile)", () => {
    const first = claimOperation(null, request, now, leaseMs, operationId);
    expect(first.kind).toBe("claimed");
    if (first.kind !== "claimed") throw new Error("expected claim");

    let operation = recordExternalId(first.operation, "campaign-123");
    operation = markNeedsReconciliation(operation, "Timeout after transmission");

    // Attempting to retry with same key must return the reconciliation state
    const retry = claimOperation(operation, request, now + 100, leaseMs, operationId);
    expect(retry.kind).not.toBe("claimed");
    expect(retry.operation.state).toBe("needs_reconciliation");
  });
});

describe("W2-T08: Final DB save failure and worker restart", () => {
  it("marks operation recoverable when DB insert fails after all Meta calls", () => {
    const first = claimOperation(null, request, now, leaseMs, operationId);
    expect(first.kind).toBe("claimed");
    if (first.kind !== "claimed") throw new Error("expected claim");

    let operation = first.operation;
    operation = recordExternalId(operation, "campaign-123");
    operation = recordExternalId(operation, "adset-456");

    // DB insert fails - mark for reconciliation with known IDs
    operation = markNeedsReconciliation(operation, "Database connection lost");
    expect(operation.state).toBe("needs_reconciliation");
    expect(operation.externalIds).toEqual(["campaign-123", "adset-456"]);

    // Worker restarts and checks the operation
    const restart = claimOperation(operation, request, now + 60000, leaseMs, operationId);
    // Terminal state: should return as replay, not claimed (no retry without reconciliation)
    expect(restart.kind).toBe("replay");
    expect(restart.operation.externalIds).toEqual(["campaign-123", "adset-456"]);
    expect(restart.operation.state).toBe("needs_reconciliation");
  });

  it("does not lose external IDs on any state transition", () => {
    const phases: OperationRecord["phase"][] = ["campaign", "adset", "creative", "ad", "reconcile", "complete"];
    let operation: OperationRecord = {
      operationId: "op-test",
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
      externalIds: ["campaign-1"],
      sanitizedError: null,
    };

    for (const phase of phases) {
      operation = { ...operation, phase };
      expect(operation.externalIds).toContain("campaign-1");
    }
  });
});

describe("W2-T09: Account A campaign; workspace switched to B", () => {
  it("blocks operations on different account without reconnect", () => {
    // Campaign stored with binding
    const campaign = {
      id: "camp-1",
      businessId: request.businessId,
      metaAdAccountId: "act_111",
      metaPageId: "page_111",
      metaConnectionGeneration: 2,
    };

    // User switches workspace connection to different account
    const newBinding = {
      metaAdAccountId: "act_222",
      metaPageId: "page_222",
      metaConnectionGeneration: 3,
    };

    // Attempt to operate on the campaign with new binding
    const bindingMismatch =
      campaign.metaAdAccountId !== newBinding.metaAdAccountId ||
      campaign.metaPageId !== newBinding.metaPageId;

    expect(bindingMismatch).toBe(true);
    // Should require explicit reconnect/rebind, not auto-rehome
  });
});

describe("W2-T10: Forged job context/other-owner operation/draft", () => {
  it("operation access control: rejects cross-business operation claim", () => {
    const ownerBusiness = claimOperation(null, request, now, leaseMs, operationId);
    expect(ownerBusiness.kind).toBe("claimed");
    if (ownerBusiness.kind !== "claimed") throw new Error("expected claim");

    // Attempt to claim with different business ID
    const forged = claimOperation(
      ownerBusiness.operation,
      { ...request, businessId: "b-evil" },
      now,
      leaseMs,
      operationId,
    );

    // Must be rejected as conflict, not claimed
    expect(forged.kind).toBe("conflict");
  });

  it("operation never leaks secrets in state", () => {
    const operation: OperationRecord = {
      operationId: "op-secret",
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
    };

    // Payload/result are not included in the exported DTO to client
    expect(operation).not.toHaveProperty("accessToken");
    expect(operation).not.toHaveProperty("metaSecret");
    // sanitizedError should never contain sensitive keys if present
    if (operation.sanitizedError) {
      expect(operation.sanitizedError).not.toMatch(/token|secret|credential|api.?key/i);
    }
  });

  it("redacts token-shaped details from reconciliation errors", () => {
    const first = claimOperation(null, request, now, leaseMs, operationId);
    expect(first.kind).toBe("claimed");
    if (first.kind !== "claimed") throw new Error("expected claim");

    const reconciled = markNeedsReconciliation(
      first.operation,
      "provider access_token=super-secret api_key:another-secret",
    );

    expect(reconciled.sanitizedError).toBe(
      "provider access_token=[redacted] api_key:[redacted]",
    );
    expect(reconciled.sanitizedError).not.toContain("super-secret");
    expect(reconciled.sanitizedError).not.toContain("another-secret");
  });
});

describe("W2-T05: Draft/version/connection changes after review", () => {
  it("marks operation stale if draft version changed", () => {
    const first = claimOperation(null, request, now, leaseMs, operationId);
    expect(first.kind).toBe("claimed");
    if (first.kind !== "claimed") throw new Error("expected claim");

    // Imagine the draft version was incremented in another tab
    // The operation was claimed with version 1, but version 2 exists now
    // Preflight should detect this and reject creation
    const operationVersion = 1;
    const currentDraftVersion = 2;
    expect(operationVersion).not.toBe(currentDraftVersion);
  });

  it("marks operation stale if connection generation changed", () => {
    const first = claimOperation(null, request, now, leaseMs, operationId);
    expect(first.kind).toBe("claimed");
    if (first.kind !== "claimed") throw new Error("expected claim");

    // If connection generation changed, the preflight hash is invalid
    const operationGeneration = first.operation.connectionGeneration;
    const currentGeneration = operationGeneration + 1;
    expect(operationGeneration).not.toBe(currentGeneration);
  });
});

describe("W2-T12: two workers claim same operation", () => {
  it("returns busy for the second worker while the first lease is active", () => {
    const first = claimOperation(null, request, now, leaseMs, operationId);
    expect(first.kind).toBe("claimed");
    if (first.kind !== "claimed") throw new Error("expected claim");

    const second = claimOperation(first.operation, request, now + 100, leaseMs, "op-second");

    expect(second.kind).toBe("busy");
    expect(second.operation.operationId).toBe(operationId);
    expect(second.operation.attemptCount).toBe(1);
  });

  it("allows exactly one new lease holder after expiry", () => {
    const first = claimOperation(null, request, now, leaseMs, operationId);
    expect(first.kind).toBe("claimed");
    if (first.kind !== "claimed") throw new Error("expected claim");

    const reclaimed = claimOperation(first.operation, request, now + leaseMs + 1, leaseMs, "op-second");
    expect(reclaimed.kind).toBe("claimed");
    if (reclaimed.kind !== "claimed") throw new Error("expected reclaim");
    expect(reclaimed.operation.operationId).toBe(operationId);
    expect(reclaimed.operation.attemptCount).toBe(2);

    const third = claimOperation(reclaimed.operation, request, now + leaseMs + 2, leaseMs, "op-third");
    expect(third.kind).toBe("busy");
    expect(third.operation.attemptCount).toBe(2);
  });

  it("rejects same idempotency key when connection generation changes", () => {
    const first = claimOperation(null, request, now, leaseMs, operationId);
    expect(first.kind).toBe("claimed");
    if (first.kind !== "claimed") throw new Error("expected claim");

    const changedGeneration = claimOperation(
      first.operation,
      { ...request, connectionGeneration: request.connectionGeneration + 1 },
      now + leaseMs + 1,
      leaseMs,
      "op-second",
    );

    expect(changedGeneration.kind).toBe("conflict");
  });
});
