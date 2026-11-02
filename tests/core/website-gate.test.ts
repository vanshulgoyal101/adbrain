import { describe, expect, it, vi } from "vitest";
import { prepareCampaignReview, type PreflightLoaders } from "@/lib/campaign/preflight-service";
import { websiteOpenFor } from "@/lib/campaign/website-gate";
import type { DraftRecord } from "@/lib/campaign/draft-store";
import internal from "@/lib/internal-accounts.json";

// #2688 (CTO on #2595): website ads are internal-only on plan, Review and launch until the CEO opens them.
// Launch and the worker both recompute this Review, so this one gate covers all three server paths.
const businessId = "b123b123-b123-4123-8123-b123b123b123";
const draftId = "d123d123-d123-4123-8123-d123d123d123";
const actor = { businessId, userId: "owner-1" };

function loaders(destination: "website" | "whatsapp" | "instant_form") {
  const record = { id: draftId, businessId, ownerId: actor.userId, version: 1, expiresAt: "2999-01-01T00:00:00Z",
    input: { businessId, name: "Visits", goal: "Visits", mode: "manual", creativeIds: [], dailyBudgetRupees: 500, leadFormId: null, targeting: {}, abTest: false, destination } } as unknown as DraftRecord;
  const loadFailed = () => { throw new Error("stop after the gate"); };
  return { findDraft: vi.fn(async () => record), getConnection: vi.fn(loadFailed), findCreatives: vi.fn(loadFailed),
    resolveGeo: vi.fn(loadFailed), hash: () => "a".repeat(64) } as unknown as PreflightLoaders & { getConnection: ReturnType<typeof vi.fn> };
}
const review = (value: PreflightLoaders, websiteOpen?: () => boolean | Promise<boolean>) =>
  prepareCampaignReview(value, { actor, draftId, requestedDraftVersion: 1, now: "2026-11-01T00:00:00Z", websiteOpen });

describe("core: website ads stay internal-only (#2688)", () => {
  it.each([["no account check is passed", undefined], ["the account isn't internal", () => false], ["the async check says no", async () => false]])(
    "refuses a website draft before any Meta read when %s", async (_name, websiteOpen) => {
      const value = loaders("website");
      expect(await review(value, websiteOpen)).toEqual({ kind: "website_closed" });
      expect(value.getConnection).not.toHaveBeenCalled();
    });

  it("lets an internal account's website draft through to the usual checks", async () => {
    const value = loaders("website");
    await expect(review(value, () => true)).rejects.toThrow("stop after the gate");
    expect(value.getConnection).toHaveBeenCalled();
  });

  it.each(["whatsapp", "instant_form"] as const)("never asks about the account for a %s draft", async (destination) => {
    const websiteOpen = vi.fn(() => false);
    await expect(review(loaders(destination), websiteOpen)).rejects.toThrow("stop after the gate");
    expect(websiteOpen).not.toHaveBeenCalled();
  });

  it("opens website only to team accounts: listed ids, or a confirmed team-domain email", () => {
    expect(websiteOpenFor({ id: internal.userIds[0] })).toBe(true);
    expect(websiteOpenFor({ id: "x", email: `a@${internal.domains[0]}`, email_confirmed_at: "2026-10-01T00:00:00Z" })).toBe(true);
    expect(websiteOpenFor({ id: "x", email: `a@${internal.domains[0]}`, email_confirmed_at: null })).toBe(false);
    expect(websiteOpenFor({ id: "x", email: "owner@gmail.com", email_confirmed_at: "2026-10-01T00:00:00Z" })).toBe(false);
    expect(websiteOpenFor(null)).toBe(false);
  });
});
