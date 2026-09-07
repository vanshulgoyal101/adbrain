import { describe, expect, it } from "vitest";
import {
  campaignActivationPatchSchema,
  draftInputSchema,
  planRequestSchema,
} from "@/lib/campaign/connect-contracts";

const businessId = "11111111-1111-4111-8111-111111111111";

describe("Worker 2 campaign contracts", () => {
  it("allows incomplete draft input while requiring bounded typed fields", () => {
    const parsed = draftInputSchema.safeParse({
      businessId,
      name: "New campaign",
      goal: "Reach local customers",
      mode: "guided",
      creativeIds: [],
      dailyBudgetRupees: 0,
      leadFormId: null,
      targeting: {},
      abTest: false,
    });

    expect(parsed.success).toBe(true);
  });

  it("retains the current planner request shape without allowing extra fields", () => {
    expect(planRequestSchema.safeParse({ goal: "Generate leads", answers: [] }).success).toBe(true);
    expect(planRequestSchema.safeParse({ goal: "Generate leads", businessId }).success).toBe(false);
  });

  it("requires a fresh digest and generation when activating", () => {
    expect(campaignActivationPatchSchema.safeParse({ status: "paused" }).success).toBe(true);
    expect(campaignActivationPatchSchema.safeParse({ status: "active" }).success).toBe(false);
    expect(
      campaignActivationPatchSchema.safeParse({
        status: "active",
        confirmationDigest: "a".repeat(64),
        connectionGeneration: 2,
      }).success,
    ).toBe(true);
  });
});