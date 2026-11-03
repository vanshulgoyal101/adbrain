import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/meta/pixels.json";
import provisional from "./fixtures/meta/pixel-stats.provisional.json";
import revoked from "./fixtures/meta/token-revoked.json";
import { MetaClient } from "@/lib/meta/client";
import { resetTrackingStatusCache, type TrackingEvent, type TrackingStatus } from "@/lib/meta/pixels";
import { reviewDtoSchema } from "@/lib/campaign/connect-contracts";
import { buildCanonicalReviewPayload, runPreflight, type PreflightInput } from "@/lib/campaign/preflight";
import { prepareCampaignReview, type PreflightLoaders } from "@/lib/campaign/preflight-service";
import { REVIEW_WARNINGS } from "@/lib/campaign/plan-check";
import { websiteGoalOpen } from "@/lib/campaign/website-tracking";
import type { DraftRecord } from "@/lib/campaign/draft-store";

// #2714 (#2595 C2): a website signup or sales goal reviews against the Brand's chosen tracking, as Meta reported it.
// Statuses come from the recorded test ad account (tests/core/meta-pixels.test.ts); "ready" and "event missing" use
// the PROVISIONAL stats shape until the test pixel has real events.
type Exchange = { name: string; method: string; path: string; status: number; body: unknown };
const tape = recorded.tape as Exchange[];
const creds = { ...recorded.creds, accessToken: "core-token" };
const now = new Date(recorded.recordedAt);
const [listCall, statsCall] = tape.filter((exchange) => exchange.name === "tracking");
const pixelId = (listCall.body as { data: { id: string }[] }).data[0].id;
const fired = { status: 200, body: { data: [{ id: pixelId, name: "Site", last_fired_time: "2026-11-01T10:12:00+0000", is_unavailable: false }] } };

async function replay(answers: Record<string, { status: number; body: unknown }>, need: TrackingEvent, chosen?: string): Promise<TrackingStatus> {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (request) => {
    const url = new URL(String(request));
    url.searchParams.delete("access_token");
    const answer = answers[url.pathname.replace(/^\/v\d+\.\d+\//, "") + url.search];
    if (!answer) throw new Error(`Unrecorded Graph call: ${url.pathname}`);
    return Response.json(answer.body, { status: answer.status });
  });
  return new MetaClient(creds).trackingStatus({ now, need, ...(chosen ? { pixelId: chosen } : {}) });
}
const statuses = {
  none: () => replay({ [listCall.path]: { status: 200, body: recorded.noPixels } }, "Lead"),
  quiet: () => replay({ [listCall.path]: listCall, [statsCall.path]: statsCall }, "Lead", pixelId),
  reconnect: () => replay({ [listCall.path]: revoked }, "Lead", pixelId),
  leadReady: () => replay({ [listCall.path]: fired, [statsCall.path]: { status: 200, body: provisional.leadOnly } }, "Lead", pixelId),
  noPurchase: () => replay({ [listCall.path]: fired, [statsCall.path]: { status: 200, body: provisional.leadOnly } }, "Purchase", pixelId),
};

afterEach(() => {
  vi.restoreAllMocks();
  resetTrackingStatusCache();
});

const businessId = "816aaafb-7ebc-4ad7-bbda-001beff172f8";
const creativeId = "e3d165a9-bbf8-47f7-8c61-e69dbb8ee3d1";
function input(websiteGoal: "visits" | "leads" | "sales", tracking?: PreflightInput["tracking"]): PreflightInput {
  return {
    draft: {
      businessId, name: "Cedar Ridge exams", goal: "Book new-patient exams", mode: "manual", destination: "website", websiteGoal,
      creativeIds: [creativeId], dailyBudgetRupees: 200, leadFormId: null, abTest: false,
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
    creatives: [{ id: creativeId, businessId, approved: true, imageUrl: "https://example.com/ad.png", headline: "New-Patient Exam", cta: "Learn more", storyReady: true }],
    form: null,
    website: "https://cedarridgechiro.com",
    websiteReach: { url: "https://cedarridgechiro.com", ok: true, finalUrl: "https://www.cedarridgechiro.com/" },
    tracking,
    geo: { resolvedAreaLabel: "Austin, Texas", unresolvedNames: [], explicitlyNationwide: false, audienceInterests: [{ id: "6840321905207", name: "Wellness" }] },
    hash: (payload) => createHash("sha256").update(payload).digest("hex"),
  };
}
const reasons = (value: PreflightInput) => runPreflight(value).blockers.map((item) => item.reason);

describe("core: a website signup or sales goal needs its tracking to have reported the goal's event (#2714)", () => {
  it("passes a signup goal whose chosen tracking reported a Lead, and pins that tracking in the plan", async () => {
    const review = runPreflight(input("leads", { pixelId, status: await statuses.leadReady() }));
    expect(review.blockers).toEqual([]);
    expect(review.pixelId).toBe(pixelId);
    expect(reviewDtoSchema.parse(review)).toMatchObject({ websiteGoal: "leads", pixelId });
    const other = runPreflight(input("leads", { pixelId: "9000000000000099", status: { ...(await statuses.leadReady()), pixelId: "9000000000000099" } }));
    expect(other.planHash).not.toBe(review.planHash);
  });

  it.each([
    ["an account with no pixel (recorded)", async () => ({ pixelId: null, status: await statuses.none() })],
    ["a pixel that reported nothing in 7 days (recorded)", async () => ({ pixelId, status: await statuses.quiet() })],
    ["an expired connection (recorded)", async () => ({ pixelId, status: await statuses.reconnect() })],
    ["no tracking chosen on the Brand", async () => ({ pixelId: null, status: await statuses.leadReady() })],
    ["Meta's answer is for another pixel", async () => ({ pixelId: "9000000000000099", status: await statuses.leadReady() })],
    ["tracking that couldn't be read", async () => ({ pixelId, status: null })],
    ["no tracking read at all", async () => undefined],
  ] as [string, () => Promise<PreflightInput["tracking"]>][])("blocks a signup goal with %s, never falling back to visits", async (_name, tracking) => {
    const value = input("leads", await tracking());
    const review = runPreflight(value);
    expect(review.blockers.map((item) => item.reason)).toEqual(["REVIEW_TRACKING"]);
    expect(review.blockers[0].action).toEqual({ kind: "open_brand" });
    expect(review.planHash).toBeNull();
    expect(buildCanonicalReviewPayload(value).websiteGoal).toBe("leads");
  });

  it("blocks a sales goal whose tracking reports Leads but no Purchase, naming the window it checked", async () => {
    const review = runPreflight(input("sales", { pixelId, status: await statuses.noPurchase() }));
    expect(review.blockers).toMatchObject([{ reason: "REVIEW_TRACKING", message: expect.stringMatching(/no sale \(Purchase\) from 26 Oct to 2 Nov/) }]);
  });

  it("says reconnect for an expired connection, from the recorded refusal", async () => {
    expect(runPreflight(input("leads", { pixelId, status: await statuses.reconnect() })).blockers[0].message).toMatch(/Connect Facebook again/);
  });

  it("leaves the connection blocker as the one fix when Meta access is missing", () => {
    const value = input("leads");
    value.connection!.canCreatePaused = false;
    expect(reasons(value)).toEqual(["REVIEW_META_ACCESS"]);
  });

  it.each([["leads", "Shop now"], ["leads", "Buy now"], ["sales", "Sign up"], ["sales", "Register"]] as const)(
    "blocks a %s goal whose ad's button says %s", async (goal, cta) => {
      const value = input(goal, { pixelId, status: { ...(await statuses.leadReady()), counts: { Lead: 2, Purchase: 2 } } });
      value.creatives[0].cta = cta;
      expect(reasons(value)).toEqual(["REVIEW_GOAL_WORDS"]);
    });

  it("visits never read tracking or check the button, and keep their phase-1 hash", () => {
    const value = input("visits");
    value.creatives[0].cta = "Shop now";
    expect(reasons(value)).toEqual([]);
    expect(buildCanonicalReviewPayload(value)).not.toHaveProperty("pixelId");
    expect(runPreflight(value)).not.toHaveProperty("pixelId");
  });

  it("warns honestly that a sales goal learns from about 50 sales a week, without touching the budget", async () => {
    const review = runPreflight(input("sales", { pixelId, status: { ...(await statuses.leadReady()), counts: { Lead: 0, Purchase: 3 } } }));
    expect(review.blockers).toEqual([]);
    expect(review.planWarnings).toContain(REVIEW_WARNINGS.sales);
    expect(REVIEW_WARNINGS.sales.length).toBeLessThanOrEqual(200);
    expect(review.perAdSetDailyBudgetRupees).toBe(200);
    expect(runPreflight(input("leads", { pixelId, status: await statuses.leadReady() })).planWarnings ?? []).not.toContain(REVIEW_WARNINGS.sales);
  });
});

describe("core: signup and sales goals stay closed until the CEO opens them (#2714)", () => {
  it("opens only visits", () => {
    expect(websiteGoalOpen()).toBe(true);
    expect(websiteGoalOpen("visits")).toBe(true);
    expect(websiteGoalOpen("leads")).toBe(false);
    expect(websiteGoalOpen("sales")).toBe(false);
  });

  it.each(["leads", "sales"] as const)("refuses a %s draft for an internal account before reading Meta or tracking", async (websiteGoal) => {
    const record = { id: "d1", businessId, ownerId: "owner-1", version: 1, expiresAt: "2999-01-01T00:00:00Z", input: input(websiteGoal).draft } as unknown as DraftRecord;
    const findTracking = vi.fn();
    const getConnection = vi.fn();
    const loaders = { findDraft: async () => record, getConnection, findTracking, findCreatives: vi.fn(), findForm: vi.fn(), resolveGeo: vi.fn(), hash: () => "a".repeat(64) } as unknown as PreflightLoaders;
    const result = await prepareCampaignReview(loaders, { actor: { businessId, userId: "owner-1" }, draftId: "d1", requestedDraftVersion: 1, now: "2026-11-03T00:00:00Z", websiteOpen: () => true });
    expect(result).toEqual({ kind: "website_closed" });
    expect(getConnection).not.toHaveBeenCalled();
    expect(findTracking).not.toHaveBeenCalled();
  });
});
