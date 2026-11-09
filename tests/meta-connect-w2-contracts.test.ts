import { describe, expect, it } from "vitest";
import {
  campaignActivationPatchSchema,
  draftInputSchema,
  planRequestSchema,
} from "@/lib/campaign/connect-contracts";

const businessId = "11111111-1111-4111-8111-111111111111";

describe("Worker 2 campaign contracts", () => {
  it.each(["whatsapp", "instant_form", undefined])("rejects conversion goals on the %s destination", (destination) => {
    for (const websiteGoal of ["leads", "sales"]) {
      expect(draftInputSchema.safeParse({
        businessId, name: "Website leads", goal: "Enquiries", mode: "manual", creativeIds: [],
        dailyBudgetRupees: 300, leadFormId: null, targeting: {}, abTest: false, destination, websiteGoal,
      }).success).toBe(false);
    }
  });

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

  it("accepts a WhatsApp source only alongside an explicitly chosen WhatsApp number", () => {
    const input = {
      businessId, name: "Chats", goal: "Enquiries", mode: "manual", creativeIds: [],
      dailyBudgetRupees: 300, leadFormId: null, targeting: {}, abTest: false,
    };
    expect(draftInputSchema.safeParse({ ...input, destination: "whatsapp", whatsappNumber: "+91 ••••• 4842", whatsappNumberSource: "business" }).success).toBe(true);
    expect(draftInputSchema.safeParse({ ...input, destination: "whatsapp", whatsappNumberSource: "page" }).success).toBe(false);
    expect(draftInputSchema.safeParse({ ...input, destination: "instant_form", whatsappNumber: "+91 ••••• 4842", whatsappNumberSource: "page" }).success).toBe(false);
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