import { describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import hi from "../messages/hi.json";
import { ownerErrorIn, type OwnerErrorKey, type OwnerErrorValues } from "@/i18n/locale";
import { committedWords } from "@/lib/campaign/funding-check";

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
  // #2312: Go live, pause and delete (src/app/api/campaigns/[id]/route.ts), byte-identical to the strings they replace.
  campaignNotFound: "Campaign not found",
  deliveryReviewUnavailable: "Campaign delivery review is unavailable.",
  spendLimitsUnverified: "Spend limits could not be verified. Try again before activating.",
  budgetsUnverified: "Campaign budgets or the saved cap could not be verified. Sync campaigns and review spend settings before activating.",
  overWeeklyCap: "Activating this would commit about ₹7,000 a week, over your ₹5,000 a week cap. Raise the cap in Settings or pause another campaign first.",
  notLinkedToMeta: "This campaign isn't linked to Meta yet.",
  reconcileBeforeChange: "This campaign needs account reconciliation before it can be changed.",
  metaConnectionChanged: "Meta connection changed; review the campaign again.",
  reconcileChildren: "Campaign children need reconciliation before activation.",
  fundingUnverified: "Campaign funding could not be verified. Try again before activating.",
  activationAccessUnconfirmed: "Meta has not confirmed campaign activation access.",
  budgetCurrencyUnverified: "Campaign budget and currency must be verified before activation.",
  areaExclusionsMissing: "This campaign was built without out-of-area exclusions, so Meta could show it far outside your area. Add them first: More → Edit audience → Leave out places outside the area. Then turn it on.",
  pauseReviewedFirst: "Pause the reviewed ad sets and ads in Meta first. AdBrain turns on only the capped copy.",
  everyAdPaused: "Every ad in this campaign is paused from its card. Undo one of those pauses before turning the campaign on.",
  reviewChanged: "Campaign or child review changed; review the current Meta delivery settings again.",
  fundedOnMetaNeedsDays: "This business is funded on Meta, so it runs only with a total limit. Pause the ad sets and ads in Meta and choose how many days to run.",
  setSpendingLimit: "Set a spending limit on the Meta ad account before activating.",
  metaFundsShort: "Meta has ₹100.00 left under the ad account's spending limit after ₹50.00 for your 1 other live run; this run needs ₹300.00. Add funds on Meta or choose fewer days.",
  committedRuns: " after ₹50.00 for your 2 other live runs",
  committedUncapped: "₹40.00 a day also runs on 1 uncapped ad set",
  committedBoth: "A, and B",
  committedUncappedOnly: " (B)",
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
};
const VALUES: Partial<Record<OwnerErrorKey, OwnerErrorValues>> = {
  overWeeklyCap: { projected: "₹7,000", cap: "₹5,000" },
  metaFundsShort: { room: "₹100.00", committed: " after ₹50.00 for your 1 other live run", needed: "₹300.00" },
  committedRuns: { money: "₹50.00", runs: 2 },
  committedUncapped: { money: "₹40.00", adSets: 1 },
  committedBoth: { runs: "A", uncapped: "B" },
  committedUncappedOnly: { uncapped: "B" },
};
const keys = Object.keys(ENGLISH) as OwnerErrorKey[];

describe("owner errors (#2305)", () => {
  it("has the same keys in English and Hindi", () => {
    expect(Object.keys(en.errors).sort()).toEqual([...keys].sort());
    expect(Object.keys(hi.errors).sort()).toEqual([...keys].sort());
  });

  it.each(keys)("%s reads the same in English and is Hindi for हिन्दी", (key) => {
    expect(ownerErrorIn("en", key, VALUES[key])).toBe(ENGLISH[key]);
    const hindi = ownerErrorIn("hi", key, VALUES[key]);
    if (!VALUES[key]) expect(hindi).toBe(hi.errors[key]);
    expect(hindi).not.toMatch(/[{}]/);
    if (key !== "committedUncappedOnly") expect(hindi).toMatch(/[\u0900-\u097F]/);
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
  });
});
