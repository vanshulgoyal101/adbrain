import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { draftInputSchema, reviewDtoSchema } from "@/lib/campaign/connect-contracts";
import * as websiteRules from "@/lib/campaign/website-review";
import { buildCanonicalReviewPayload, runPreflight, type PreflightInput } from "@/lib/campaign/preflight";
import { prepareCampaignReview, type PreflightLoaders } from "@/lib/campaign/preflight-service";
import { WHATSAPP_PICTURE_ON_FORM, WHATSAPP_PICTURE_ON_WEBSITE } from "@/lib/campaign/plan-check";
import type { DraftRecord } from "@/lib/campaign/draft-store";

// #2599: a website ad opens the advertiser's own site, so Review needs the site, a working link, and no lead form.
const businessId = "816aaafb-7ebc-4ad7-bbda-001beff172f8";
const creativeId = "e3d165a9-bbf8-47f7-8c61-e69dbb8ee3d1";

function input(destination: "instant_form" | "whatsapp" | "website" = "website"): PreflightInput {
  return {
    draft: {
      businessId, name: "Cedar Ridge exams", goal: "Book new-patient exams", mode: "manual",
      destination,
      creativeIds: [creativeId], dailyBudgetRupees: 200, leadFormId: destination === "instant_form" ? "form-1" : null, abTest: false,
      targeting: {
        location: { mode: "ai", cityScope: "city_only", includedNames: ["Austin, Texas"] },
        age: { mode: "manual", min: 25, max: 55 },
        audience: { interestNames: ["Wellness"], rationale: "Adults near the clinic." },
      },
    },
    draftId: "90d1d2bb-466c-4889-9af2-edb533e82531",
    draftVersion: 2,
    connection: { generation: 1, canCreatePaused: true, selected: {
      metaBusinessId: null, adAccountId: "act_1", accountName: "Account", pageId: "page_1", pageName: "Page", currency: "INR", timezoneName: "Asia/Kolkata",
    } },
    creatives: [{ id: creativeId, businessId, approved: true, imageUrl: "https://example.com/ad.png", headline: "New-Patient Exam" }],
    form: destination === "instant_form" ? { id: "form-1", businessId, active: true } : null,
    whatsappNumber: "+919876543210",
    website: "https://cedarridgechiro.com",
    websiteReach: { url: "https://cedarridgechiro.com", ok: true, finalUrl: "https://www.cedarridgechiro.com/" },
    geo: { resolvedAreaLabel: "Austin, Texas", unresolvedNames: [], explicitlyNationwide: false, audienceInterests: [{ id: "6840321905207", name: "Wellness" }] },
    hash: (payload) => payload,
  };
}

describe("Review of a website ad (#2599)", () => {
  it.each([
    ["website", "f27ca52fdf20f4cf1d33c4be363e68ebe08b6b4a5de2b39bf46535357a805e68"],
    ["whatsapp", "3bd4804e5401affd3a5576b60d9e699dffcc22c53b82755ca36e5deafdb43dfe"],
    ["instant_form", "8170f95e6ab7f0c3749854b6102480e5b50a8e6d52101b76422c0140e0755f4c"],
  ] as const)("keeps the phase-1 %s plan hash unchanged (#2710)", (destination, expectedHash) => {
    const value = input(destination);
    value.hash = (payload) => createHash("sha256").update(payload).digest("hex");
    expect(runPreflight(value).planHash).toBe(expectedHash);
  });

  it("accepts explicit visits without changing the existing website hash or adding goal/tracking fields", () => {
    const value = input();
    const before = runPreflight(value);
    value.draft = draftInputSchema.parse({ ...value.draft, websiteGoal: "visits" });
    expect(runPreflight(value).planHash).toBe(before.planHash);
    expect(buildCanonicalReviewPayload(value)).not.toHaveProperty("websiteGoal");
    expect(buildCanonicalReviewPayload(value)).not.toHaveProperty("pixelId");
  });

  it.each(["leads", "sales"] as const)("keeps the %s website goal in the schema, Review and canonical payload", (websiteGoal) => {
    const value = input();
    const before = runPreflight(value);
    value.draft = draftInputSchema.parse({ ...value.draft, websiteGoal });
    expect(buildCanonicalReviewPayload(value)).toMatchObject({ websiteGoal });
    const review = runPreflight(value);
    expect(review.planHash).not.toBe(before.planHash);
    expect(reviewDtoSchema.parse({ ...review, planHash: "a".repeat(64), creativeHash: "b".repeat(64) })).toMatchObject({ websiteGoal });
  });

  it.each([
    [undefined, "traffic"], ["visits", "traffic"], ["leads", "leads"], ["sales", "sales"],
  ] as const)("maps website goal %s to stored objective %s", (goal, objective) => {
    expect(websiteRules.websiteGoalObjective(goal)).toBe(objective);
  });

  it("keeps a legacy draft and Review without a materialized goal", () => {
    expect(draftInputSchema.parse(input().draft)).not.toHaveProperty("websiteGoal");
    const review = runPreflight(input());
    expect(reviewDtoSchema.parse({ ...review, planHash: "a".repeat(64), creativeHash: "b".repeat(64) })).not.toHaveProperty("websiteGoal");
  });

  it.each(["whatsapp", "instant_form", undefined] as const)("rejects conversion goals in a %s Review DTO", (destination) => {
    const review = runPreflight(input());
    for (const websiteGoal of ["leads", "sales"]) {
      expect(reviewDtoSchema.safeParse({ ...review, destination, websiteGoal, planHash: "a".repeat(64), creativeHash: "b".repeat(64) }).success).toBe(false);
    }
  });

  it("passes with the advertiser's reachable website and no lead form", () => {
    expect(runPreflight(input()).blockers).toEqual([]);
  });

  it.each([
    ["no website", (v: PreflightInput) => { v.website = null; }],
    ["the website isn't checked by the caller", (v: PreflightInput) => { v.website = undefined; }],
    ["a Facebook page instead of a website", (v: PreflightInput) => { v.website = "https://www.facebook.com/cedarridge"; }],
    // Launch's isWebsiteLink refuses every Meta and WhatsApp domain, so Review must too.
    ["a Messenger link", (v: PreflightInput) => { v.website = "https://messenger.com/t/cedarridge"; }],
    ["a wa.link shortcut", (v: PreflightInput) => { v.website = "https://wa.link/cedarridge"; }],
  ])("blocks on REVIEW_NO_WEBSITE: %s", (_name, change) => {
    const value = input();
    change(value);
    expect(runPreflight(value).blockers).toEqual([expect.objectContaining({
      reason: "REVIEW_NO_WEBSITE", action: { kind: "open_brand" }, message: expect.stringMatching(/website ad opens your own site/),
    })]);
  });

  it.each([
    ["not checked", undefined, /couldn't open your website cedarridgechiro\.com/],
    ["unreachable", { url: "https://cedarridgechiro.com", ok: false, problem: "unreachable" }, /couldn't open your website cedarridgechiro\.com/],
    ["an error status", { url: "https://cedarridgechiro.com", ok: false, problem: "status", status: 503 }, /answered with an error \(503\)/],
    ["a private address", { url: "https://cedarridgechiro.com", ok: false, problem: "blocked" }, /isn't a public website address/],
    ["a redirect to another site", { url: "https://cedarridgechiro.com", ok: false, problem: "other_domain", finalHost: "parked-domains.example" }, /sends visitors on to parked-domains\.example/],
    // CPO on #2634: a pass for another page or an older address isn't a check of the link this ad sends people to.
    ["checked at a different address", { url: "https://cedarridgechiro.com/old-offer", ok: true, finalUrl: "https://cedarridgechiro.com/old-offer" }, /couldn't open your website cedarridgechiro\.com/],
  ] as const)("blocks on REVIEW_WEBSITE_UNREACHABLE when the link is %s", (_name, reach, message) => {
    const value = input();
    value.websiteReach = reach as PreflightInput["websiteReach"];
    expect(runPreflight(value).blockers).toEqual([expect.objectContaining({
      code: "PREFLIGHT_BLOCKED", reason: "REVIEW_WEBSITE_UNREACHABLE", action: { kind: "open_brand" }, message: expect.stringMatching(message),
    })]);
  });

  it("checks and sends an http website at its https address, the only kind Meta's website ads take", () => {
    const value = input();
    value.website = "http://cedarridgechiro.com";
    expect(runPreflight(value).blockers).toEqual([]);
    expect(buildCanonicalReviewPayload(value)).toMatchObject({ websiteUrl: "https://cedarridgechiro.com" });
    expect(runPreflight(value).websiteUrl).toBe("https://cedarridgechiro.com");
  });

  it("still lets a form ad link an http website, as before", () => {
    const value = input("instant_form");
    value.website = "http://cedarridgechiro.com";
    expect(runPreflight(value).blockers).toEqual([]);
  });

  it("puts the website in the reviewed plan, so a Brand website edit after Review is a different plan", () => {
    const value = input();
    const payload = buildCanonicalReviewPayload(value);
    expect(payload).toMatchObject({ websiteUrl: "https://cedarridgechiro.com", leadFormId: null });
    value.website = "https://cedarridge.example";
    expect(buildCanonicalReviewPayload(value)).not.toEqual(payload);
  });

  it("leaves form and WhatsApp plans as they were: no websiteUrl in their reviewed plan", () => {
    expect(buildCanonicalReviewPayload(input("instant_form"))).not.toHaveProperty("websiteUrl");
    expect(buildCanonicalReviewPayload(input("whatsapp"))).not.toHaveProperty("websiteUrl");
    expect(runPreflight(input("instant_form"))).not.toHaveProperty("websiteUrl");
    expect(buildCanonicalReviewPayload(input("instant_form")).leadFormId).toBe("form-1");
  });

  it("warns when a picture asks for a WhatsApp message on a website ad, in the website's words", () => {
    const website = input();
    website.creatives[0].asksWhatsApp = true;
    expect(runPreflight(website).planWarnings).toContain(WHATSAPP_PICTURE_ON_WEBSITE);
    const form = input("instant_form");
    form.creatives[0].asksWhatsApp = true;
    expect(runPreflight(form).planWarnings).toContain(WHATSAPP_PICTURE_ON_FORM);
  });
});

describe("prepareCampaignReview checks a website ad's link (#2599)", () => {
  function loaders(destination: "instant_form" | "website", overrides: Partial<PreflightLoaders> = {}): PreflightLoaders {
    const base = input(destination);
    const record = { id: base.draftId, businessId, ownerId: "owner-1", version: 2, expiresAt: "2999-01-01T00:00:00Z", input: base.draft } as DraftRecord;
    return {
      findDraft: async () => record,
      findCreatives: async () => base.creatives,
      findForm: vi.fn(async () => base.form!),
      findWebsite: async () => "cedarridgechiro.com",
      findCostPerResult: vi.fn(async () => 40),
      isMediaPilot: () => false,
      getConnection: async () => base.connection,
      resolveGeo: async () => base.geo,
      hash: () => "a".repeat(64),
      ...overrides,
    };
  }
  const run = (value: PreflightLoaders) => prepareCampaignReview(value, {
    actor: { businessId, userId: "owner-1" }, draftId: "90d1d2bb-466c-4889-9af2-edb533e82531", requestedDraftVersion: 2, now: "2026-11-01T00:00:00Z", websiteOpen: () => true,
  });

  it("opens the normalized website and passes when it reaches the advertiser's site; no form or chat-cost lookup", async () => {
    const checkWebsite = vi.fn(async (url: string) => ({ url, ok: true as const, finalUrl: "https://cedarridgechiro.com/" }));
    const value = loaders("website", { checkWebsite });
    const result = await run(value);
    expect(checkWebsite).toHaveBeenCalledWith("https://cedarridgechiro.com");
    expect(value.findForm).not.toHaveBeenCalled();
    expect(value.findCostPerResult).not.toHaveBeenCalled();
    expect(result.kind === "review" && result.review.blockers).toEqual([]);
  });

  it.each([
    ["the check throws", { checkWebsite: async () => { throw new Error("socket hang up"); } }],
    ["no checker is wired", {}],
  ])("fails closed when %s", async (_name, overrides) => {
    const result = await run(loaders("website", overrides));
    expect(result.kind === "review" && result.review.blockers.map((item) => item.reason)).toEqual(["REVIEW_WEBSITE_UNREACHABLE"]);
  });

  it("never opens the website for a form campaign", async () => {
    const checkWebsite = vi.fn();
    const result = await run(loaders("instant_form", { checkWebsite }));
    expect(checkWebsite).not.toHaveBeenCalled();
    expect(result.kind === "review" && result.review.blockers).toEqual([]);
  });

  it("applies pilot eligibility from the authorized actor during Review, never from the draft", async () => {
    const value = loaders("instant_form");
    const original = value.findDraft;
    const creativeIds = Array.from({ length: 7 }, (_, index) => `${creativeId}-${index}`);
    value.findDraft = async (actor, id) => {
      const record = await original(actor, id);
      return record && { ...record, input: { ...record.input, creativeIds } };
    };
    value.findCreatives = async () => creativeIds.map((id) => ({ ...input("instant_form").creatives[0], id }));
    const isMediaPilot = vi.fn(() => true);
    Object.assign(value, { isMediaPilot });
    const result = await run(value);
    expect(isMediaPilot).toHaveBeenCalledWith({ businessId, userId: "owner-1" });
    expect(result.kind === "review" && result.review.canCreatePaused).toBe(false);
    expect(result.kind === "review" && result.review.blockers.some((item) => item.reason === "REVIEW_CREATIVES")).toBe(true);
  });
});
