import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import hi from "../../messages/hi.json";
import { runPreflight, type PreflightInput } from "@/lib/campaign/preflight";
import { reviewBlockerAlternative, reviewBlockerFix } from "@/lib/campaign/review-fix";
import { reviewBlockerReasons } from "@/lib/meta/connect-contracts";
import type { AppLocale } from "@/i18n/locale";

// #2333 slice 2: Review's blocker sentences and their fix buttons in the owner's language.
const businessId = "816aaafb-7ebc-4ad7-bbda-001beff172f8";
const creativeId = "e3d165a9-bbf8-47f7-8c61-e69dbb8ee3d1";
const second = "0b3c8f7e-3c0e-4f7a-9a51-6d2f1c0e9b11";
const third = "5a1e2b3c-4d5e-4f60-8a71-b2c3d4e5f607";

function input(): PreflightInput {
  return {
    draft: {
      businessId, name: "Cedar Ridge exams", goal: "Book new-patient exams", mode: "manual", destination: "instant_form",
      creativeIds: [creativeId], dailyBudgetRupees: 200, leadFormId: "form-1", abTest: false,
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
    form: { id: "form-1", businessId, active: true },
    whatsappNumber: "+919876543210",
    website: "https://cedarridgechiro.com",
    geo: { resolvedAreaLabel: "Austin, Texas", unresolvedNames: [], explicitlyNationwide: false, audienceInterests: [{ id: "6840321905207", name: "Wellness" }] },
    hash: () => "a".repeat(64),
  };
}

const unapproved = (v: PreflightInput, headlines: (string | null)[]) => {
  const ids = [creativeId, second, third].slice(0, headlines.length);
  v.draft.creativeIds = ids;
  v.creatives = ids.map((id, index) => ({ ...v.creatives[0], id, approved: false, headline: headlines[index] }));
};

/** Every sentence a Review blocker can say: [name, change, reason]. */
const variants: [string, (v: PreflightInput) => void, string][] = [
  ["no connection", (v) => { v.connection = null; }, "REVIEW_NO_META_CONNECTION"],
  ["currency", (v) => { v.connection!.selected!.currency = "USD"; }, "REVIEW_CURRENCY"],
  ["meta access", (v) => { v.connection!.canCreatePaused = false; }, "REVIEW_META_ACCESS"],
  ["no ads", (v) => { v.draft.creativeIds = []; v.creatives = []; }, "REVIEW_CREATIVES"],
  ["ad gone", (v) => { v.creatives = []; }, "REVIEW_CREATIVES"],
  ["no headline", (v) => { v.creatives[0].headline = null; }, "REVIEW_CREATIVES"],
  ["not approved", (v) => { v.creatives[0].approved = false; }, "REVIEW_CREATIVES"],
  ["blank headline not approved", (v) => { v.creatives[0].approved = false; v.creatives[0].headline = "  "; }, "REVIEW_CREATIVES"],
  ["no picture", (v) => { v.creatives[0].imageUrl = null; }, "REVIEW_CREATIVES"],
  ["one more", (v) => unapproved(v, ["Same-day sciatica relief with a 45-minute adjustment", "Exam"]), "REVIEW_CREATIVES"],
  ["two more", (v) => unapproved(v, ["Exam", "Second", "Third"]), "REVIEW_CREATIVES"],
  ["whatsapp not linked", (v) => { v.draft.destination = "whatsapp"; v.whatsappNumber = null; }, "REVIEW_WHATSAPP_NOT_LINKED"],
  ["whatsapp message", (v) => { v.draft.destination = "whatsapp"; v.whatsappMessageProblem = "PROBLEM"; }, "REVIEW_WHATSAPP_MESSAGE"],
  ["lead form", (v) => { v.form = null; }, "REVIEW_NO_LEAD_FORM"],
  ["website", (v) => { v.website = null; }, "REVIEW_NO_WEBSITE"],
  ["policy", (v) => { v.vertical = "chiropractic clinic"; v.creatives[0].headline = "Cures back pain"; }, "REVIEW_AD_POLICY"],
  ["policy no headline", (v) => { v.vertical = "chiropractic clinic"; v.creatives[0].headline = null; v.creatives[0].primaryText = "Cures back pain"; }, "REVIEW_AD_POLICY"],
  ["budget zero", (v) => { v.draft.dailyBudgetRupees = 0; }, "REVIEW_BUDGET"],
  ["budget low", (v) => { v.draft.dailyBudgetRupees = 95; }, "REVIEW_BUDGET"],
  ["age", (v) => { v.draft.targeting.age = { mode: "ai" }; }, "REVIEW_NO_AGE_RANGE"],
  ["radius", (v) => { v.draft.targeting.location = { mode: "ai", includedNames: ["Austin, Texas"], radiusKm: 5 }; }, "REVIEW_RADIUS"],
  ["city radius", (v) => { v.geo.location = { cities: [{ key: "1", radius: 10, distance_unit: "kilometer" }] } as never; }, "REVIEW_CITY_RADIUS"],
  ["one area", (v) => { v.geo.unresolvedNames = ["Atlantis"]; }, "REVIEW_AREAS_UNRESOLVED"],
  ["seven areas", (v) => { v.geo.unresolvedNames = ["A1", "A2", "A3", "A4", "A5", "A6", "A7"]; }, "REVIEW_AREAS_UNRESOLVED"],
  ["areas unnamed", (v) => { v.geo.resolvedAreaLabel = null; }, "REVIEW_AREAS_UNRESOLVED"],
  ["no audience", (v) => { v.draft.targeting.audience = undefined; }, "REVIEW_NO_AUDIENCE"],
  ["one interest", (v) => { v.geo.unresolvedInterests = ["Wellness"]; }, "REVIEW_INTERESTS_UNRESOLVED"],
  ["two interests", (v) => { v.geo.unresolvedInterests = ["Wellness", "Yoga"]; }, "REVIEW_INTERESTS_UNRESOLVED"],
  ["interests unnamed", (v) => { v.geo.audienceInterests = []; }, "REVIEW_INTERESTS_UNRESOLVED"],
];

/** The English each sentence said before #2333 slice 2: unchanged, byte for byte. */
const ENGLISH: Record<string, string> = {
  "no connection": "Connect Facebook and choose your Page and ad account.",
  "currency": "Choose an ad account that pays in Indian rupees (INR).",
  "meta access": "Meta hasn't confirmed AdBrain can create campaigns in this ad account. Connect Facebook again and allow every permission it asks for.",
  "no ads": "Choose at least one ad to send to Meta.",
  "ad gone": "One of the ads you chose isn't available any more. Choose your ads again.",
  "no headline": "An ad you chose has no headline. Take it out of this campaign and choose another ad.",
  "not approved": "The ad \"New-Patient Exam\" isn't approved yet. Approve it on the Review page, or take it out of this campaign.",
  "blank headline not approved": "The ad you chose isn't approved yet. Approve it on the Review page, or take it out of this campaign.",
  "no picture": "The ad \"New-Patient Exam\" has no picture yet. Take it out of this campaign and choose another ad.",
  "one more": "The ad \"Same-day sciatica relief with a…\" isn't approved yet. Approve it on the Review page, or take it out of this campaign. 1 more ad needs fixing too.",
  "two more": "The ad \"Exam\" isn't approved yet. Approve it on the Review page, or take it out of this campaign. 2 more ads need fixing too.",
  "whatsapp not linked": "Your Facebook Page has no WhatsApp number linked yet, so the ad's button has nowhere to open a chat. Link the number in Settings, then review again.",
  "whatsapp message": "Your WhatsApp message: PROBLEM",
  "lead form": "Choose an active lead form from your Facebook Page in the Lead form field.",
  "website": "Add your business website on the Your business page. Meta lead ads must link to the advertiser's own website, not Facebook.",
  "policy": "\"cures\" in the ad \"Cures back pain\" is a health promise Meta rejects. Edit the ad to describe the service instead.",
  "policy no headline": "\"cures\" in the ad \"without a headline\" is a health promise Meta rejects. Edit the ad to describe the service instead.",
  "budget zero": "Set a daily budget above ₹0.",
  "budget low": "Meta needs at least ₹96 a day. Set a daily budget of ₹96 or more.",
  "age": "Choose an age range, or let AdBrain recommend one, before reviewing.",
  "radius": "Set the city radius between 17 and 80 km; Meta allows nothing outside that range.",
  "city radius": "\"City only\" came back from Meta with a radius. Choose the locations again.",
  "one area": "Meta didn't recognise the area \"Atlantis\". Fix or remove it, or choose nationwide targeting.",
  "seven areas": "Meta didn't recognise the areas \"A1\", \"A2\", \"A3\", \"A4\" and \"A5\" and 2 more. Fix or remove them, or choose nationwide targeting.",
  "areas unnamed": "Meta didn't recognise some of your areas. Fix or remove them, or choose nationwide targeting.",
  "no audience": "Let AdBrain recommend the audience (Recommend audience) before reviewing.",
  "one interest": "Meta didn't recognise the interest \"Wellness\". Edit or remove it.",
  "two interests": "Meta didn't recognise the interests \"Wellness\" and \"Yoga\". Edit or remove them.",
  "interests unnamed": "Meta didn't recognise some audience interests. Edit or remove them.",
};

function message(locale: AppLocale | undefined, change: (v: PreflightInput) => void, reason: string): string | undefined {
  const value = input();
  change(value);
  return runPreflight(locale ? { ...value, locale } : value).blockers.find((item) => item.reason === reason)?.message;
}

const devanagari = /[\u0900-\u097F]/;

describe("Review blockers in the owner's language (#2333)", () => {
  it.each(variants)("%s: English unchanged, by default and when asked for", (name, change, reason) => {
    expect(message(undefined, change, reason)).toBe(ENGLISH[name]);
    expect(message("en", change, reason)).toBe(ENGLISH[name]);
  });

  it.each(variants)("%s: Hindi when the owner reads Hindi", (_name, change, reason) => {
    const said = message("hi", change, reason);
    expect(said).toMatch(devanagari);
    expect(said).not.toBe(message("en", change, reason));
  });

  it("keeps names, amounts and counts in the Hindi sentence", () => {
    expect(message("hi", (v) => { v.draft.dailyBudgetRupees = 95; }, "REVIEW_BUDGET")).toBe("Meta को रोज़ कम से कम ₹96 चाहिए। रोज़ का बजट ₹96 या उससे ज़्यादा रखें।");
    expect(message("hi", (v) => { v.geo.unresolvedNames = ["A1", "A2", "A3", "A4", "A5", "A6", "A7"]; }, "REVIEW_AREAS_UNRESOLVED"))
      .toBe('Meta ये इलाके नहीं पहचान पाया: "A1", "A2", "A3", "A4" और "A5" और 2 अन्य। इन्हें ठीक करें या हटाएँ, या पूरे देश में विज्ञापन चलाना चुनें।');
    expect(message("hi", (v) => { v.creatives[0].approved = false; }, "REVIEW_CREATIVES"))
      .toBe('विज्ञापन "New-Patient Exam" अभी मंज़ूर नहीं हुआ है। उसे "विज्ञापन जाँचें" पेज पर मंज़ूर करें, या इस कैंपेन से हटाएँ।');
    expect(message("hi", (v) => unapproved(v, ["Exam", "Second", "Third"]), "REVIEW_CREATIVES"))
      .toBe('विज्ञापन "Exam" अभी मंज़ूर नहीं हुआ है। उसे "विज्ञापन जाँचें" पेज पर मंज़ूर करें, या इस कैंपेन से हटाएँ। 2 और विज्ञापन भी ठीक करने हैं।');
    expect(message("hi", (v) => { v.draft.destination = "whatsapp"; v.whatsappMessageProblem = "PROBLEM"; }, "REVIEW_WHATSAPP_MESSAGE")).toBe("आपका WhatsApp मैसेज: PROBLEM");
  });

  it("names every fix button in the owner's language, English unchanged", () => {
    const words = { locale: "hi" as const, messages: hi.campaigns };
    for (const reason of reviewBlockerReasons) {
      const english = reviewBlockerFix(reason)!;
      expect(english.label).toBe(en.campaigns.review.fix[reason]);
      const hindi = reviewBlockerFix(reason, words)!;
      expect({ ...hindi, label: english.label }).toEqual(english);
      expect(hindi.label).toMatch(devanagari);
    }
    expect(reviewBlockerFix("REVIEW_BUDGET")!.label).toBe("Set the daily budget");
    expect(reviewBlockerAlternative("REVIEW_NO_WEBSITE")!.label).toBe("Use WhatsApp chat instead (no website needed)");
    expect(reviewBlockerAlternative("REVIEW_NO_WEBSITE", words)!.label).toMatch(devanagari);
  });
});
