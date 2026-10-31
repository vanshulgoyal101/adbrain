import { describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import hi from "../messages/hi.json";
import { ownerErrorIn, type OwnerErrorKey } from "@/i18n/locale";
import { committedWords } from "@/lib/campaign/funding-check";

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
vi.mock("@/lib/supabase/queries", () => ({ getPrimaryBusiness: async () => ({ id: "b1" }) }));

// #2305/#2314: owner-facing errors (the #2225 plain words), byte-identical in English; routes match on status and `code`, not this text.
const ENGLISH: Record<OwnerErrorKey, string> = {
  draftSaveUnavailable: "We couldn't save your campaign just now. Try again in a minute.",
  tooManyDrafts: "You have too many unfinished campaigns. Finish or remove one, then try again.",
  somethingDidntAnswer: "Something on our side didn't answer. Nothing was started; try again in a minute.",
  backgroundDidntStart: "Something on our side didn't answer. No new background was started; try again in a minute.",
  aiAllowanceUsed: "You've used this month's AI allowance for this business. Ask AdBrain to raise it.",
  checkAdsUnavailable: "We couldn't check on your ads just now. Try again in a minute.",
  adsDidntFinish: "Your ads didn't finish. Some may already be saved: tap Check saved results before you try again.",
  // #2324: the creatives routes' errors (Create, Change background, picture words, Regenerate, assistant, export).
  backgroundTooLong: "Keep the description to 300 characters or fewer.",
  backgroundDescribe: "Describe the background you want, for example \"rooftop at sunset\".",
  adNotFound: "We couldn't find this ad. It may have been deleted; refresh the page.",
  businessNotFound: "We couldn't find this business. Refresh the page and try again.",
  photoNotInBrand: "That photo isn't in your Brand assets.",
  changeNeedsCheck: "A previous paid change to this ad needs a check before trying again.",
  adBeingChanged: "This ad is already being changed. Refresh it before trying again.",
  backgroundNotSaved: "The new background was made but didn't save to this ad. AdBrain needs to check it before you try again.",
  liveEditNotice: "This ad is live on Meta; your edit applies to new campaigns.",
  backgroundNeedsCheck: "The new background could not be finished. This attempt needs a check before the ad's picture can be changed again.",
  photoUnusable: "Couldn't use that photo. Your ad is unchanged; try another photo.",
  backgroundFailed: "Couldn't make a new background this time. Your ad is unchanged; try again.",
  changeUnknown: "We couldn't tell whether the change finished. Refresh the page to see the ad before you try again.",
  pickBrandPhoto: "Pick one of your Brand photos.",
  photoUnopened: "Couldn't open that photo. Try another photo.",
  pictureFieldEmpty: "{field} can't be empty.",
  pictureFieldTooLong: "{field} must be {max} characters or fewer.",
  pictureFieldInvalid: "{field} isn't valid.",
  pictureFieldHeadline: "Headline",
  pictureFieldSubhead: "Offer line",
  pictureFieldPhone: "Phone",
  pictureFieldButton: "Button",
  pictureFieldOther: "These words",
  phoneInvalid: "Phone: use digits, spaces and + only.",
  pictureNoWords: "This ad's picture has no words we can change.",
  noOriginalBackground: "We couldn't find this ad's original background, so its words can't be redrawn. Regenerate the whole ad instead.",
  previewFailed: "Couldn't draw the preview.",
  redrawFailed: "Couldn't redraw the picture. Your ad is unchanged; try again.",
  pictureNotSaved: "Couldn't save the new picture. Your ad is unchanged; try again.",
  versionRejected: "The new version didn't pass our ad checks. Your current ad is unchanged. Try again.",
  versionClaimRejected: "The new version made a claim our fact check couldn't match to your Brand ({claims}). Your current ad is unchanged. Try again.",
  regenerationNeedsReview: "Previous paid regeneration needs review before retrying.",
  regenerationBusy: "Regeneration is already in progress. Refresh this creative before trying again.",
  creativeNotUpdated: "Could not update creative.",
  versionFailed: "Couldn't make a new version this time. Your current ad is unchanged; try again.",
  remakeNeedsCheck: "This ad didn't finish remaking. AdBrain needs to check this attempt before you can remake it again.",
  remakeUnknown: "We couldn't tell whether the remake finished. Refresh the page to see the ad before you try again.",
  requestLooksWrong: "Something in this request didn't look right. Refresh the page and answer the questions again.",
  aiBusy: "AdBrain is busy right now. Tap Try again in a few seconds.",
  assistantTrouble: "The assistant had trouble \u2014 try again.",
  exportCount: "Pick between 1 and 50 ads to download.",
  exportLoadFailed: "Could not load the selected creatives. Retry the export.",
  exportAdsDeleted: "Some ads you picked were deleted. Refresh the page and pick again.",
  adRequestNotFound: "We couldn't find that ad request. Start again from Create.",
  noAdsMade: "No creatives were generated.",
  // #2312: Go live, pause and delete (src/app/api/campaigns/[id]/route.ts), byte-identical to the strings they replace.
  campaignNotFound: "Campaign not found",
  deliveryReviewUnavailable: "Campaign delivery review is unavailable.",
  spendLimitsUnverified: "Spend limits could not be verified. Try again before activating.",
  budgetsUnverified: "Campaign budgets or the saved cap could not be verified. Sync campaigns and review spend settings before activating.",
  overWeeklyCap: "Activating this would commit about {projected} a week, over your {cap} a week cap. Raise the cap in Settings or pause another campaign first.",
  notLinkedToMeta: "This campaign isn't linked to Meta yet.",
  reconcileBeforeChange: "This campaign needs account reconciliation before it can be changed.",
  metaConnectionChanged: "Meta connection changed; review the campaign again.",
  reconcileChildren: "Campaign children need reconciliation before activation.",
  fundingUnverified: "Campaign funding could not be verified. Try again before activating.",
  budgetCurrencyUnverified: "Campaign budget and currency must be verified before activation.",
  areaExclusionsMissing: "This campaign was built without out-of-area exclusions, so Meta could show it far outside your area. Add them first: More → Edit audience → Leave out places outside the area. Then turn it on.",
  pauseReviewedFirst: "Pause the reviewed ad sets and ads in Meta first. AdBrain turns on only the capped copy.",
  everyAdPaused: "Every ad in this campaign is paused from its card. Undo one of those pauses before turning the campaign on.",
  reviewChanged: "Campaign or child review changed; review the current Meta delivery settings again.",
  fundedOnMetaNeedsDays: "This business is funded on Meta, so it runs only with a total limit. Pause the ad sets and ads in Meta and choose how many days to run.",
  setSpendingLimit: "Set a spending limit on the Meta ad account before activating.",
  metaFundsShort: "Meta has {room} left under the ad account's spending limit{committed}; this run needs {needed}. Add funds on Meta or choose fewer days.",
  committedRuns: " after {money} for your {runs} other live {runs, plural, one {run} other {runs}}",
  committedUncapped: "{money} a day also runs on {adSets} uncapped ad {adSets, plural, one {set} other {sets}}",
  committedBoth: "{runs}, and {uncapped}",
  committedUncappedOnly: " ({uncapped})",
  cappedNotRecorded: "The capped ad set could not be recorded. Nothing was activated.",
  approvedOverFunds: "The approved total is more than the available advertising funds.",
  activationUnrecordedPauseUnconfirmed: "AdBrain could not record the activation and Meta did not confirm the pause. Pause the campaign in Ads Manager now.",
  activationUnrecordedPaused: "AdBrain could not record the activation, so the campaign was paused again in Meta. Try again.",
  pauseUnconfirmed: "Meta did not confirm the pause. Pause the campaign in Ads Manager now.",
  metaAccessStoppedPause: "Meta stopped accepting AdBrain's access, so we couldn't pause this campaign. Pause it in Ads Manager now, then reconnect Facebook in Settings.",
  metaAccessStoppedChange: "Meta stopped accepting AdBrain's access, so we couldn't change this campaign. Pause it in Ads Manager now, then reconnect Facebook in Settings.",
  metaAccessStopped: "Meta stopped accepting AdBrain's access. Reconnect Facebook in Settings, then try again.",
  campaignUpdateFailed: "Could not update the campaign.",
  campaignStorageUnavailable: "Campaign storage unavailable. Try again.",
  reconcileBeforeDelete: "This campaign needs account reconciliation before it can be deleted.",
  metaDeleteUnconfirmed: "Meta deletion could not be confirmed. The campaign remains in AdBrain so you can check its status.",
  campaignDeleteFailed: "Could not delete the campaign.",
  activationAccessUnconfirmed: "Meta has not confirmed campaign activation access.",
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
  budgetSpendLimitsUnverified: "Spend limits could not be verified. Try again.",
  budgetFundingUnverified: "Campaign funding could not be verified. Try again.",
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
  // #2330: Brand autofill and the launch planner; byte-identical, except siteRefused (was the raw "Site returned 403").
  brandInputInvalid: "A website URL of at most 2048 characters, or some text about the business, is required.",
  pasteMore: "Paste a little more about the business: what it sells, where, and how to reach it.",
  urlNotAllowed: "That URL is not allowed",
  siteRefused: "That website didn't open for us. Check the address, or paste some text about the business instead.",
  siteUnreachable: "Could not fetch the site",
  noReadableText: "No readable text found on that page",
  brandReadFailed: "Could not extract business details. Try again later or enter them manually.",
  planRequestInvalid: "A valid goal and answers are required.",
  interviewTooLong: "The interview is too long. Continue in the campaign editor.",
  businessNotAllowed: "Business access is not allowed.",
  planFailed: "Could not prepare the campaign plan.",
  // #2327: Enquiries and the Facebook connect path (the leads 404 reuses #2312's campaignNotFound).
  signInRequired: "Sign in required.",
  businessMissing: "Business not found.",
  chooseCampaign: "Choose a campaign.",
  enquiriesNotDeleted: "The enquiries couldn't be deleted. Try again.",
  enquiryNotDeleted: "The enquiry couldn't be deleted. Try again.",
  enquiryNotFound: "Enquiry not found.",
  enquiriesNotReloaded: "Couldn't reload your saved enquiries. Your existing enquiries are still here.",
  enquiryCountUnavailable: "Enquiry count unavailable.",
  requestNotSent: "We couldn't send your request. Try again.",
  pickAccountAndPage: "Pick both an ad account and a page.",
  facebookStillConnected: "Facebook is still connected. Try again in a minute.",
  // #2334: Settings spend limits and preferences.
  spendLimitsInvalid: "Enter the weekly cap in whole rupees (or leave it blank for no cap), and a Warn at number from 1 to 100.",
  spendLimitsNotSaved: "We couldn't save your spend limits. Try again.",
  preferencesUnavailable: "We couldn't load your preferences just now. Try again in a minute.",
  preferencesChanged: "Your preferences changed somewhere else. Reload the page before saving.",
  preferencesNotSaved: "We couldn't save your preferences. Try again.",
  preferencesSavedNotLoaded: "Saved, but we couldn't show the update. Refresh the page to check.",
  // #2335: Day 7 answer, privacy requests and the lead-form picker.
  chooseAnswer: "Choose one of the answers.",
  questionNotOpen: "This question isn't open.",
  answerNotSaved: "Your answer couldn't be saved. Try again.",
  privacyUnavailable: "Privacy requests are temporarily unavailable.",
  chooseExportOrDeletion: "Choose export or deletion.",
  reloadPage: "Reload the page and try again.",
  openRequestExists: "An open request of this type already exists.",
  setUpBrandFirst: "Set up your Brand first, then connect Facebook in Settings.",
  leadFormsUnavailable: "Could not load lead forms. Try again.",
  // #2330: the campaign list and Enquiries routes (byte-identical).
  campaignFiltersInvalid: "Invalid campaign filters.",
  campaignsNotLoaded: "We couldn't load your campaigns. Reload the page.",
  enquiryInvalid: "Invalid enquiry.",
  enquiryWhatsAppOnly: "Real enquiries can be logged on WhatsApp campaigns only.",
  enquiryNotSaved: "The enquiry could not be saved. Try again.",
};
// The messages that take values, rendered with these.
const VALUES: Partial<Record<OwnerErrorKey, Record<string, string | number>>> = {
  pictureFieldEmpty: { field: "Headline" },
  pictureFieldTooLong: { field: "Offer line", max: 40 },
  pictureFieldInvalid: { field: "Button" },
  versionClaimRejected: { claims: "best in city, 50% off" },
  overWeeklyCap: { projected: "₹7,000", cap: "₹5,000" },
  metaFundsShort: { room: "₹100.00", committed: " after ₹50.00 for your 1 other live run", needed: "₹300.00" },
  committedRuns: { money: "₹50.00", runs: 2 },
  committedUncapped: { money: "₹40.00", adSets: 1 },
  committedBoth: { runs: "A", uncapped: "B" },
  committedUncappedOnly: { uncapped: "B" },
};
const RENDERED: Partial<Record<OwnerErrorKey, string>> = {
  pictureFieldEmpty: "Headline can't be empty.",
  pictureFieldTooLong: "Offer line must be 40 characters or fewer.",
  pictureFieldInvalid: "Button isn't valid.",
  versionClaimRejected: "The new version made a claim our fact check couldn't match to your Brand (best in city, 50% off). Your current ad is unchanged. Try again.",

  overWeeklyCap: "Activating this would commit about ₹7,000 a week, over your ₹5,000 a week cap. Raise the cap in Settings or pause another campaign first.",
  metaFundsShort: "Meta has ₹100.00 left under the ad account's spending limit after ₹50.00 for your 1 other live run; this run needs ₹300.00. Add funds on Meta or choose fewer days.",
  committedRuns: " after ₹50.00 for your 2 other live runs",
  committedUncapped: "₹40.00 a day also runs on 1 uncapped ad set",
  committedBoth: "A, and B",
  committedUncappedOnly: " (B)",
};
const keys = Object.keys(ENGLISH) as OwnerErrorKey[];

describe("owner errors (#2305, #2312, #2314, #2324, #2327, #2330, #2334, #2335)", () => {
  it("has the same keys in English and Hindi", () => {
    expect(Object.keys(en.errors).sort()).toEqual([...keys].sort());
    expect(Object.keys(hi.errors).sort()).toEqual([...keys].sort());
  });

  it.each(keys)("%s reads the same in English and is Hindi for हिन्दी", (key) => {
    expect(ownerErrorIn("en", key, VALUES[key])).toBe(RENDERED[key] ?? ENGLISH[key]);
    const hindi = ownerErrorIn("hi", key, VALUES[key]);
    if (!VALUES[key]) expect(hindi).toBe(hi.errors[key]);
    expect(hindi).not.toMatch(/[{}]/);
    // " ({uncapped})" is punctuation around a value.
    if (key !== "committedUncappedOnly") expect(hindi).toMatch(/[\u0900-\u097F]/);
  });

  it("builds a picture field's error from its translated name", () => {
    const hindi = (field: OwnerErrorKey) => ownerErrorIn("hi", field);
    expect(ownerErrorIn("hi", "pictureFieldEmpty", { field: hindi("pictureFieldHeadline") })).toBe("हेडलाइन भरना ज़रूरी है।");
    expect(ownerErrorIn("hi", "pictureFieldTooLong", { field: hindi("pictureFieldButton"), max: 20 })).toBe("बटन में ज़्यादा से ज़्यादा 20 अक्षर हो सकते हैं।");
  });

  it("#2312: the committed-spend words are unchanged in English and Hindi from the route", () => {
    const shapes = [
      undefined,
      { runs: 1, remainingPaise: 5_000 },
      { runs: 2, remainingPaise: 5_000, uncapped: { adSets: 3, dailyPaise: 4_000 } },
      { runs: 0, remainingPaise: 0, uncapped: { adSets: 1, dailyPaise: 4_000 } },
    ] as Parameters<typeof committedWords>[0][];
    for (const committed of shapes) {
      const english = committedWords(committed);
      expect(committedWords(committed, undefined, (key, values) => ownerErrorIn("en", key, values))).toBe(english);
      const hindi = committedWords(committed, undefined, (key, values) => ownerErrorIn("hi", key, values));
      expect(Boolean(hindi)).toBe(Boolean(english));
      if (hindi) expect(hindi).toMatch(/[\u0900-\u097F]/);
    }
    expect(committedWords({ runs: 2, remainingPaise: 5_000, uncapped: { adSets: 3, dailyPaise: 4_000 } } as Parameters<typeof committedWords>[0]))
      .toBe(" after ₹50 for your 2 other live runs, and ₹40 a day also runs on 3 uncapped ad sets");
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
    const { ownerEditError } = await import("@/lib/campaign/owner-edit-error");
    const { CampaignEditError } = await import("@/lib/campaign/edit-service");
    const error = ownerEditError("budgetSpendLimitsUnverified", 503, true);
    expect(error).toBeInstanceOf(CampaignEditError);
    expect(error).toMatchObject({ message: ENGLISH.budgetSpendLimitsUnverified, status: 503, retryable: true, ownerKey: "budgetSpendLimitsUnverified" });
  });

  it("answers a Hindi owner's refused budget change in Hindi, with the same status (#2314)", async () => {
    const { ownerEditError } = await import("@/lib/campaign/owner-edit-error");
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

  it("#2334: the spend-limits route answers a Hindi owner in Hindi", async () => {
    const { POST } = await import("@/app/api/spend-limits/route");
    cookie.lang = "hi";
    const response = await POST(new Request("http://x/api/spend-limits", { method: "POST", body: JSON.stringify({ weeklyCapRupees: -5, alertPct: 50, autoPause: true }) }));
    cookie.lang = undefined;
    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe(hi.errors.spendLimitsInvalid);
  });
});
