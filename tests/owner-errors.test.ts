import { describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import hi from "../messages/hi.json";
import { ownerErrorIn, type OwnerErrorKey } from "@/i18n/locale";

const cookie = vi.hoisted(() => ({ lang: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "adbrain_lang" && cookie.lang ? { value: cookie.lang } : undefined) }),
}));
const budget = vi.hoisted(() => ({ edit: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { business_id: "biz-1", meta_campaign_id: "meta-1" } }) }) }) }),
  }),
}));
vi.mock("@/lib/campaign/campaign-owner", () => ({ ownerRefusal: async () => null }));
vi.mock("@/lib/meta/connection-access", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/meta/connection-access")>(),
  requireOwnedBusiness: async () => ({ businessId: "biz-1", userId: "user-1" }),
}));
vi.mock("@/lib/campaign/budget-edit-service", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/campaign/budget-edit-service")>(),
  editCampaignBudget: budget.edit,
}));

// #2305/#2314: owner-facing errors (the #2225 plain words), byte-identical in English; routes match on status and `code`, not this text.
const ENGLISH: Record<OwnerErrorKey, string> = {
  draftSaveUnavailable: "We couldn't save your campaign just now. Try again in a minute.",
  tooManyDrafts: "You have too many unfinished campaigns. Finish or remove one, then try again.",
  somethingDidntAnswer: "Something on our side didn't answer. Nothing was started; try again in a minute.",
  backgroundDidntStart: "Something on our side didn't answer. No new background was started; try again in a minute.",
  aiAllowanceUsed: "You've used this month's AI allowance for this business. Ask AdBrain to raise it.",
  checkAdsUnavailable: "We couldn't check on your ads just now. Try again in a minute.",
  adsDidntFinish: "Your ads didn't finish. Some may already be saved: tap Check saved results before you try again.",
  // #2314: Manage (refresh, sync, budget, ad pause).
  notOnMetaYet: "This campaign isn't on Meta yet, so there are no results to refresh.",
  refreshNeedsCheck: "This campaign's ad account needs a check before its results can refresh. Message us if this stays.",
  refreshFailed: "We couldn't refresh the results just now. Try again in a minute.",
  resultsNotSaved: "We got the new results but couldn't save them. Refresh again.",
  syncFailed: "We couldn't bring in your campaigns from Meta just now. Your campaigns here are safe; try again.",
  editsUnavailable: "Campaign edits are unavailable. Try again.",
  editNotRecorded: "Campaign edit could not be recorded. Nothing was changed.",
  changeInProgress: "This change is already in progress.",
  onlyEditOwn: "AdBrain can only edit campaigns it launched.",
  onlyChangeOwn: "AdBrain can only change campaigns it launched.",
  budgetEarlierAttempt: "An earlier attempt may have changed the budget in Meta. Check the campaign before changing it again.",
  budgetNotRunning: "Only a running or paused campaign's budget can be changed.",
  runEnded: "This run has ended. Start a new run instead.",
  cappedRunUseTotal: "This run has a total cap and an end date. Change those instead of the daily budget.",
  pauseForDaily: "Pause the campaign to change its daily budget; it resumes at the new amount after your review.",
  spendLimitsUnverified: "Spend limits could not be verified. Try again.",
  fundingUnverified: "Campaign funding could not be verified. Try again.",
  managedCapRaise: "Raising the total cap of a run paid from your AdBrain balance isn't available yet. Lower it, change the end date, or start a new run.",
  nothingToChange: "Nothing to change: the budget, cap and end date are as they are now.",
  confirmBudget: "Confirm the new amount first: it's more than you approved.",
  budgetNotRecorded: "Meta changed the budget but AdBrain could not record it. Check the campaign before changing it again.",
  budgetRateLimited: "Meta needs 30 seconds between budget changes. Try again in a moment.",
  budgetFailed: "Could not change the budget.",
  adPauseNotRunning: "Only a running campaign's ads can be paused here.",
  adNotInCampaign: "This ad isn't part of the campaign.",
  adNotPausedByAdBrain: "AdBrain didn't pause this ad, so it won't turn it on. Use Meta if you want it back.",
  adMetaDidntChange: "Meta didn't change the ad. Nothing changed.",
  adMetaUnconfirmed: "Meta didn't confirm the change. Refresh the campaign before trying again.",
  adNotRecorded: "Meta changed the ad but AdBrain could not record it. Check the campaign before changing it again.",
};
const keys = Object.keys(ENGLISH) as OwnerErrorKey[];

describe("owner errors (#2305)", () => {
  it("has the same keys in English and Hindi", () => {
    expect(Object.keys(en.errors).sort()).toEqual([...keys].sort());
    expect(Object.keys(hi.errors).sort()).toEqual([...keys].sort());
  });

  it.each(keys)("%s reads the same in English and is Hindi for हिन्दी", (key) => {
    expect(ownerErrorIn("en", key)).toBe(ENGLISH[key]);
    const hindi = ownerErrorIn("hi", key);
    expect(hindi).toBe(hi.errors[key]);
    expect(hindi).toMatch(/[\u0900-\u097F]/);
  });

  it("follows the owner's language cookie, English when unset or unknown", async () => {
    const { ownerError } = await import("@/i18n/request-locale");
    expect(await ownerError("tooManyDrafts")).toBe(ENGLISH.tooManyDrafts);
    cookie.lang = "hi";
    expect(await ownerError("tooManyDrafts")).toBe(hi.errors.tooManyDrafts);
    cookie.lang = "fr";
    expect(await ownerError("tooManyDrafts")).toBe(ENGLISH.tooManyDrafts);
    cookie.lang = undefined;
  });

  it("keeps an edit refusal's English message, status and retryable, and names its key (#2314)", async () => {
    const { ownerEditError } = await import("@/lib/campaign/edit-service");
    const error = ownerEditError("spendLimitsUnverified", 503, true);
    expect(error).toMatchObject({ message: ENGLISH.spendLimitsUnverified, status: 503, retryable: true, ownerKey: "spendLimitsUnverified" });
  });

  it("answers a Hindi owner's refused budget change in Hindi, with the same status (#2314)", async () => {
    const { ownerEditError } = await import("@/lib/campaign/edit-service");
    const { POST } = await import("@/app/api/campaigns/[id]/budget/route");
    budget.edit.mockRejectedValue(ownerEditError("runEnded", 409));
    const send = () => POST(new Request("http://localhost/api/campaigns/c-1/budget", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ change: { capRupees: 900 }, idempotencyKey: "budget-key-2314" }),
    }), { params: Promise.resolve({ id: "c-1" }) });
    cookie.lang = "hi";
    const hindi = await send();
    expect(hindi.status).toBe(409);
    expect(await hindi.json()).toEqual({ error: hi.errors.runEnded, retryable: false });
    cookie.lang = undefined;
    const english = await send();
    expect(english.status).toBe(409);
    expect(await english.json()).toEqual({ error: ENGLISH.runEnded, retryable: false });
  });
});
