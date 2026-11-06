import { describe, expect, it } from "vitest";
import { draftInputSchema } from "@/lib/campaign/connect-contracts";
import { buildManualDraftInput } from "@/lib/campaign/manual-draft-input";
import type { WebsiteGoal } from "@/lib/types/campaign";

const fields = {
  businessId: "11111111-1111-4111-8111-111111111111",
  name: "Website campaign",
  goal: "Website enquiries",
  mode: "manual" as const,
  creativeIds: [],
  dailyBudgetRupees: 300,
  destination: "website" as const,
  leadFormId: "",
  whatsappNumber: "",
  whatsappLanguage: "ad" as const,
  whatsappMessage: null,
  targeting: draftInputSchema.shape.targeting.parse({}),
  abTest: false,
};

describe("manual website draft goal", () => {
  it.each(["leads", "sales"] as const)("preserves an explicit %s conversion goal", (websiteGoal: WebsiteGoal) => {
    const input = buildManualDraftInput({ ...fields, websiteGoal });
    expect(draftInputSchema.parse(input)).toMatchObject({ destination: "website", websiteGoal });
  });

  it("keeps explicit visits identical to the existing omitted-goal draft", () => {
    const original = buildManualDraftInput(fields);
    const visits = buildManualDraftInput({ ...fields, websiteGoal: "visits" });
    expect(visits).toEqual(original);
    expect(visits).not.toHaveProperty("websiteGoal");
  });

  it.each(["instant_form", "whatsapp"] as const)("does not attach a website goal to an explicitly chosen %s destination", (destination) => {
    const input = buildManualDraftInput({ ...fields, destination, websiteGoal: "leads" });
    expect(input).not.toHaveProperty("websiteGoal");
    expect(draftInputSchema.safeParse(input).success).toBe(true);
  });
});
