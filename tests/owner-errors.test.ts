import { describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import hi from "../messages/hi.json";
import { ownerErrorIn, type OwnerErrorKey } from "@/i18n/locale";

const cookie = vi.hoisted(() => ({ lang: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "adbrain_lang" && cookie.lang ? { value: cookie.lang } : undefined) }),
}));

// #2305: the #2225 plain-words errors, byte-identical in English; routes match on status and `code`, not this text.
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
};
// The messages that take values, rendered with these.
const VALUES: Partial<Record<OwnerErrorKey, Record<string, string | number>>> = {
  pictureFieldEmpty: { field: "Headline" },
  pictureFieldTooLong: { field: "Offer line", max: 40 },
  pictureFieldInvalid: { field: "Button" },
  versionClaimRejected: { claims: "best in city, 50% off" },
};
const RENDERED: Partial<Record<OwnerErrorKey, string>> = {
  pictureFieldEmpty: "Headline can't be empty.",
  pictureFieldTooLong: "Offer line must be 40 characters or fewer.",
  pictureFieldInvalid: "Button isn't valid.",
  versionClaimRejected: "The new version made a claim our fact check couldn't match to your Brand (best in city, 50% off). Your current ad is unchanged. Try again.",
};
const keys = Object.keys(ENGLISH) as OwnerErrorKey[];

describe("owner errors (#2305, #2324)", () => {
  it("has the same keys in English and Hindi", () => {
    expect(Object.keys(en.errors).sort()).toEqual([...keys].sort());
    expect(Object.keys(hi.errors).sort()).toEqual([...keys].sort());
  });

  it.each(keys)("%s reads the same in English and is Hindi for हिन्दी", (key) => {
    expect(ownerErrorIn("en", key, VALUES[key])).toBe(RENDERED[key] ?? ENGLISH[key]);
    const hindi = ownerErrorIn("hi", key, VALUES[key]);
    if (!VALUES[key]) expect(hindi).toBe(hi.errors[key]);
    expect(hindi).not.toMatch(/[{}]/);
    expect(hindi).toMatch(/[\u0900-\u097F]/);
  });

  it("builds a picture field's error from its translated name", () => {
    const hindi = (field: OwnerErrorKey) => ownerErrorIn("hi", field);
    expect(ownerErrorIn("hi", "pictureFieldEmpty", { field: hindi("pictureFieldHeadline") })).toBe("हेडलाइन भरना ज़रूरी है।");
    expect(ownerErrorIn("hi", "pictureFieldTooLong", { field: hindi("pictureFieldButton"), max: 20 })).toBe("बटन में ज़्यादा से ज़्यादा 20 अक्षर हो सकते हैं।");
  });

  it("follows the owner's language cookie, English when unset or unknown", async () => {
    const { ownerError } = await import("@/i18n/request-locale");
    expect(await ownerError("tooManyDrafts")).toBe(ENGLISH.tooManyDrafts);
    cookie.lang = "hi";
    expect(await ownerError("tooManyDrafts")).toBe(hi.errors.tooManyDrafts);
    cookie.lang = "fr";
    expect(await ownerError("tooManyDrafts")).toBe(ENGLISH.tooManyDrafts);
  });
});
