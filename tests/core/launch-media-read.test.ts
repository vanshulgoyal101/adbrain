import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/meta/whatsapp-validate.json";
import type { ReviewDTO } from "@/lib/campaign/connect-contracts";
import type { DraftRecord } from "@/lib/campaign/draft-store";
import type { OperationRecord } from "@/lib/campaign/operations";
import type { CampaignMutationCheckpoint } from "@/lib/meta/client";

const boundary = vi.hoisted(() => ({
  create: vi.fn(),
  saveCampaign: vi.fn(),
  saveSnapshot: vi.fn(),
  saveLinks: vi.fn(),
  events: vi.fn(),
}));

vi.mock("@/lib/meta/connection-access", () => ({
  withMetaConnection: async (_actor: unknown, _options: unknown, run: (client: unknown) => unknown) =>
    run({ createLeadCampaign: boundary.create }),
}));
vi.mock("@/lib/meta/whatsapp-bindings", () => ({ boundWhatsAppNumbers: async () => ["+919999990874"] }));
vi.mock("@/lib/creative/story", () => ({ renderStoriesWithin: (generations: unknown[]) => generations.map(() => null) }));
vi.mock("@/lib/campaign/operation-store", () => ({ createOperationCheckpoint: () => ({ checkpoint: async (operation: unknown) => operation }) }));
vi.mock("@/lib/campaign/trusted-write", () => ({ saveCampaign: boundary.saveCampaign }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "campaign_learnings") return { upsert: boundary.saveSnapshot };
      if (table === "campaign_ads") return { upsert: boundary.saveLinks };
      throw new Error(`Unexpected admin table: ${table}`);
    },
  }),
}));
vi.mock("@/lib/observability/logger", () => ({ recordProductEvent: boundary.events }));

import { executeReviewedCampaign } from "@/lib/campaign/create-service";
import { buildCreativeReviewPayload } from "@/lib/campaign/preflight";

const now = "2026-11-04T10:00:00.000Z";
const businessId = "b123b123-b123-4123-8123-b123b123b123";
const assetId = "00000000-0000-4000-8000-000000000001";
const business = {
  name: "Solaride",
  website: "https://solaride.in",
  locations: ["Chandigarh", "Panchkula", "Mohali"],
  offers: ["Free site survey", "PM Surya Ghar subsidy help", "Diwali offer: 10% off rooftop solar installation"],
  whatsapp_template: null,
};
const creative = {
  id: "8a5e19e9-0000-4000-8000-000000000001",
  image_url: "https://example.com/ad.png",
  cta: null,
  angle: null,
  generation: {},
  updated_at: "2026-11-03T10:00:00.123456+00:00",
  headline: "Wondering Whether Your Roof Is Ready?",
  primary_text: "Unsure if your roof can take solar? Diwali offer: 10% off rooftop solar installation from Solaride.\nFree site survey first, plus PM Surya Ghar subsidy help from our team.\nMessage Solaride on WhatsApp to book your free site survey.",
};
const creativeHash = createHash("sha256").update(JSON.stringify(buildCreativeReviewPayload([{
  id: creative.id, businessId, approved: true, imageUrl: creative.image_url, headline: creative.headline,
  primaryText: creative.primary_text, cta: null, description: null,
}]))).digest("hex");
const draft = {
  id: "d123d123-d123-4123-8123-d123d123d123",
  businessId,
  ownerId: "u1",
  version: 1,
  createdAt: now,
  updatedAt: now,
  expiresAt: "2026-11-11T10:00:00.000Z",
  input: {
    businessId, name: "Solaride WhatsApp", goal: "Free site surveys", mode: "manual", leadFormId: null,
    dailyBudgetRupees: 280, destination: "whatsapp", creativeIds: [creative.id], abTest: false,
    targeting: { location: { mode: "ai", includedNames: business.locations }, age: { min: 25, max: 55 } },
  },
} satisfies DraftRecord;
const review = {
  draftId: draft.id,
  draftVersion: 1,
  connectionGeneration: 1,
  canCreatePaused: true,
  blockers: [],
  planHash: null,
  creativeHash,
  currency: "INR",
  perAdSetDailyBudgetRupees: 280,
  adSetCount: 1,
  totalDailyBudgetRupees: 280,
  resolvedAreaLabel: null,
  resolvedLocation: { cities: [{ key: "1021145" }] },
  selected: {
    metaBusinessId: null, adAccountId: "act_9000000000000001", accountName: "Test account",
    pageId: "900000000000002", pageName: "Test page", currency: "INR", timezoneName: "Asia/Kolkata",
  },
  whatsappNumber: "+919999990874",
  whatsappMessage: { source: "suggested", language: null, ...recorded.greeting },
} satisfies ReviewDTO;
const operation = {
  operationId: "o1", businessId, kind: "campaign_create", idempotencyKey: "k", requestHash: "h", connectionGeneration: 1,
  state: "running", phase: "campaign", leaseUntil: null, attemptCount: 1, campaignId: null, externalIds: [] as string[], sanitizedError: null,
} satisfies OperationRecord;

type LinkRow = { id: string; media_asset_id: string | null; updated_at: string };
type LinkResult = { data: LinkRow[] | null; error: { message: string } | null };
type AssetResult = { data: { id: string; kind: string; source: string }[] | null; error: { message: string } | null };

function links(mediaAssetId: string | null = assetId): LinkResult {
  return { data: [{ id: creative.id, media_asset_id: mediaAssetId, updated_at: creative.updated_at }], error: null };
}

function launch(readLinks: () => Promise<LinkResult>, assets: AssetResult = {
  data: [{ id: assetId, kind: "image", source: "upload" }], error: null,
}) {
  const started = Promise.withResolvers<void>();
  const reads: { table: string; field: string; ids: string[]; scope: string; businessId: string }[] = [];
  const database = {
    from: (table: string) => {
      if (table === "businesses") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: business, error: null }) }) }) };
      }
      if (table === "creatives") {
        return {
          select: (columns: string) => columns === "id, media_asset_id, updated_at"
            ? { in: (field: string, ids: string[]) => ({ eq: (scope: string, owner: string) => {
              reads.push({ table, field, ids, scope, businessId: owner });
              started.resolve();
              return readLinks();
            } }) }
            : { in: () => ({ eq: () => ({ eq: async () => ({ data: [creative], error: null }) }) }) },
        };
      }
      if (table === "media_assets") {
        return { select: () => ({ in: (field: string, ids: string[]) => ({ eq: async (scope: string, owner: string) => {
          reads.push({ table, field, ids, scope, businessId: owner });
          return assets;
        } }) }) };
      }
      throw new Error(`Unexpected read table: ${table}`);
    },
  } as never;
  const completion = executeReviewedCampaign({
    database, operationDatabase: database, actor: { businessId, userId: "u1" } as never,
    draft, review, operation: { ...operation, externalIds: [] },
  });
  return { completion, started: started.promise, reads };
}

function expectUnknownSnapshot() {
  expect(boundary.create).toHaveBeenCalledOnce();
  expect(boundary.create.mock.calls[0][0].whatsappGreeting).toMatchObject(recorded.greeting);
  expect(boundary.saveCampaign).toHaveBeenCalledOnce();
  expect(boundary.saveSnapshot).toHaveBeenCalledOnce();
  expect(boundary.saveSnapshot).toHaveBeenCalledWith(expect.objectContaining({
    campaign_id: "campaign-row",
    business_id: businessId,
    snapshot: expect.objectContaining({
      version: 3,
      mediaUnknownAt: now,
      creatives: [expect.objectContaining({ id: creative.id, mediaAssetId: null })],
      media: [],
    }),
  }), { onConflict: "campaign_id" });
  expect(boundary.saveLinks).not.toHaveBeenCalled();
  expect(boundary.events).toHaveBeenCalledWith(expect.objectContaining({
    name: "campaign.ad_attribution", outcome: "partial", attributes: { errorCode: "media_unverified" },
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  vi.stubEnv("AD_RESULTS_ENABLED", "true");
  boundary.events.mockReset();
  boundary.saveCampaign.mockReset().mockResolvedValue({ data: { id: "campaign-row" }, error: null });
  boundary.saveSnapshot.mockReset().mockResolvedValue({ error: null });
  boundary.saveLinks.mockReset().mockResolvedValue({ error: null });
  boundary.create.mockReset().mockImplementation(async ({ onCheckpoint }: {
    onCheckpoint: (event: CampaignMutationCheckpoint) => Promise<void>;
  }) => {
    await onCheckpoint({ phase: "creative", externalId: "501", variantIndex: 0, creativeIndex: 0 });
    await onCheckpoint({ phase: "ad", externalId: "101", variantIndex: 0, creativeIndex: 0 });
    return { destination: "whatsapp", campaignId: "1", adSetId: "2", adSetIds: ["2"], adIds: ["101"], creativeIds: ["501"] };
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("core: launch media attribution with the recorded reviewed message (#789)", () => {
  it.each([
    { name: "creative read error", readLinks: async () => ({ data: null, error: { message: "unavailable" } }), assetFailure: false },
    { name: "creative read rejection", readLinks: async () => { throw new Error("unavailable"); }, assetFailure: false },
    { name: "asset read error", readLinks: async () => links(), assetFailure: true },
  ])("keeps attribution unknown after $name", async ({ readLinks, assetFailure }) => {
    const assets = assetFailure ? { data: null, error: { message: "unavailable" } } : undefined;
    const { completion, reads } = launch(readLinks, assets);
    expect((await completion).kind).toBe("succeeded");
    expectUnknownSnapshot();
    expect(reads[0]).toEqual({ table: "creatives", field: "id", ids: [creative.id], scope: "business_id", businessId });
    if (assetFailure) expect(reads[1]).toEqual({ table: "media_assets", field: "id", ids: [assetId], scope: "business_id", businessId });
  });

  it("times out at 1.5 seconds and never writes an empty binding, even if the read later succeeds", async () => {
    const delayed = Promise.withResolvers<LinkResult>();
    const { completion, started } = launch(() => delayed.promise);
    await started;
    const settled = vi.fn();
    void completion.then(settled);
    await vi.advanceTimersByTimeAsync(1499);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect((await completion).kind).toBe("succeeded");
    expectUnknownSnapshot();
    delayed.resolve(links());
    await vi.advanceTimersByTimeAsync(0);
    expect(boundary.saveSnapshot).toHaveBeenCalledOnce();
    expect(boundary.saveLinks).not.toHaveBeenCalled();
  });

  it.each([
    { name: "linked photo", mediaAssetId: assetId },
    { name: "no linked photo", mediaAssetId: null },
  ])("records the verified $name normally", async ({ mediaAssetId }) => {
    const { completion, reads } = launch(async () => links(mediaAssetId));
    expect((await completion).kind).toBe("succeeded");
    expect(boundary.saveSnapshot).toHaveBeenCalledOnce();
    const snapshot = boundary.saveSnapshot.mock.calls[0][0].snapshot;
    expect(snapshot).not.toHaveProperty("mediaUnknownAt");
    expect(snapshot.creatives).toEqual([expect.objectContaining({ id: creative.id, mediaAssetId })]);
    expect(snapshot.media).toEqual(mediaAssetId ? [{ mediaAssetId, kind: "image", source: "upload" }] : []);
    expect(boundary.saveLinks).toHaveBeenCalledWith([expect.objectContaining({
      business_id: businessId, campaign_id: "campaign-row", meta_ad_id: "101", meta_creative_id: "501",
      creative_id: creative.id, media_asset_id: mediaAssetId, variant_index: 0, position: 0,
    })], { onConflict: "campaign_id,meta_ad_id", ignoreDuplicates: true });
    expect(reads.filter(read => read.table === "media_assets")).toHaveLength(mediaAssetId ? 1 : 0);
  });
});
