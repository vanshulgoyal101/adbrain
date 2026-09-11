import { describe, expect, it } from "vitest";
import { checkReviewFreshness, runPreflight } from "@/lib/campaign/preflight";
import { claimOperation, finishOperation, markNeedsReconciliation, recordExternalId } from "@/lib/campaign/operations";

const selected = {
  metaBusinessId: null,
  adAccountId: "act_123",
  accountName: "Account",
  pageId: "page-1",
  pageName: "Page",
  currency: "INR",
  timezoneName: "Asia/Kolkata",
};
const draft = {
  businessId: "11111111-1111-4111-8111-111111111111",
  name: "Local leads",
  goal: "Get leads",
  mode: "manual" as const,
  creativeIds: ["22222222-2222-4222-8222-222222222222"],
  dailyBudgetRupees: 500,
  leadFormId: "form-1",
  targeting: {},
  abTest: true,
};

function input(over: Partial<Parameters<typeof runPreflight>[0]> = {}) {
  return {
    draft,
    draftId: "33333333-3333-4333-8333-333333333333",
    draftVersion: 1,
    connection: { generation: 4, selected, canCreatePaused: true },
    creatives: [{ id: draft.creativeIds[0], businessId: draft.businessId, approved: true, imageUrl: "https://image.test/ad.png", headline: "Local help" }],
    form: { id: "form-1", businessId: draft.businessId, active: true },
    geo: { resolvedAreaLabel: "Jaipur", unresolvedNames: [], explicitlyNationwide: false },
    hash: () => "a".repeat(64),
    ...over,
  };
}

describe("campaign preflight", () => {
  it("blocks unresolved geography without broadening to nationwide", () => {
    const review = runPreflight(input({ geo: { resolvedAreaLabel: null, unresolvedNames: ["Unknown"], explicitlyNationwide: false } }));
    expect(review.canCreatePaused).toBe(false);
    expect(review.resolvedAreaLabel).toBeNull();
    expect(review.totalDailyBudgetRupees).toBe(1000);
  });

  it("blocks missing currency, form, capability, or creative ownership", () => {
    const review = runPreflight(input({
      connection: { generation: 4, selected: { ...selected, currency: "USD" }, canCreatePaused: false },
      creatives: [],
      form: null,
    }));
    expect(review.canCreatePaused).toBe(false);
    expect(review.planHash).toBeNull();
    expect(review.blockers.length).toBeGreaterThanOrEqual(4);
  });

  it("builds the same review payload for nested object key order changes", () => {
    let firstHashInput = "";
    let secondHashInput = "";
    const firstTargeting = {
      location: { mode: "manual" as const, included: [], excluded: [], radiusKm: 25 },
      age: { mode: "manual" as const, min: 25, max: 55 },
    };
    const secondTargeting = {
      age: { max: 55, min: 25, mode: "manual" as const },
      location: { radiusKm: 25, excluded: [], included: [], mode: "manual" as const },
    };
    runPreflight(input({
      draft: { ...draft, targeting: firstTargeting },
      hash: (payload) => {
        firstHashInput = payload;
        return "a".repeat(64);
      },
    }));
    runPreflight(input({
      draft: { ...draft, targeting: secondTargeting },
      hash: (payload) => {
        secondHashInput = payload;
        return "a".repeat(64);
      },
    }));

    expect(firstHashInput).toBe(secondHashInput);
  });

  it("rejects stale draft, connection, hash, and blocked reviews before execution", () => {
    const review = runPreflight(input());
    if (!review.planHash) throw new Error("expected a valid review hash");

    expect(checkReviewFreshness(review, {
      draftVersion: review.draftVersion + 1,
      connectionGeneration: review.connectionGeneration,
      planHash: review.planHash,
    })).toEqual({ fresh: false, reason: "DRAFT_CHANGED" });
    expect(checkReviewFreshness(review, {
      draftVersion: review.draftVersion,
      connectionGeneration: review.connectionGeneration + 1,
      planHash: review.planHash,
    })).toEqual({ fresh: false, reason: "CONNECTION_CHANGED" });
    expect(checkReviewFreshness(review, {
      draftVersion: review.draftVersion,
      connectionGeneration: review.connectionGeneration,
      planHash: "b".repeat(64),
    })).toEqual({ fresh: false, reason: "REVIEW_CHANGED" });

    const blocked = runPreflight(input({ geo: { resolvedAreaLabel: null, unresolvedNames: ["Unknown"], explicitlyNationwide: false } }));
    expect(checkReviewFreshness(blocked, {
      draftVersion: blocked.draftVersion,
      connectionGeneration: blocked.connectionGeneration,
      planHash: "a".repeat(64),
    })).toEqual({ fresh: false, reason: "PREFLIGHT_BLOCKED" });
  });
});

describe("durable operation decisions", () => {
  it("replays terminal operations and conflicts on changed payloads", () => {
    const first = claimOperation(null, { businessId: "b1", idempotencyKey: "idem-1234", requestHash: "hash-1", connectionGeneration: 1 }, 0, 1000, "op-1");
    expect(first.kind).toBe("claimed");
    if (first.kind !== "claimed") return;
    const done = finishOperation(first.operation, "campaign-1");
    expect(claimOperation(done, { businessId: "b1", idempotencyKey: "idem-1234", requestHash: "hash-1", connectionGeneration: 1 }, 1, 1000, "op-2").kind).toBe("replay");
    expect(claimOperation(done, { businessId: "b1", idempotencyKey: "idem-1234", requestHash: "hash-2", connectionGeneration: 1 }, 1, 1000, "op-2").kind).toBe("conflict");
  });

  it("retains known IDs and marks possible timeout outcomes for reconciliation", () => {
    const first = claimOperation(null, { businessId: "b1", idempotencyKey: "idem-1234", requestHash: "hash-1", connectionGeneration: 1 }, 0, 1000, "op-1");
    if (first.kind !== "claimed") throw new Error("expected claim");
    const checkpointed = recordExternalId(first.operation, "campaign-1");
    const reconciled = markNeedsReconciliation(checkpointed, "Meta response was ambiguous.");
    expect(reconciled.externalIds).toEqual(["campaign-1"]);
    expect(reconciled.state).toBe("needs_reconciliation");
  });
});