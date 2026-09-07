import { describe, expect, it } from "vitest";
import { prepareCampaignReview, type PreflightLoaders } from "@/lib/campaign/preflight-service";
import type { DraftRecord } from "@/lib/campaign/draft-store";

const actor = {
  businessId: "b123b123-b123-4123-8123-b123b123b123",
  userId: "u123u123-u123-4123-8123-u123u123u123",
};
const draft: DraftRecord = {
  id: "d123d123-d123-4123-8123-d123d123d123",
  businessId: actor.businessId,
  ownerId: actor.userId,
  version: 2,
  input: {
    businessId: actor.businessId,
    name: "Local leads",
    goal: "Generate leads",
    mode: "manual",
    creativeIds: ["c123c123-c123-4123-8123-c123c123c123"],
    dailyBudgetRupees: 500,
    leadFormId: "form-1",
    targeting: {},
    abTest: false,
  },
  expiresAt: "2026-09-14T10:00:00.000Z",
  createdAt: "2026-09-07T10:00:00.000Z",
  updatedAt: "2026-09-07T10:00:00.000Z",
};

function loaders(overrides: Partial<PreflightLoaders> = {}): PreflightLoaders {
  return {
    findDraft: async () => draft,
    findCreatives: async () => [{
      id: draft.input.creativeIds[0],
      businessId: actor.businessId,
      approved: true,
      imageUrl: "https://example.com/ad.png",
      headline: "Local help",
    }],
    findForm: async () => ({ id: "form-1", businessId: actor.businessId, active: true }),
    getConnection: async () => ({
      generation: 4,
      selected: {
        metaBusinessId: null,
        adAccountId: "act_1",
        accountName: "Account",
        pageId: "page_1",
        pageName: "Page",
        currency: "INR",
        timezoneName: "Asia/Kolkata",
      },
      canCreatePaused: true,
    }),
    resolveGeo: async () => ({ resolvedAreaLabel: "Jaipur", unresolvedNames: [], explicitlyNationwide: false }),
    hash: () => "a".repeat(64),
    ...overrides,
  };
}

describe("campaign preflight orchestration", () => {
  it("loads exact owned inputs and returns a reviewed plan", async () => {
    const calls: string[] = [];
    const result = await prepareCampaignReview({
      ...loaders(),
      findDraft: async (...args) => {
        calls.push(`draft:${args[1]}`);
        return draft;
      },
      findCreatives: async (businessId, ids) => {
        calls.push(`creatives:${businessId}:${ids.join(",")}`);
        return loaders().findCreatives(businessId, ids);
      },
      findForm: async (businessId, formId) => {
        calls.push(`form:${businessId}:${formId}`);
        return loaders().findForm(businessId, formId);
      },
      getConnection: async (currentActor) => {
        calls.push(`connection:${currentActor.businessId}`);
        return loaders().getConnection(currentActor);
      },
      resolveGeo: async (currentActor) => {
        calls.push(`geo:${currentActor.businessId}`);
        return loaders().resolveGeo(currentActor, draft);
      },
    }, { actor, draftId: draft.id, requestedDraftVersion: 2, now: "2026-09-07T10:00:00.000Z" });

    expect(result.kind).toBe("review");
    if (result.kind !== "review") throw new Error("expected review");
    expect(result.review.canCreatePaused).toBe(true);
    expect(calls).toEqual([
      `draft:${draft.id}`,
      `connection:${actor.businessId}`,
      `creatives:${actor.businessId}:${draft.input.creativeIds[0]}`,
      `form:${actor.businessId}:form-1`,
      `geo:${actor.businessId}`,
    ]);
  });

  it("returns stale before any provider-dependent loader runs", async () => {
    let providerLoads = 0;
    const result = await prepareCampaignReview(loaders({
      getConnection: async () => {
        providerLoads += 1;
        return null;
      },
      findCreatives: async () => {
        providerLoads += 1;
        return [];
      },
      findForm: async () => {
        providerLoads += 1;
        return null;
      },
      resolveGeo: async () => {
        providerLoads += 1;
        return { resolvedAreaLabel: null, unresolvedNames: [], explicitlyNationwide: false };
      },
    }), { actor, draftId: draft.id, requestedDraftVersion: 1, now: "2026-09-07T10:00:00.000Z" });

    expect(result).toEqual({ kind: "stale", draftVersion: 2 });
    expect(providerLoads).toBe(0);
  });

  it("rejects a draft owned by another actor before provider access", async () => {
    let providerLoads = 0;
    const result = await prepareCampaignReview(loaders({
      findDraft: async () => ({ ...draft, ownerId: "other-user" }),
      getConnection: async () => {
        providerLoads += 1;
        return null;
      },
    }), { actor, draftId: draft.id, requestedDraftVersion: 2, now: "2026-09-07T10:00:00.000Z" });

    expect(result).toEqual({ kind: "forbidden" });
    expect(providerLoads).toBe(0);
  });

  it("treats an expired owned draft as unavailable before provider access", async () => {
    let providerLoads = 0;
    const result = await prepareCampaignReview(loaders({
      findDraft: async () => ({ ...draft, expiresAt: "2026-09-07T09:59:59.999Z" }),
      getConnection: async () => {
        providerLoads += 1;
        return null;
      },
    }), { actor, draftId: draft.id, requestedDraftVersion: 2, now: "2026-09-07T10:00:00.000Z" });

    expect(result).toEqual({ kind: "not_found" });
    expect(providerLoads).toBe(0);
  });
});