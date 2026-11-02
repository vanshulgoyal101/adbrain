import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/meta/whatsapp-validate.json";

// #2452: launch rebuilds the WhatsApp message from its own reads and refuses anything but the one Review checked.
// The reviewed message is the one Meta accepted for Solaride (validate_only, recorded Oct 25 by
// scripts/record-meta-whatsapp-fixtures.ts); a Brand edit after Review must never reach Meta unchecked.
const meta = vi.hoisted(() => ({ createLeadCampaign: vi.fn() }));
vi.mock("@/lib/meta/connection-access", () => ({
  withMetaConnection: async (_actor: unknown, _options: unknown, run: (client: unknown) => unknown) => run(meta),
}));
vi.mock("@/lib/meta/whatsapp-bindings", () => ({ boundWhatsAppNumbers: async () => ["+919999990874"] }));
vi.mock("@/lib/creative/story", () => ({ renderStoriesWithin: (generations: unknown[]) => generations.map(() => null) }));
vi.mock("@/lib/campaign/operation-store", () => ({ createOperationCheckpoint: () => ({ checkpoint: async (operation: unknown) => operation }) }));
vi.mock("@/lib/campaign/trusted-write", () => ({ saveCampaign: async () => ({ data: { id: "campaign-row" }, error: null }) }));
vi.mock("@/lib/campaign/learnings", () => ({ buildLaunchSnapshot: () => null, saveLaunchSnapshot: async () => true }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/observability/logger", () => ({ recordProductEvent: () => undefined }));

import { executeReviewedCampaign } from "@/lib/campaign/create-service";
import { buildCanonicalReviewPayload, buildCreativeReviewPayload, isReviewedWhatsAppMessage } from "@/lib/campaign/preflight";
import type { ReviewDTO } from "@/lib/campaign/connect-contracts";
import type { OperationRecord } from "@/lib/campaign/operations";

const solaride = { name: "Solaride", website: "https://solaride.in", locations: ["Chandigarh", "Panchkula", "Mohali"],
  offers: ["Free site survey", "PM Surya Ghar subsidy help", "Diwali offer: 10% off rooftop solar installation"], whatsapp_template: null as unknown };
const creative = {
  id: "8a5e19e9-0000-4000-8000-000000000001", image_url: "https://example.com/ad.png", cta: null, angle: null, generation: {},
  headline: "Wondering Whether Your Roof Is Ready?",
  primary_text: "Unsure if your roof can take solar? Diwali offer: 10% off rooftop solar installation from Solaride.\nFree site survey first, plus PM Surya Ghar subsidy help from our team.\nMessage Solaride on WhatsApp to book your free site survey.",
};
const creativeHash = createHash("sha256").update(JSON.stringify(buildCreativeReviewPayload([{
  id: creative.id, businessId: "b1", approved: true, imageUrl: creative.image_url, headline: creative.headline, primaryText: creative.primary_text, cta: null, description: null,
}]))).digest("hex");
const draft = { id: "d1", version: 1, input: {
  name: "Solaride WhatsApp", dailyBudgetRupees: 280, destination: "whatsapp", creativeIds: [creative.id], abTest: false,
  targeting: { location: { mode: "ai", includedNames: solaride.locations }, age: { min: 25, max: 55 } },
} } as never;
const review = {
  selected: { adAccountId: "act_9000000000000001", pageId: "900000000000002" }, connectionGeneration: 1, creativeHash,
  resolvedLocation: { cities: [{ key: "1021145" }] }, whatsappNumber: "+919999990874",
  whatsappMessage: { source: "suggested", language: null, ...recorded.greeting },
} as unknown as ReviewDTO;
const operation = { operationId: "o1", businessId: "b1", kind: "campaign_create", idempotencyKey: "k", requestHash: "h", connectionGeneration: 1,
  state: "running", phase: "campaign", leaseUntil: null, attemptCount: 1, campaignId: null, externalIds: [] as string[], sanitizedError: null } satisfies OperationRecord;

function launch(business: typeof solaride) {
  const businesses = { select: () => businesses, eq: () => businesses, maybeSingle: async () => ({ data: business, error: null }) };
  const creatives = { select: () => creatives, in: () => creatives, eq: () => creatives, then: (resolve: (value: unknown) => void) => resolve({ data: [creative], error: null }) };
  const database = { from: (table: string) => (table === "businesses" ? businesses : creatives) } as never;
  return executeReviewedCampaign({ database, operationDatabase: database, actor: { businessId: "b1" } as never, draft, review, operation: { ...operation, externalIds: [] } });
}

beforeEach(() => {
  meta.createLeadCampaign.mockReset().mockResolvedValue({ destination: "whatsapp", campaignId: "c1", adSetId: "s1", adSetIds: ["s1"], adIds: ["a1"], creativeIds: ["cr1"] });
});

describe("core: launch sends only the WhatsApp message Review checked (#2452)", () => {
  it("sends Meta's recorded message when the Brand is unchanged since Review", async () => {
    const result = await launch(solaride);
    expect(result.kind).toBe("succeeded");
    expect(meta.createLeadCampaign).toHaveBeenCalledTimes(1);
    expect(meta.createLeadCampaign.mock.calls[0][0].whatsappGreeting).toEqual(recorded.greeting);
  });

  it("refuses before any Meta call when a saved message appeared after Review", async () => {
    const saved = { greeting: "Hi! Guaranteed savings on your bill with Solaride.", opening: { kind: "prefill", prefill: "Hi! I'd like a free site survey.", callButton: false }, language: "en" };
    const result = await launch({ ...solaride, whatsapp_template: saved });
    expect(meta.createLeadCampaign).not.toHaveBeenCalled();
    expect(result).toMatchObject({ kind: "failed", operation: { state: "failed", sanitizedError: "WhatsApp message changed since review." } });
  });

  it("refuses when the suggestion would change because the Brand's offers changed", async () => {
    const result = await launch({ ...solaride, offers: ["PM Surya Ghar subsidy help"] });
    expect(meta.createLeadCampaign).not.toHaveBeenCalled();
    expect(result.kind).toBe("failed");
  });
});

describe("core: Review signs the suggested WhatsApp message too (#2452)", () => {
  const suggested = { source: "suggested" as const, language: null, opening: recorded.greeting };
  const signed = (whatsappMessage: typeof suggested) => buildCanonicalReviewPayload({
    draft: { businessId: "b1", creativeIds: [creative.id], destination: "whatsapp", dailyBudgetRupees: 280, abTest: false, targeting: {} },
    draftId: "d1", draftVersion: 1, connection: null, creatives: [], form: null, whatsappMessage,
    geo: { resolvedAreaLabel: "Tricity", unresolvedNames: [], explicitlyNationwide: false }, hash: () => "",
  } as never);

  it("puts the suggestion in the signed plan, so a changed suggestion is a changed plan", () => {
    expect(signed(suggested).whatsappOpening).toEqual(recorded.greeting);
    expect(signed({ ...suggested, opening: recorded.variants["one-city"] })).not.toEqual(signed(suggested));
  });

  it("matches the reviewed message exactly, whatever order its fields came in", () => {
    expect(isReviewedWhatsAppMessage(suggested, { whatsappMessage: { autofill: recorded.greeting.autofill, greeting: recorded.greeting.greeting, language: null, source: "suggested" } })).toBe(true);
    expect(isReviewedWhatsAppMessage(suggested, { whatsappMessage: undefined })).toBe(false);
    expect(isReviewedWhatsAppMessage({ ...suggested, source: "saved" }, { whatsappMessage: { source: "suggested", language: null, ...recorded.greeting } })).toBe(false);
  });
});
