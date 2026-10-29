import { afterEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/meta/ad-review.json";
import segments from "./fixtures/meta/ad-review-segments.json";
import { adReviewState, MetaClient } from "@/lib/meta/client";
import { rejectedAdsSentence, rejectionCopy } from "@/lib/meta/rejection-copy";
import hi from "../../messages/hi.json";

// #1305: Meta's real review answer for Solaride's one disapproved ad (Free Survey CHD-PKL, Sep 2026), recorded
// read-only by scripts/record-meta-ad-review.ts on Oct 28 and replayed through MetaClient.readAdReview.
type Exchange = { method: string; path: string; status: number; body: unknown };
const tape = recorded.tape as Exchange[];
const account = (tape[0].body as { account_id: string }).account_id;
const page = (tape[1].body as { data: { promoted_object: { page_id: string } }[] }).data[0].promoted_object.page_id;

function replay() {
  const pending = [...tape];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    url.searchParams.delete("access_token");
    if ((init?.method ?? "GET") !== "GET") throw new Error(`Review reads are read-only; got ${init?.method}`);
    const path = url.pathname.replace(/^\/v\d+\.\d+\//, "") + url.search;
    const index = pending.findIndex((exchange) => exchange.path === path);
    if (index < 0) throw new Error(`Unrecorded Graph call: ${path}`);
    const [exchange] = pending.splice(index, 1);
    return Response.json(exchange.body, { status: exchange.status });
  });
  return pending;
}

afterEach(() => vi.restoreAllMocks());

describe("core: rejected ads in plain words (#1305)", () => {
  it("keeps Meta's policy key from the recorded answer, and the unmatched one quotes Meta", async () => {
    const pending = replay();
    const reviews = await new MetaClient({ adAccountId: `act_${account}`, pageId: page, accessToken: "test-token" }).readAdReview(recorded.campaignId);
    expect(pending).toEqual([]);
    const rejected = reviews.find((review) => review.state === "rejected")!;
    expect(rejected.feedback).toEqual([{ policy: "Lead Ads", message: expect.stringMatching(/^It looks like your ad contains content that is not allowed/) }]);
    expect(rejected.reasons).toEqual([rejected.feedback[0].message]);
    const copy = rejectionCopy(rejected.feedback)!;
    expect(copy).toMatchObject({ row: "other", actions: ["edit_words", "change_picture", "ask_meta_review"], more: 0 });
    expect(copy.sentence).toBe(`Meta didn't say exactly why. Here's their message: "${rejected.feedback[0].message}"`);
    expect(rejectedAdsSentence(copy, { rejected: 1, spent: 0 })).toMatch(/^Meta didn't approve your ad\. Meta didn't say exactly why\..* Nothing was spent\.$/);
  });

  it.each([
    ["Personal Attributes", "Ads can't imply personal attributes.", "personal_attributes", ["edit_words"]],
    ["Personal Health and Appearance", "Before-and-after images aren't allowed.", "health_appearance", ["change_picture", "edit_words"]],
    ["Misleading Claims", "Unrealistic outcomes.", "misleading", ["edit_words"]],
    ["Social Issues, Elections or Politics", "Requires authorization.", "political", ["edit_words"]],
    ["Special Ad Categories", "Housing ads need a special ad category.", "special_category", ["message_us"]],
    ["Non-Functional Landing Page", "The destination isn't working.", "destination", ["check_whatsapp"]],
    ["Low Quality or Disruptive Content", "Sensational content.", "low_quality", ["edit_words"]],
    ["Brand Usage in Ads", "Don't modify the logo.", "brand_ip", ["change_picture"]],
    ["Prohibited Content", "Prescription drugs.", "prohibited", ["message_us"]],
    ["Adult Content", "Overly suggestive.", "adult", ["change_picture"]],
  ])("policy key %s → %s", (policy, message, row, actions) => {
    expect(rejectionCopy([{ policy, message }])).toMatchObject({ row, actions, message, more: 0 });
  });

  it("falls back to words in the message when the key is unknown, and counts the other reasons", () => {
    expect(rejectionCopy([{ policy: null, message: "Are you suffering from back pain? This implies a personal attribute." }])?.row).toBe("personal_attributes");
    expect(rejectionCopy([{ policy: "Something new", message: "We guarantee 100% savings" }])?.row).toBe("misleading");
    const two = rejectionCopy([{ policy: "Lead Ads", message: "Generic." }, { policy: "Adult Content", message: "Suggestive." }])!;
    expect(two).toMatchObject({ row: "adult", more: 1 });
    expect(rejectedAdsSentence(two, { rejected: 3, spent: 120 })).toBe("Meta didn't approve your 3 ads. Meta thinks the picture shows too much skin. (+1 more)");
    // CPO on #1255: a full stop before the reason sentence; the others' state after it.
    const one = rejectionCopy([{ policy: "Adult Content", message: "Suggestive." }])!;
    expect(rejectedAdsSentence(one, { rejected: 1, total: 3, spent: 0, running: true })).toBe("Meta didn't approve 1 ad. Meta thinks the picture shows too much skin. Your other 2 ads are running.");
    expect(rejectedAdsSentence(one, { rejected: 3, total: 3, spent: 0 })).toBe("Meta didn't approve your 3 ads. Meta thinks the picture shows too much skin. Nothing was spent.");
    expect(rejectedAdsSentence(one, { rejected: 1, total: 2, spent: 0 })).toBe("Meta didn't approve 1 ad. Meta thinks the picture shows too much skin. Nothing was spent.");
    expect(rejectionCopy([])).toBeNull();
  });

  it("reads issues_info as reasons without a policy", () => {
    expect(adReviewState({ id: "1", effective_status: "WITH_ISSUES", issues_info: [{ error_message: "Payment failed" }] }).feedback).toEqual([{ policy: null, message: "Payment failed" }]);
  });
});

// #1645 (CPO, #1622): the IELTS and interiors pilots' likely rejections, in their own words, with the fix.

describe("core: rejections in the segment's own words (#1645)", () => {
  const IELTS = "IELTS coaching", INTERIORS = "Modular kitchens and interiors", SOLAR = "Solar installer";
  const LICENCE = "Add your licence number as the last line, e.g. 'Punjab licence no. 123'.";
  // #1770 (QA, CPO): a licence number doesn't take a guarantee out; that row's hint names what to remove.
  const NO_PROMISE = "Take out 'guaranteed', '100%' or any promised band, visa or admission.";

  it("misleading: the example fits the business", () => {
    const misleading = [{ policy: "Misleading Claims", message: "Unrealistic outcomes." }];
    expect(rejectionCopy([segments.ielts.misleading], { vertical: IELTS })).toMatchObject({ row: "misleading", actions: ["edit_words"], editHint: NO_PROMISE,
      sentence: "It promises a result Meta thinks can't be proven, like a guaranteed band, visa or admission." });
    expect(rejectionCopy([segments.interiors.misleading], { vertical: INTERIORS })?.sentence).toBe("It promises a result Meta thinks can't be proven, like the lowest price or a fixed handover date.");
    expect(rejectionCopy(misleading, { vertical: SOLAR })?.sentence).toBe("It promises a result Meta thinks can't be proven, like a guaranteed saving.");
    expect(rejectionCopy(misleading, { vertical: "Dental clinic" })?.sentence).toBe("It promises a result Meta thinks can't be proven, like a guaranteed result.");
    expect(rejectionCopy(misleading)?.editHint).toBeUndefined();
  });

  it("personal attributes: the reader's own result, by policy key or by Meta's words", () => {
    // #1770: no quoted example the ad may not have used.
    const sentence = "The ad talks about the reader's own result, like a past test score or a visa refusal. Meta doesn't allow that. Talk about your classes instead.";
    expect(rejectionCopy([segments.ielts.personal], { vertical: IELTS })).toMatchObject({ row: "personal_attributes", sentence, actions: ["edit_words"] });
    expect(rejectionCopy([segments.ielts.personal_words_only], { vertical: IELTS })).toMatchObject({ row: "personal_attributes", sentence });
  });

  it("job or visa offer (IELTS only), before special categories", () => {
    const sentence = "Meta read this as a job or visa offer. Keep it about the course and add your licence number as the last line.";
    for (const item of [segments.ielts.job_policy, segments.ielts.job_words_only]) {
      expect(rejectionCopy([item], { vertical: IELTS })).toMatchObject({ row: "job_or_visa_offer", sentence, actions: ["edit_words"], editHint: LICENCE });
    }
    expect(rejectionCopy([{ policy: "Employment", message: "Job ads need the Employment special ad category." }], { vertical: IELTS })?.row).toBe("job_or_visa_offer");
    expect(rejectionCopy([{ policy: "Employment", message: "Job ads need the Employment special ad category." }], { vertical: SOLAR })?.row).toBe("special_category");
  });

  it("interiors: a property-ad reading is fixed by editing the words, not by messaging us", () => {
    expect(rejectionCopy([segments.interiors.housing], { vertical: INTERIORS })).toMatchObject({ row: "special_category", actions: ["edit_words"],
      sentence: "Meta read this as a property ad. Talk about kitchens and design, not flats, projects or prices per square foot." });
    expect(rejectionCopy([segments.interiors.housing], { vertical: SOLAR })).toMatchObject({ row: "special_category", actions: ["message_us"] });
  });

  it("every other row reads the same for a solar business as with no business type", () => {
    for (const policy of ["Personal Attributes", "Personal Health and Appearance", "Social Issues, Elections or Politics", "Special Ad Categories",
      "Non-Functional Landing Page", "Low Quality or Disruptive Content", "Brand Usage in Ads", "Prohibited Content", "Adult Content", "Lead Ads"]) {
      const feedback = [{ policy, message: "Meta's words." }];
      expect(rejectionCopy(feedback, { vertical: SOLAR }), policy).toEqual(rejectionCopy(feedback));
    }
  });
});

describe("core: the rejected-ads sentence in Hindi (#1438)", () => {
  const words = { locale: "hi" as const, messages: hi.verdict };
  const copy = rejectionCopy([{ policy: "Adult Content", message: "Suggestive." }, { policy: "Lead Ads", message: "Generic." }], { words })!;

  it("counts with the verb agreeing, and keeps the row, actions and Meta's message as matched in English", () => {
    expect(copy).toMatchObject({ row: "adult", actions: ["change_picture"], message: "Suggestive.", more: 1 });
    expect(rejectedAdsSentence(copy, { rejected: 2, total: 5, spent: 0, running: true, words }))
      .toBe("Meta ने 2 विज्ञापन मंज़ूर नहीं किए। Meta को लगता है तस्वीर में शरीर ज़्यादा दिख रहा है। (+1 और) आपके बाकी 3 विज्ञापन चल रहे हैं।");
    expect(rejectedAdsSentence(copy, { rejected: 3, spent: 0, words })).toMatch(/^Meta ने आपके 3 विज्ञापन मंज़ूर नहीं किए।.*कोई पैसा खर्च नहीं हुआ।$/);
  });

  it("an interiors property reading gets its own Hindi and the edit fix", () => {
    const interiors = rejectionCopy([{ policy: "Housing", message: "Housing ads need a special ad category." }], { vertical: "Interior design", words })!;
    expect(interiors.sentence).toBe("Meta ने इसे प्रॉपर्टी का विज्ञापन समझा। किचन और डिज़ाइन की बात करें, फ़्लैट, प्रोजेक्ट या प्रति स्क्वायर फ़ुट कीमत की नहीं।");
    expect(interiors.actions).toEqual(["edit_words"]);
  });
});
