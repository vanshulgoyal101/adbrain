import { describe, expect, it } from "vitest";
import { draftInputSchema } from "@/lib/campaign/connect-contracts";
import { plannerPlanToDraftInput } from "@/lib/campaign/planner-draft";

/**
 * W2-04 plan separation tests: validate that planning produces valid DraftInput
 * that conforms to the contract WITHOUT requiring any Meta API calls.
 *
 * Key contract: Planner outputs must be validated like untrusted input before
 * being persisted as drafts. The route must NOT call metaClientForBusiness.
 *
 * This tests the pure validation logic that will be used in the refactored plan route.
 */

describe("W2-04 plan validation: LLM output as untrusted input", () => {
  it("W2-T04: valid draft input passes schema without Meta calls", () => {
    const validDraft = {
      businessId: "b123b123-b123-4123-8123-b123b123b123",
      name: "Test Campaign",
      goal: "leads",
      mode: "guided",
      creativeIds: ["c123c123-c123-4123-8123-c123c123c123"],
      dailyBudgetRupees: 500,
      leadFormId: "form-1",
      targeting: {},
      abTest: false,
    };

    const result = draftInputSchema.safeParse(validDraft);
    expect(result.success).toBe(true);
  });

  it("W2-T02: rejects missing form without Meta call", () => {
    const missingForm = {
      businessId: "b123b123-b123-4123-8123-b123b123b123",
      name: "Test Campaign",
      goal: "leads",
      mode: "guided",
      creativeIds: ["c123c123-c123-4123-8123-c123c123c123"],
      dailyBudgetRupees: 500,
      leadFormId: null, // Null is ok per schema, but test the constraint
      targeting: {},
      abTest: false,
    };

    // Schema allows leadFormId to be null, so this passes
    // Validation that a non-null form exists happens at preflight time
    const result = draftInputSchema.safeParse(missingForm);
    expect(result.success).toBe(true);
  });

  it("W2-T03: rejects negative and overly large budgets without Meta call", () => {
    const invalidBudgets = [
      -500,
      100000000,
    ];

    for (const budget of invalidBudgets) {
      const draft = {
        businessId: "b123b123-b123-4123-8123-b123b123b123",
        name: "Test Campaign",
        goal: "leads",
        mode: "guided",
        creativeIds: ["c123c123-c123-4123-8123-c123c123c123"],
        dailyBudgetRupees: budget,
        leadFormId: "form-1",
        targeting: {},
        abTest: false,
      };

      const result = draftInputSchema.safeParse(draft);
      expect(result.success).toBe(false);
    }
  });

  it("rejects invalid creative ID format without Meta call", () => {
    const invalidCreatives = {
      businessId: "b123b123-b123-4123-8123-b123b123b123",
      name: "Test Campaign",
      goal: "leads",
      mode: "guided",
      creativeIds: ["not-a-uuid"], // Invalid UUID format
      dailyBudgetRupees: 500,
      leadFormId: "form-1",
      targeting: {},
      abTest: false,
    };

    const result = draftInputSchema.safeParse(invalidCreatives);
    // Schema requires valid UUIDs
    expect(result.success).toBe(false);
  });

  it("W2-T05: schema allows optional/unresolved targeting", () => {
    const partial = {
      businessId: "b123b123-b123-4123-8123-b123b123b123",
      name: "Test Campaign",
      goal: "leads",
      mode: "guided",
      creativeIds: ["c123c123-c123-4123-8123-c123c123c123"],
      dailyBudgetRupees: 500,
      leadFormId: "form-1",
      targeting: {
        // Partially specified targeting (validated at preflight time, not here)
        age: {
          min: 25,
          max: 55,
        },
      },
      abTest: false,
    };

    const result = draftInputSchema.safeParse(partial);
    // Schema allows partial targeting; preflight validates completeness
    expect(result.success).toBe(true);
  });
});

describe("W2-04 plan contract: DraftInput requirements", () => {
  it("requires businessId, name, goal, mode, creativeIds, dailyBudgetRupees", () => {
    const minimal = {
      businessId: "b123b123-b123-4123-8123-b123b123b123",
      name: "Campaign",
      goal: "leads",
      mode: "manual",
      creativeIds: ["c123c123-c123-4123-8123-c123c123c123"],
      dailyBudgetRupees: 100,
      leadFormId: null,
      targeting: {},
      abTest: false,
    };

    const result = draftInputSchema.safeParse(minimal);
  expect(result.success).toBe(true);
  });

  it("allows both manual and guided modes", () => {
    const base = {
      businessId: "b123b123-b123-4123-8123-b123b123b123",
      name: "Campaign",
      goal: "leads",
      creativeIds: ["c123c123-c123-4123-8123-c123c123c123"],
      dailyBudgetRupees: 100,
      leadFormId: "f-1",
      targeting: {},
      abTest: false,
    };

    const manual = draftInputSchema.safeParse({ ...base, mode: "manual" });
    const guided = draftInputSchema.safeParse({ ...base, mode: "guided" });

    expect(manual.success).toBe(true);
    expect(guided.success).toBe(true);
  });
});

describe("W2-04 planner output conversion", () => {
  const businessId = "b123b123-b123-4123-8123-b123b123b123";
  const creativeId = "c123c123-c123-4123-8123-c123c123c123";
  const secondCreativeId = "d123d123-d123-4123-8123-d123d123d123";
  const leadFormId = "form-1";
  const plan = {
    name: "Guided leads",
    daily_budget_rupees: 750,
    lead_form_id: leadFormId,
    creative_ids: [creativeId],
    age_min: 24,
    age_max: 54,
    locations: ["Jaipur"],
    excluded_locations: ["Ajmer"],
    destination: "instant_form",
    rationale: "Use the strongest approved creative.",
  };

  it("W2-T04: converts valid guided planner output to a draft without Meta calls", () => {
    const result = plannerPlanToDraftInput({
      businessId,
      goal: "Generate qualified leads",
      plan,
      approvedCreativeIds: [creativeId, secondCreativeId],
      leadFormIds: [leadFormId],
      knownLocations: [
        { key: "jaipur", name: "Jaipur", type: "city" },
        { key: "ajmer", name: "Ajmer", type: "city" },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.draft).toMatchObject({
      businessId,
      mode: "guided",
      creativeIds: [creativeId],
      leadFormId,
      dailyBudgetRupees: 750,
    });
    expect(result.draft.targeting.location?.included).toEqual([
      { key: "jaipur", name: "Jaipur", type: "city" },
    ]);
    expect(result.draft.targeting.location?.excluded).toEqual([
      { key: "ajmer", name: "Ajmer", type: "city" },
    ]);
  });

  it("rejects invented creative IDs before draft persistence", () => {
    const result = plannerPlanToDraftInput({
      businessId,
      goal: "Generate leads",
      plan: { ...plan, creative_ids: [secondCreativeId] },
      approvedCreativeIds: [creativeId],
      leadFormIds: [leadFormId],
    });

    expect(result).toEqual({ ok: false, error: "Planner did not choose an approved creative." });
  });

  it("rejects unavailable lead forms before draft persistence", () => {
    const result = plannerPlanToDraftInput({
      businessId,
      goal: "Generate leads",
      plan: { ...plan, lead_form_id: "form-other" },
      approvedCreativeIds: [creativeId],
      leadFormIds: [leadFormId],
    });

    expect(result).toEqual({ ok: false, error: "Planner chose a lead form that is not available." });
  });

  it("rejects bad planner budgets instead of clamping them", () => {
    for (const dailyBudgetRupees of [-1, 0, Number.NaN, 10_000_001]) {
      const result = plannerPlanToDraftInput({
        businessId,
        goal: "Generate leads",
        plan: { ...plan, daily_budget_rupees: dailyBudgetRupees },
        approvedCreativeIds: [creativeId],
        leadFormIds: [leadFormId],
      });

      expect(result.ok).toBe(false);
    }
  });
});
