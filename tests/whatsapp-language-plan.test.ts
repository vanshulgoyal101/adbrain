import { describe, expect, it } from "vitest";
import { draftInputSchema } from "@/lib/campaign/connect-contracts";
import { buildCanonicalReviewPayload } from "@/lib/campaign/preflight";

// #493 (owner, Oct 25): the WhatsApp message language is a per-campaign choice, part of the reviewed plan.
const businessId = "816aaafb-7ebc-4ad7-bbda-001beff172f8";
const draft = {
  businessId, name: "Solaride WhatsApp", goal: "Free site surveys", mode: "manual" as const, creativeIds: [], dailyBudgetRupees: 300,
  leadFormId: null, abTest: false, destination: "whatsapp" as const,
  targeting: { location: { mode: "ai" as const, includedNames: ["Mohali"] }, age: { mode: "manual" as const, min: 25, max: 65 } },
};
const payload = (extra: Record<string, unknown>) => buildCanonicalReviewPayload({
  draft: { ...draft, ...extra } as never, draftId: "90d1d2bb-466c-4889-9af2-edb533e82531", draftVersion: 1, connection: null, creatives: [],
  form: null, whatsappNumber: "+919876543210", website: null, geo: { resolvedAreaLabel: "Mohali", unresolvedNames: [], explicitlyNationwide: false }, hash: () => "",
} as never) as unknown as Record<string, unknown>;

describe("WhatsApp message language per campaign (#493)", () => {
  it("accepts the five choices and nothing else", () => {
    for (const whatsappLanguage of ["ad", "en", "hi", "hinglish", "pa"]) expect(draftInputSchema.safeParse({ ...draft, whatsappLanguage }).success, whatsappLanguage).toBe(true);
    expect(draftInputSchema.safeParse({ ...draft, whatsappLanguage: "fr" }).success).toBe(false);
  });

  it("is part of the reviewed plan when it changes what's sent; drafts without it keep their old plan", () => {
    expect(payload({ whatsappLanguage: "en" })).toMatchObject({ whatsappLanguage: "en" });
    expect(payload({})).not.toHaveProperty("whatsappLanguage");
    expect(payload({ whatsappLanguage: "ad" })).not.toHaveProperty("whatsappLanguage");
    expect(payload({ whatsappLanguage: "en", destination: "instant_form" })).not.toHaveProperty("whatsappLanguage");
  });
});
