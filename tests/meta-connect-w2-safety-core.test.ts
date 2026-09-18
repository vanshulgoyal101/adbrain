import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { buildCanonicalReviewPayload, checkReviewFreshness, runPreflight } from "@/lib/campaign/preflight";
import { claimOperation, finishOperation, markNeedsReconciliation, recordExternalId } from "@/lib/campaign/operations";

const selected = {
  metaBusinessId: null,
  adAccountId: "act_123",
  accountName: "Account",
  pageId: "page-1",
  pageName: "Page",
  currency: "INR",
  timezoneName: "Asia/Kolkata",
};
const draft = {
  businessId: "11111111-1111-4111-8111-111111111111",
  name: "Local leads",
  goal: "Get leads",
  mode: "manual" as const,
  creativeIds: ["22222222-2222-4222-8222-222222222222"],
  dailyBudgetRupees: 500,
  leadFormId: "form-1",
  targeting: { age: { mode: "manual" as const, min: 18, max: 65 }, audience: { interestNames: ["Solar energy"], rationale: "Reach people interested in solar energy." } },
  abTest: true,
};

function input(over: Partial<Parameters<typeof runPreflight>[0]> = {}) {
  return {
    draft,
    draftId: "33333333-3333-4333-8333-333333333333",
    draftVersion: 1,
    connection: { generation: 4, selected, canCreatePaused: true },
    creatives: [{ id: draft.creativeIds[0], businessId: draft.businessId, approved: true, imageUrl: "https://image.test/ad.png", headline: "Local help" }],
    form: { id: "form-1", businessId: draft.businessId, active: true },
    geo: { resolvedAreaLabel: "Jaipur", unresolvedNames: [], explicitlyNationwide: false, audienceInterests: [{ id: "12345", name: "Solar energy" }] },
    hash: () => "a".repeat(64),
    ...over,
  };
}

describe("campaign preflight", () => {
  it.each([undefined, { interestNames: [], rationale: "Broad audience" }])("blocks missing detailed targeting: %j", (audience) => {
    const review = runPreflight(input({ draft: { ...draft, targeting: { ...draft.targeting, audience } } }));
    expect(review.canCreatePaused).toBe(false);
    expect(review.planHash).toBeNull();
    expect(review.blockers.some((item) => item.message.includes("detailed targeting"))).toBe(true);
  });

  it("invalidates review when gender changes", () => {
    const hashes = (["all", "men", "women"] as const).map(gender => runPreflight(input({
      draft: { ...draft, targeting: { ...draft.targeting, gender } },
      hash: payload => createHash("sha256").update(payload).digest("hex"),
    })).planHash);
    expect(hashes.every(Boolean)).toBe(true);
    expect(new Set(hashes).size).toBe(3);
  });

  it("blocks WhatsApp publishing even with a verified number and retains its draft review data", () => {
    const base = input({ draft: { ...draft, destination: "whatsapp", leadFormId: null }, form: null,
      whatsappNumber: "+919876543210", hash: payload => createHash("sha256").update(payload).digest("hex") });
    const review = runPreflight(base);
    expect(review.canCreatePaused).toBe(false);
    expect(review.planHash).toBeNull();
    expect(review.blockers).toContainEqual(expect.objectContaining({ message: expect.stringContaining("WhatsApp publishing is not yet available") }));
    expect(review.destination).toBe("whatsapp");
    expect(review.whatsappNumber).toBe("+919876543210");
    expect(runPreflight({ ...base, whatsappNumber: null }).canCreatePaused).toBe(false);
    expect(buildCanonicalReviewPayload({ ...base, whatsappNumber: "+919876543211" })).not.toEqual(buildCanonicalReviewPayload(base));
    expect(runPreflight({ ...base, draft: { ...draft, destination: "instant_form" }, form: input().form }).canCreatePaused).toBe(true);
  });

  it.each(["imageUrl", "headline", "primaryText", "cta"] as const)("invalidates review when creative %s changes", (field) => {
    const original = input({ hash: payload => createHash("sha256").update(payload).digest("hex") });
    const review = runPreflight(original);
    const changed = runPreflight({ ...original, creatives: [{ ...original.creatives[0], [field]: "changed" }] });
    expect(changed.planHash).not.toBe(review.planHash);
    expect(changed.creativeHash).not.toBe(review.creativeHash);
  });

  it("binds resolved geographic IDs and exclusions, not just their labels", () => {
    const reviewFor = (key: string, excludedKey: string) => runPreflight(input({
      geo: { resolvedAreaLabel: "Jaipur", unresolvedNames: [], explicitlyNationwide: false, location: { cities: [{ key }] }, excludedLocation: { regions: [{ key: excludedKey }] }, audienceInterests: [{ id: "12345", name: "Solar energy" }] },
      hash: (payload) => createHash("sha256").update(payload).digest("hex"),
    }));
    const review = reviewFor("123", "456");
    expect(review.resolvedLocation).toEqual({ cities: [{ key: "123" }] });
    expect(review.planHash).not.toBe(reviewFor("789", "456").planHash);
    expect(review.planHash).not.toBe(reviewFor("123", "789").planHash);
  });
  it("blocks empty creative selections before creating an empty campaign", () => {
    const review = runPreflight(input({ draft: { ...draft, creativeIds: [] }, creatives: [] }));
    expect(review.canCreatePaused).toBe(false);
    expect(review.planHash).toBeNull();
  });

  it("requires a one-to-one match between unique selected and approved creatives", () => {
    const original = input();
    const duplicated = { ...draft, creativeIds: [draft.creativeIds[0], draft.creativeIds[0]] };
    const review = runPreflight(input({ draft: duplicated, creatives: [original.creatives[0], original.creatives[0]] }));
    expect(review.canCreatePaused).toBe(false);
  });
  it("binds provider-resolved interest IDs to the review hash", () => {
    const targeting = { ...draft.targeting, audience: { interestNames: ["Solar energy"], rationale: "Test this commercial interest." } };
    const reviewFor = (id: string) => runPreflight(input({
      draft: { ...draft, targeting },
      geo: { resolvedAreaLabel: "Jaipur", unresolvedNames: [], explicitlyNationwide: false, audienceInterests: [{ id, name: "Solar energy" }] },
      hash: (payload) => createHash("sha256").update(payload).digest("hex"),
    }));
    expect(reviewFor("12345").canCreatePaused).toBe(true);
    expect(reviewFor("12345").planHash).not.toBe(reviewFor("67890").planHash);
  });

  it("blocks unresolved interests instead of dropping them", () => {
    const review = runPreflight(input({
      draft: { ...draft, targeting: { ...draft.targeting, audience: { interestNames: ["Solar energy"], rationale: "Test this interest." } } },
      geo: { resolvedAreaLabel: "Jaipur", unresolvedNames: [], explicitlyNationwide: false, unresolvedInterests: ["Solar energy"] },
    }));
    expect(review.canCreatePaused).toBe(false);
    expect(review.planHash).toBeNull();
    expect(review.blockers.some((blocker) => blocker.message.includes("interest"))).toBe(true);
  });

  it.each([
    {}, { age: { mode: "ai" as const, min: 25, max: 55 } },
    { age: { mode: "manual" as const, min: 55, max: 25 } },
    { age: { mode: "manual" as const, min: 25, max: 55 }, location: { radiusKm: 5 } },
  ])("blocks incomplete or unsupported targeting during preflight: %j", (targeting) => {
    expect(runPreflight(input({ draft: { ...draft, targeting } })).canCreatePaused).toBe(false);
  });
  it("blocks unresolved geography without broadening to nationwide", () => {
    const review = runPreflight(input({ geo: { resolvedAreaLabel: null, unresolvedNames: ["Unknown"], explicitlyNationwide: false } }));
    expect(review.canCreatePaused).toBe(false);
    expect(review.resolvedAreaLabel).toBeNull();
    expect(review.totalDailyBudgetRupees).toBe(1000);
  });

  it("blocks missing currency, form, capability, or creative ownership", () => {
    const review = runPreflight(input({
      connection: { generation: 4, selected: { ...selected, currency: "USD" }, canCreatePaused: false },
      creatives: [],
      form: null,
    }));
    expect(review.canCreatePaused).toBe(false);
    expect(review.planHash).toBeNull();
    expect(review.blockers.length).toBeGreaterThanOrEqual(4);
  });

  it("builds the same review payload for nested object key order changes", () => {
    let firstHashInput = "";
    let secondHashInput = "";
    const firstTargeting = {
      location: { mode: "manual" as const, included: [], excluded: [], radiusKm: 25 },
      age: { mode: "manual" as const, min: 25, max: 55 },
    };
    const secondTargeting = {
      age: { max: 55, min: 25, mode: "manual" as const },
      location: { radiusKm: 25, excluded: [], included: [], mode: "manual" as const },
    };
    runPreflight(input({
      draft: { ...draft, targeting: firstTargeting },
      hash: (payload) => {
        firstHashInput = payload;
        return "a".repeat(64);
      },
    }));
    runPreflight(input({
      draft: { ...draft, targeting: secondTargeting },
      hash: (payload) => {
        secondHashInput = payload;
        return "a".repeat(64);
      },
    }));

    expect(firstHashInput).toBe(secondHashInput);
  });

  it("rejects stale draft, connection, hash, and blocked reviews before execution", () => {
    const review = runPreflight(input());
    if (!review.planHash) throw new Error("expected a valid review hash");

    expect(checkReviewFreshness(review, {
      draftVersion: review.draftVersion + 1,
      connectionGeneration: review.connectionGeneration,
      planHash: review.planHash,
    })).toEqual({ fresh: false, reason: "DRAFT_CHANGED" });
    expect(checkReviewFreshness(review, {
      draftVersion: review.draftVersion,
      connectionGeneration: review.connectionGeneration + 1,
      planHash: review.planHash,
    })).toEqual({ fresh: false, reason: "CONNECTION_CHANGED" });
    expect(checkReviewFreshness(review, {
      draftVersion: review.draftVersion,
      connectionGeneration: review.connectionGeneration,
      planHash: "b".repeat(64),
    })).toEqual({ fresh: false, reason: "REVIEW_CHANGED" });

    const blocked = runPreflight(input({ geo: { resolvedAreaLabel: null, unresolvedNames: ["Unknown"], explicitlyNationwide: false } }));
    expect(checkReviewFreshness(blocked, {
      draftVersion: blocked.draftVersion,
      connectionGeneration: blocked.connectionGeneration,
      planHash: "a".repeat(64),
    })).toEqual({ fresh: false, reason: "PREFLIGHT_BLOCKED" });
  });
});

describe("durable operation decisions", () => {
  it("replays terminal operations and conflicts on changed payloads", () => {
    const first = claimOperation(null, { businessId: "b1", idempotencyKey: "idem-1234", requestHash: "hash-1", connectionGeneration: 1 }, 0, 1000, "op-1");
    expect(first.kind).toBe("claimed");
    if (first.kind !== "claimed") return;
    const done = finishOperation(first.operation, "campaign-1");
    expect(claimOperation(done, { businessId: "b1", idempotencyKey: "idem-1234", requestHash: "hash-1", connectionGeneration: 1 }, 1, 1000, "op-2").kind).toBe("replay");
    expect(claimOperation(done, { businessId: "b1", idempotencyKey: "idem-1234", requestHash: "hash-2", connectionGeneration: 1 }, 1, 1000, "op-2").kind).toBe("conflict");
  });

  it("retains known IDs and marks possible timeout outcomes for reconciliation", () => {
    const first = claimOperation(null, { businessId: "b1", idempotencyKey: "idem-1234", requestHash: "hash-1", connectionGeneration: 1 }, 0, 1000, "op-1");
    if (first.kind !== "claimed") throw new Error("expected claim");
    const checkpointed = recordExternalId(first.operation, "campaign-1");
    const reconciled = markNeedsReconciliation(checkpointed, "Meta response was ambiguous.");
    expect(reconciled.externalIds).toEqual(["campaign-1"]);
    expect(reconciled.state).toBe("needs_reconciliation");
  });
});