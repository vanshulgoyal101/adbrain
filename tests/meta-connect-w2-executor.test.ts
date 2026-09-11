import { describe, expect, it } from "vitest";
import {
  claimOperation,
  executeOperation,
  OperationPhaseError,
  type OperationCheckpointPort,
  type OperationRecord,
  type OperationStep,
} from "@/lib/campaign/operations";

const request = {
  businessId: "b-1",
  idempotencyKey: "idem-1234",
  requestHash: "hash-abc",
  connectionGeneration: 2,
};

function runningOperation(over: Partial<OperationRecord> = {}): OperationRecord {
  const claimed = claimOperation(null, request, 1000, 30_000, "op-123");
  if (claimed.kind !== "claimed") throw new Error("expected claimed operation");
  return { ...claimed.operation, ...over };
}

class MemoryCheckpoint implements OperationCheckpointPort {
  saved: OperationRecord;
  history: OperationRecord[] = [];
  loseLeaseAfter: number | null = null;

  constructor(operation: OperationRecord) {
    this.saved = operation;
  }

  async checkpoint(operation: OperationRecord): Promise<OperationRecord | null> {
    if (this.loseLeaseAfter !== null && this.history.length >= this.loseLeaseAfter) return null;
    this.history.push(operation);
    this.saved = operation;
    return operation;
  }
}

function step(
  phase: OperationStep["phase"],
  run: OperationStep["run"],
): OperationStep {
  return { phase, run };
}

describe("restartable campaign operation executor", () => {
  it("runs ordered phases and checkpoints every external ID", async () => {
    const operation = runningOperation();
    const checkpoint = new MemoryCheckpoint(operation);
    const calls: string[] = [];
    const result = await executeOperation(
      operation,
      [
        step("campaign", async () => {
          calls.push("campaign");
          return { externalIds: ["campaign-1"], campaignId: "campaign-1" };
        }),
        step("adset", async () => {
          calls.push("adset");
          return { externalIds: ["adset-1"] };
        }),
        step("creative", async () => {
          calls.push("creative");
          return { externalIds: ["creative-1"] };
        }),
        step("ad", async () => {
          calls.push("ad");
          return { externalIds: ["ad-1"] };
        }),
      ],
      checkpoint,
    );

    expect(result.kind).toBe("succeeded");
    expect(calls).toEqual(["campaign", "adset", "creative", "ad"]);
    expect(result.operation.externalIds).toEqual([
      "campaign-1",
      "adset-1",
      "creative-1",
      "ad-1",
    ]);
    expect(result.operation.phase).toBe("complete");
    expect(checkpoint.history.some((entry) => entry.phase === "adset" && entry.externalIds.includes("campaign-1"))).toBe(true);
  });

  it("resumes from the persisted phase without rerunning the campaign step", async () => {
    const operation = runningOperation({
      phase: "adset",
      campaignId: "campaign-1",
      externalIds: ["campaign-1"],
    });
    const checkpoint = new MemoryCheckpoint(operation);
    const calls: string[] = [];
    const result = await executeOperation(
      operation,
      [
        step("campaign", async () => {
          calls.push("campaign");
          return { externalIds: ["campaign-duplicate"], campaignId: "campaign-duplicate" };
        }),
        step("adset", async () => {
          calls.push("adset");
          return { externalIds: ["adset-1"] };
        }),
        step("creative", async () => ({ externalIds: ["creative-1"] })),
        step("ad", async () => ({ externalIds: ["ad-1"] })),
      ],
      checkpoint,
    );

    expect(result.kind).toBe("succeeded");
    expect(calls).toEqual(["adset"]);
    expect(result.operation.externalIds).toEqual(["campaign-1", "adset-1", "creative-1", "ad-1"]);
  });

  it("moves ambiguous failures to reconciliation with known IDs retained", async () => {
    const operation = runningOperation();
    const checkpoint = new MemoryCheckpoint(operation);
    const result = await executeOperation(
      operation,
      [
        step("campaign", async () => ({ externalIds: ["campaign-1"], campaignId: "campaign-1" })),
        step("adset", async () => {
          throw new Error("timeout after transmission");
        }),
        step("creative", async () => ({ externalIds: ["should-not-run"] })),
        step("ad", async () => ({ externalIds: ["should-not-run"] })),
      ],
      checkpoint,
    );

    expect(result.kind).toBe("needs_reconciliation");
    expect(result.operation.externalIds).toEqual(["campaign-1"]);
    expect(result.operation.phase).toBe("reconcile");
    expect(result.operation.leaseUntil).toBeNull();
  });

  it("marks a known pre-transmission failure failed instead of retrying blindly", async () => {
    const operation = runningOperation();
    const checkpoint = new MemoryCheckpoint(operation);
    const result = await executeOperation(
      operation,
      [
        step("campaign", async () => {
          throw new OperationPhaseError("Validation failed before transmission", { transmitted: false });
        }),
        step("adset", async () => ({ externalIds: ["should-not-run"] })),
      ],
      checkpoint,
    );

    expect(result.kind).toBe("failed");
    expect(result.operation.state).toBe("failed");
    expect(result.operation.phase).toBe("complete");
    expect(result.operation.externalIds).toEqual([]);
  });

  it("stops when the lease is lost during checkpointing", async () => {
    const operation = runningOperation();
    const checkpoint = new MemoryCheckpoint(operation);
    checkpoint.loseLeaseAfter = 1;
    const calls: string[] = [];
    const result = await executeOperation(
      operation,
      [
        step("campaign", async () => {
          calls.push("campaign");
          return { externalIds: ["campaign-1"], campaignId: "campaign-1" };
        }),
        step("adset", async () => {
          calls.push("adset");
          return { externalIds: ["adset-1"] };
        }),
      ],
      checkpoint,
    );

    expect(result.kind).toBe("needs_reconciliation");
    expect(calls).toEqual(["campaign"]);
    expect(result.operation.phase).toBe("reconcile");
  });

  it("does not report success when the final result cannot be persisted", async () => {
    const operation = runningOperation();
    const checkpoint = new MemoryCheckpoint(operation);
    checkpoint.loseLeaseAfter = 8;
    const result = await executeOperation(
      operation,
      [
        step("campaign", async () => ({ externalIds: ["campaign-1"], campaignId: "campaign-1" })),
        step("adset", async () => ({ externalIds: ["adset-1"] })),
        step("creative", async () => ({ externalIds: ["creative-1"] })),
        step("ad", async () => ({ externalIds: ["ad-1"] })),
      ],
      checkpoint,
    );

    expect(result.kind).toBe("needs_reconciliation");
    expect(result.operation.state).toBe("needs_reconciliation");
    expect(result.operation.externalIds).toEqual([
      "campaign-1",
      "adset-1",
      "creative-1",
      "ad-1",
    ]);
  });

  it("does not execute steps for terminal operations", async () => {
    const operation = runningOperation({ state: "needs_reconciliation", phase: "reconcile" });
    const checkpoint = new MemoryCheckpoint(operation);
    let calls = 0;
    const result = await executeOperation(
      operation,
      [step("campaign", async () => {
        calls += 1;
        return { externalIds: ["should-not-run"], campaignId: "campaign-1" };
      })],
      checkpoint,
    );

    expect(result.kind).toBe("replay");
    expect(calls).toBe(0);
  });

  it("persists reconciliation when the local campaign save throws after provider mutations", async () => {
    const operation = runningOperation();
    const checkpoint = new MemoryCheckpoint(operation);
    const phases = ["campaign", "adset", "creative", "ad"] as const;
    const result = await executeOperation(operation, phases.map((phase) =>
      step(phase, async () => ({ externalIds: [`${phase}-1`] }))), checkpoint, {
      finalize: async () => { throw new Error("Database unavailable"); },
    });

    expect(result.kind).toBe("needs_reconciliation");
    expect(checkpoint.saved.state).toBe("needs_reconciliation");
    expect(checkpoint.saved.externalIds).toEqual(["campaign-1", "adset-1", "creative-1", "ad-1"]);
    expect(checkpoint.saved.sanitizedError).toBe("Local campaign save could not be persisted.");
  });

  it("returns a recovery outcome when checkpoint storage throws", async () => {
    const operation = runningOperation();
    const result = await executeOperation(operation, [
      step("campaign", async () => ({ externalIds: ["campaign-1"] })),
    ], { checkpoint: async () => { throw new Error("Database unavailable"); } });

    expect(result.kind).toBe("needs_reconciliation");
    expect(result.operation.externalIds).toEqual(["campaign-1"]);
  });

  it("does not mark an operation safely failed after earlier provider mutations", async () => {
    const operation = runningOperation();
    const checkpoint = new MemoryCheckpoint(operation);
    const result = await executeOperation(operation, [
      step("campaign", async () => ({ externalIds: ["campaign-1"] })),
      step("adset", async () => { throw new OperationPhaseError("Validation failed", { transmitted: false }); }),
    ], checkpoint);

    expect(result.kind).toBe("needs_reconciliation");
    expect(checkpoint.saved.state).toBe("needs_reconciliation");
    expect(checkpoint.saved.externalIds).toEqual(["campaign-1"]);
  });
});