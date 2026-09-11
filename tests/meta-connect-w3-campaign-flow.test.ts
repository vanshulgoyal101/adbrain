import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildActivationPatch,
  buildCreateCampaignRequest,
  canStartCreate,
  stableOperationKey,
} from "@/lib/meta-connect-ui/campaign-flow";
import type { DraftDTO, ReviewDTO } from "@/lib/campaign/connect-contracts";

const businessId = "11111111-1111-4111-8111-111111111111";
const draft: DraftDTO = {
  draftId: "22222222-2222-4222-8222-222222222222",
  version: 4,
  expiresAt: "2026-09-14T00:00:00.000Z",
  input: {
    businessId,
    name: "Clinic leads",
    goal: "Book consultations",
    mode: "manual",
    creativeIds: [],
    dailyBudgetRupees: 500,
    leadFormId: null,
    targeting: {},
    abTest: false,
  },
};

const review: ReviewDTO = {
  draftId: draft.draftId,
  draftVersion: draft.version,
  connectionGeneration: 9,
  canCreatePaused: true,
  blockers: [],
  planHash: "a".repeat(64),
  currency: "INR",
  perAdSetDailyBudgetRupees: 500,
  adSetCount: 1,
  totalDailyBudgetRupees: 500,
  resolvedAreaLabel: "Jaipur",
  selected: null,
};

describe("Worker 3 campaign flow contract", () => {
  it("manual composer has no legacy create request shape", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/campaigns.tsx"), "utf8");
    expect(source).not.toContain('fetch("/api/campaigns/create"');
    expect(source).toContain("createMetaConnectClient().createCampaign");
  });

  it("sends the reviewed digest and generation for activation", () => {
    const patch = buildActivationPatch("b".repeat(64), review.connectionGeneration);
    expect(patch).toEqual({
      status: "active",
      confirmationDigest: "b".repeat(64),
      connectionGeneration: 9,
    });
  });

  it("reuses the same idempotency key after timeout or reconciliation", () => {
    const first = stableOperationKey(null, review, () => "operation-key-1");
    const afterTimeout = stableOperationKey(first, review, () => "operation-key-2");
    expect(afterTimeout).toEqual(first);
    expect(canStartCreate({
      operationId: "33333333-3333-4333-8333-333333333333",
      businessId,
      state: "needs_reconciliation",
      campaignId: null,
      blockers: [],
    })).toBe(false);
  });

  it("includes every durable create field from the reviewed draft", () => {
    expect(buildCreateCampaignRequest(businessId, draft, review, "operation-key-1")).toEqual({
      businessId,
      draftId: draft.draftId,
      draftVersion: 4,
      planHash: "a".repeat(64),
      connectionGeneration: 9,
      idempotencyKey: "operation-key-1",
    });
  });
});