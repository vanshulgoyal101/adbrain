import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// #2599: a website ad launches to the Brand's own site, the link Review opened and hashed, never with a lead form.
const meta = vi.hoisted(() => ({ createLeadCampaign: vi.fn(), saveCampaign: vi.fn() }));
vi.mock("@/lib/meta/connection-access", () => ({
  withMetaConnection: async (_actor: unknown, _options: unknown, run: (client: unknown) => unknown) => run(meta),
}));
vi.mock("@/lib/meta/whatsapp-bindings", () => ({ boundWhatsAppNumbers: async () => [] }));
vi.mock("@/lib/creative/story", () => ({ renderStoriesWithin: (generations: unknown[]) => generations.map(() => null) }));
vi.mock("@/lib/campaign/operation-store", () => ({ createOperationCheckpoint: () => ({ checkpoint: async (operation: unknown) => operation }) }));
vi.mock("@/lib/campaign/trusted-write", () => ({ saveCampaign: meta.saveCampaign }));
vi.mock("@/lib/campaign/learnings", () => ({ buildLaunchSnapshot: () => null, readCreativeMedia: async () => new Map(), saveLaunchSnapshot: async () => true }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/observability/logger", () => ({ recordProductEvent: () => undefined }));

import { executeReviewedCampaign } from "@/lib/campaign/create-service";
import { buildCreativeReviewPayload } from "@/lib/campaign/preflight";
import { websiteAdLink } from "@/lib/campaign/website-review";
import type { ReviewDTO } from "@/lib/campaign/connect-contracts";
import type { OperationRecord } from "@/lib/campaign/operations";

const creative = {
  id: "8a5e19e9-0000-4000-8000-000000000002", image_url: "https://example.com/ad.png", cta: "LEARN_MORE", angle: null, generation: {},
  headline: "New-patient exams this week", primary_text: "Book a new-patient exam at Cedar Ridge Chiropractic.",
};
const creativeHash = createHash("sha256").update(JSON.stringify(buildCreativeReviewPayload([{
  id: creative.id, businessId: "b1", approved: true, imageUrl: creative.image_url, headline: creative.headline, primaryText: creative.primary_text, cta: creative.cta, description: null,
}]))).digest("hex");
const draft = { id: "d1", version: 1, input: {
  name: "Cedar Ridge website", dailyBudgetRupees: 300, destination: "website", leadFormId: "form-left-over", creativeIds: [creative.id], abTest: false,
  targeting: { location: { mode: "ai", includedNames: ["Austin, Texas"] }, age: { min: 25, max: 55 } },
} } as never;
const review = {
  selected: { adAccountId: "act_9000000000000001", pageId: "900000000000002" }, connectionGeneration: 1, creativeHash,
  resolvedLocation: { cities: [{ key: "2421836" }] },
} as unknown as ReviewDTO;
const operation = { operationId: "o1", businessId: "b1", kind: "campaign_create", idempotencyKey: "k", requestHash: "h", connectionGeneration: 1,
  state: "running", phase: "campaign", leaseUntil: null, attemptCount: 1, campaignId: null, externalIds: [] as string[], sanitizedError: null } satisfies OperationRecord;

function launch(website: string, reviewed: string | null = websiteAdLink(website), websiteGoal?: ReviewDTO["websiteGoal"]) {
  const business = { name: "Cedar Ridge Chiropractic", website, locations: ["Austin, Texas"], offers: [], whatsapp_template: null };
  const businesses = { select: () => businesses, eq: () => businesses, maybeSingle: async () => ({ data: business, error: null }) };
  const creatives = { select: () => creatives, in: () => creatives, eq: () => creatives, then: (resolve: (value: unknown) => void) => resolve({ data: [creative], error: null }) };
  const database = { from: (table: string) => (table === "businesses" ? businesses : creatives) } as never;
  return executeReviewedCampaign({ database, operationDatabase: database, actor: { businessId: "b1" } as never, draft, review: { ...review, websiteUrl: reviewed, ...(websiteGoal ? { websiteGoal } : {}) }, operation: { ...operation, externalIds: [] } });
}

beforeEach(() => {
  meta.createLeadCampaign.mockReset().mockResolvedValue({ destination: "website", campaignId: "c1", adSetId: "s1", adSetIds: ["s1"], adIds: ["a1"], creativeIds: ["cr1"] });
  meta.saveCampaign.mockReset().mockResolvedValue({ data: { id: "campaign-row" }, error: null });
});

describe("core: website launch (#2599)", () => {
  it("sends the link Review checked and no lead form", async () => {
    const result = await launch("cedarridgechiro.com");
    expect(result.kind).toBe("succeeded");
    const sent = meta.createLeadCampaign.mock.calls[0][0];
    expect(sent.destination).toBe("website");
    expect(sent.leadFormId).toBeUndefined();
    expect(sent.boundWhatsAppNumbers).toBeUndefined();
    expect(sent.link).toBe(websiteAdLink("cedarridgechiro.com"));
    expect(sent.link).toBe("https://cedarridgechiro.com");
  });

  it("sends an http website at its https address, which Meta's website ads require", async () => {
    await launch("http://cedarridgechiro.com");
    expect(meta.createLeadCampaign.mock.calls[0][0].link).toBe("https://cedarridgechiro.com");
  });

  it("saves the campaign as traffic, so results never read it as a form campaign", async () => {
    await launch("https://cedarridgechiro.com");
    expect(meta.saveCampaign.mock.calls[0][1]).toMatchObject({ destination: "website", objective: "traffic" });
  });

  it("sends Review's link even if the Brand website changes between Review and launch", async () => {
    await launch("https://someone-else.example", "https://cedarridgechiro.com");
    expect(meta.createLeadCampaign.mock.calls[0][0].link).toBe("https://cedarridgechiro.com");
  });

  it("refuses before Meta when Review carries no website link", async () => {
    const result = await launch("https://cedarridgechiro.com", null);
    expect(result.kind).not.toBe("succeeded");
    expect(meta.createLeadCampaign).not.toHaveBeenCalled();
  });

  // #2714: Meta's signup and sales payload is B2's (#2713); until then a conversion review never launches as traffic.
  it.each(["leads", "sales"] as const)("refuses a reviewed %s goal before Meta, and saves nothing", async (websiteGoal) => {
    const result = await launch("https://cedarridgechiro.com", undefined, websiteGoal);
    expect(result.kind).not.toBe("succeeded");
    expect(meta.createLeadCampaign).not.toHaveBeenCalled();
    expect(meta.saveCampaign).not.toHaveBeenCalled();
  });

  it("a reviewed visits goal still launches and saves as traffic", async () => {
    expect((await launch("https://cedarridgechiro.com", undefined, "visits")).kind).toBe("succeeded");
    expect(meta.saveCampaign.mock.calls[0][1]).toMatchObject({ objective: "traffic" });
  });
});
