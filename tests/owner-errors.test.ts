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
  });
});
