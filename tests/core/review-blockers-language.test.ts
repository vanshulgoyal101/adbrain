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
  ["whatsapp choice changed", (v) => { v.draft.destination = "whatsapp"; v.draft.whatsappNumber = "+91 ••••• 3210"; v.whatsappNumber = null; }, "REVIEW_WHATSAPP_CHOOSE"],
  ["whatsapp message", (v) => { v.draft.destination = "whatsapp"; v.whatsappMessageProblem = "PROBLEM"; }, "REVIEW_WHATSAPP_MESSAGE"],
  ["media rights", (v) => { v.creatives[0].ownMedia = true; v.mediaConsent = false; }, "REVIEW_MEDIA_RIGHTS"],
  ["lead form", (v) => { v.form = null; }, "REVIEW_NO_LEAD_FORM"],
  ["website", (v) => { v.website = null; }, "REVIEW_NO_WEBSITE"],
  ["policy", (v) => { v.vertical = "chiropractic clinic"; v.creatives[0].headline = "Cures back pain"; }, "REVIEW_AD_POLICY"],
  ["policy no headline", (v) => { v.vertical = "chiropractic clinic"; v.creatives[0].headline = null; v.creatives[0].primaryText = "Cures back pain"; }, "REVIEW_AD_POLICY"],
  ["policy promise", (v) => { v.vertical = "coaching institute"; v.creatives[0].headline = "Guaranteed rank"; }, "REVIEW_AD_POLICY"],
  ["site missing", (v) => { toWebsite(v); v.website = null; }, "REVIEW_NO_WEBSITE"],
  ["site unchecked", (v) => toWebsite(v), "REVIEW_WEBSITE_UNREACHABLE"],
  ["site error", (v) => toWebsite(v, { url: SITE, ok: false, problem: "status", status: 503 }), "REVIEW_WEBSITE_UNREACHABLE"],
  ["site error uncoded", (v) => toWebsite(v, { url: SITE, ok: false, problem: "status" }), "REVIEW_WEBSITE_UNREACHABLE"],
  ["site private", (v) => toWebsite(v, { url: SITE, ok: false, problem: "blocked" }), "REVIEW_WEBSITE_UNREACHABLE"],
  ["site redirect", (v) => toWebsite(v, { url: SITE, ok: false, problem: "other_domain", finalHost: "parked.example" }), "REVIEW_WEBSITE_UNREACHABLE"],
  ["site redirect unknown", (v) => toWebsite(v, { url: SITE, ok: false, problem: "other_domain" }), "REVIEW_WEBSITE_UNREACHABLE"],
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
  ["tracking none", (v) => toGoal(v, "leads", { state: "none", pixelId: null, window: null, counts: null, totalEvents: null }), "REVIEW_TRACKING"],
  ["tracking choose", (v) => { toGoal(v, "sales", {}); v.tracking!.pixelId = null; }, "REVIEW_TRACKING"],
  ["tracking unread", (v) => { toGoal(v, "leads", {}); v.tracking!.status = null; }, "REVIEW_TRACKING"],
  ["tracking reconnect", (v) => toGoal(v, "leads", { state: "unreadable", unreadable: "reconnect", window: null, counts: null, totalEvents: null }), "REVIEW_TRACKING"],
  ["tracking quiet", (v) => toGoal(v, "leads", { state: "quiet", lastSeenAt: null, counts: { Lead: 0, Purchase: 0 }, totalEvents: 0 }), "REVIEW_TRACKING"],
  ["tracking quiet seen", (v) => toGoal(v, "sales", { state: "quiet", lastSeenAt: "2026-10-20T05:00:00+0000", counts: { Lead: 0, Purchase: 0 }, totalEvents: 0 }), "REVIEW_TRACKING"],
  ["tracking no sale", (v) => toGoal(v, "sales", { state: "event_missing" }), "REVIEW_TRACKING"],
  ["goal words leads", (v) => { toGoal(v, "leads", {}); v.creatives[0].cta = "Buy now"; }, "REVIEW_GOAL_WORDS"],
  ["goal words sales", (v) => { toGoal(v, "sales", { counts: { Lead: 0, Purchase: 3 } }); v.creatives[0].cta = "Sign up"; v.creatives[0].headline = null; }, "REVIEW_GOAL_WORDS"],
];

/** #2714: a website signup or sales campaign; its tracking ready unless changed (shape: tests/core/meta-pixels.test.ts). */
function toGoal(v: PreflightInput, goal: "leads" | "sales", status: Partial<NonNullable<NonNullable<PreflightInput["tracking"]>["status"]>>): void {
  toWebsite(v, { url: SITE, ok: true, finalUrl: `${SITE}/` });
  v.draft.websiteGoal = goal;
  v.tracking = { pixelId: "9000000000000003", status: {
    state: "ready", unreadable: null, pixelId: "9000000000000003", pixels: [], window: { since: "2026-10-26T16:00:00+0000", until: "2026-11-02T16:00:00+0000" },
    lastSeenAt: "2026-11-01T14:00:00+0000", counts: { Lead: 2, Purchase: 0 }, totalEvents: 60, ...status,
  } };
}

const SITE = "https://cedarridgechiro.com";
/** #2599: a website ad, its site checked (or not) by Review. */
function toWebsite(v: PreflightInput, reach?: unknown): void {
  v.draft.destination = "website";
  v.draft.leadFormId = null;
  v.form = null;
  v.websiteReach = reach as PreflightInput["websiteReach"];
}

/** The English each sentence said before #2333 slice 2: unchanged, byte for byte. */
const ENGLISH: Record<string, string> = {
  "media rights": "Your ads use your own photos. Confirm you own them, or have permission to use them, before they go to Meta.",
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
  "whatsapp choice changed": "Choose a WhatsApp number in Campaigns, then review again.",
  "whatsapp message": "Your WhatsApp message: PROBLEM",
  "lead form": "Choose an active lead form from your Facebook Page in the Lead form field.",
  "website": "Add your business website on the Your business page. Meta lead ads must link to the advertiser's own website, not Facebook.",
  "policy": "\"cures\" in the ad \"Cures back pain\" is a health promise Meta rejects. Edit the ad to describe the service instead.",
  "policy no headline": "\"cures\" in the ad \"without a headline\" is a health promise Meta rejects. Edit the ad to describe the service instead.",
  "policy promise": "\"guaranteed\" in the ad \"Guaranteed rank\" is a promise Meta rejects. Edit the ad to describe the service instead.",
  // #2599's website sentences, as they were in English.
  "site missing": "Add your business website on the Your business page. A website ad opens your own site, so AdBrain needs its address.",
  "site unchecked": "AdBrain couldn't open your website cedarridgechiro.com. Check the address on the Your business page, or make sure the site is up, then review again.",
  "site error": "Your website cedarridgechiro.com answered with an error (503) when AdBrain opened it. Check the address on the Your business page, or make sure the site is up, then review again.",
  "site error uncoded": "Your website cedarridgechiro.com answered with an error when AdBrain opened it. Check the address on the Your business page, or make sure the site is up, then review again.",
  "site private": "cedarridgechiro.com isn't a public website address. Add your business's public site on the Your business page.",
  "site redirect": "Your website cedarridgechiro.com sends visitors on to parked.example. Add the address of your own site on the Your business page, so the ad opens your business.",
  "site redirect unknown": "Your website cedarridgechiro.com sends visitors on to another site. Add the address of your own site on the Your business page, so the ad opens your business.",
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
  // #2714's website goal sentences.
  "tracking none": "Your ad account has no website tracking (Meta pixel) yet, so Meta can't count signups from this ad. Add tracking to your site, or choose the visits goal.",
  "tracking choose": "Choose which website tracking counts your sales on the Your business page, then review again.",
  "tracking unread": "AdBrain couldn't read your website tracking from Meta. Try reviewing again in a few minutes.",
  "tracking reconnect": "AdBrain couldn't read your website tracking from Meta. Connect Facebook again, then review again.",
  "tracking quiet": "Your website tracking reported nothing from 26 Oct to 2 Nov. Check that it is on your site, then review again, or choose the visits goal.",
  "tracking quiet seen": "Your website tracking reported nothing from 26 Oct to 2 Nov (last heard 20 Oct). Check that it is on your site, then review again, or choose the visits goal.",
  "tracking no sale": "Your website tracking works but reported no sale (Purchase) from 26 Oct to 2 Nov. Make sure your site sends it, then review again, or choose the visits goal.",
  "goal words leads": "The ad \"New-Patient Exam\" asks people to buy, but this campaign looks for signups. Choose an ad that fits, or change the goal.",
  "goal words sales": "The ad you chose asks people to sign up, but this campaign looks for sales. Choose an ad that fits, or change the goal.",
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
    expect(message("hi", (v) => toWebsite(v, { url: SITE, ok: false, problem: "status", status: 503 }), "REVIEW_WEBSITE_UNREACHABLE"))
      .toBe("AdBrain ने आपकी वेबसाइट cedarridgechiro.com खोली तो उसने गड़बड़ी (503) बताई। Your business पेज पर पता जाँचें, या पक्का करें कि साइट चल रही है, फिर से रिव्यू करें।");
    expect(message("hi", (v) => toWebsite(v, { url: SITE, ok: false, problem: "other_domain", finalHost: "parked.example" }), "REVIEW_WEBSITE_UNREACHABLE"))
      .toBe("आपकी वेबसाइट cedarridgechiro.com लोगों को parked.example पर भेज देती है। Your business पेज पर अपनी साइट का पता जोड़ें, ताकि विज्ञापन आपका बिज़नेस खोले।");
    expect(message("hi", (v) => { v.vertical = "coaching institute"; v.creatives[0].headline = "Guaranteed rank"; }, "REVIEW_AD_POLICY"))
      .toBe('विज्ञापन "Guaranteed rank" में "guaranteed" ऐसा वादा है जिसे Meta मना कर देता है। विज्ञापन बदलकर सेवा के बारे में बताएँ।');
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
