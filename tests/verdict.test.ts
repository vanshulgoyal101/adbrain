import { describe, expect, it } from "vitest";
import type { AdResultView } from "@/lib/campaign/ad-results-store";
import hi from "../messages/hi.json";
import { restatesStatus, verdict, type VerdictInput } from "@/lib/campaign/verdict";

// #1255 slice 1: the card's one sentence, one number, one action, at every edge the CPO set.
const NOW = Date.parse("2026-10-28T12:00:00Z");
// The Analyst's gates: 20–29 pooled results compare with the median; 30+ may quote the interquartile range.
const solar = { kind: "category", category: "solar", results: 24, typical: 200 } as const;
const base: VerdictInput = {
  destination: "whatsapp", status: "active", liveSince: "2026-10-20T10:00:00Z", impressions: 5000, results: 10, spend: 1500,
  opens: 40, waiting: 0, weakAd: null, comparison: solar, now: NOW,
};
const v = (change: Partial<VerdictInput>) => verdict({ ...base, ...change });
const ad = (adId: string, results: number, spend: number): AdResultView => ({
  adId, name: adId, delivered: true, replaced: false, best: false, creative: null, earlier: false, status: "ACTIVE",
  impressions: 1000, results, spend, costPerResult: results ? spend / results : null,
});

describe("verdict (#1255)", () => {
  it("evidence bar: 4 results or ₹499 is early days; 5 results and ₹500 is judged", () => {
    expect(v({ results: 4, spend: 600 })).toMatchObject({ state: "early", label: "Early days", sentence: "4 chats so far. AdBrain will tell you if it's working after 5.", number: { kind: "cost", value: 150 }, action: null });
    expect(v({ results: 5, spend: 499 })).toMatchObject({ state: "early" });
    expect(v({ results: 5, spend: 500 })).toMatchObject({ state: "working", number: { kind: "cost", value: 100 } });
    expect(v({ results: 1, spend: 120 }).sentence).toBe("1 chat so far. AdBrain will tell you if it's working after 5.");
  });

  it("bands around the typical cost: < 0.67× working, 0.67–1.5× about the same, > 1.5× costly", () => {
    expect(v({ results: 10, spend: 1330 })).toMatchObject({ state: "working", label: "Working", action: null, sentence: "Each chat costs ₹133, less than usual for solar ads AdBrain has run (about ₹200 each)." });
    expect(v({ results: 10, spend: 1340 })).toMatchObject({ state: "about_average", label: "About average", sentence: "Each chat costs ₹134, about the same as usual for solar ads AdBrain has run (about ₹200 each)." });
    expect(v({ results: 10, spend: 3000 })).toMatchObject({ state: "about_average" });
    expect(v({ results: 10, spend: 3001 })).toMatchObject({ state: "costly", label: "Costly", action: "new_ads", sentence: "Each chat costs ₹300, more than usual for solar ads AdBrain has run (about ₹200 each)." });
  });

  it("never says 'less than' for a cost inside the usual range (Reviewer: ₹290 against ₹100–300)", () => {
    const wide = { kind: "category", category: "solar", results: 40, typical: 200, low: 100, high: 300 } as const;
    expect(v({ results: 10, spend: 2900, comparison: wide })).toMatchObject({ state: "about_average", sentence: "Each chat costs ₹290, about the same as usual for solar ads AdBrain has run (₹100–300)." });
    expect(v({ results: 10, spend: 1300, comparison: wide }).sentence).toBe("Each chat costs ₹130, less than usual for solar ads AdBrain has run (₹100–300).");
  });

  it("compares only with 20+ results behind the typical cost; below that, the number with no judgement", () => {
    expect(v({ comparison: { ...solar, results: 19 } })).toMatchObject({ state: "measured", label: "Live", sentence: "Each chat costs ₹150." });
    expect(v({ comparison: { kind: "own", results: 19, typical: 300 } })).toMatchObject({ state: "measured" });
    expect(v({ comparison: { kind: "own", results: 20, typical: 300 } }).sentence).toBe("Each chat costs ₹150, less than your last campaign (₹300 each).");
    expect(v({ comparison: null, destination: "instant_form", opens: null })).toMatchObject({ state: "measured", sentence: "Each enquiry costs ₹150." });
  });

  it("#1929: the first evening says how often the ads were shown, not only 'No chats yet'", () => {
    expect(v({ impressions: 340, results: 0, spend: 120, comparison: null })).toMatchObject({ state: "early", action: null,
      sentence: "Your ads have been shown 340 times so far. No chats yet; many people message in the evening." });
    expect(v({ impressions: 340, results: 1, spend: 120, comparison: null }).sentence).toBe("1 chat so far. AdBrain will tell you if it's working after 5.");
    // Paused before it ever showed: nothing was shown, so the bare line stays.
    expect(v({ status: "paused", impressions: 0, results: 0, spend: 0, comparison: null }).sentence).toBe("No chats yet.");
    // QA nit on #2143: paused after showing; no promise of evening chats from ads that aren't running.
    expect(v({ status: "paused", impressions: 340, results: 0, spend: 120, comparison: null }).sentence).toBe("No chats yet.");
    expect(v({ destination: "instant_form", opens: null, impressions: 340, results: 0, spend: 120, comparison: null }).sentence).toBe("No enquiries yet.");
  });

  it("spent with no results: ₹299 is early, ₹300 says so; the range's 1.5× upper end raises the bar; opens only from 10", () => {
    expect(v({ results: 0, spend: 299, comparison: null })).toMatchObject({ state: "early", sentence: "Your ads have been shown 5,000 times so far. No chats yet; many people message in the evening.", number: { kind: "count", value: 0 } });
    expect(v({ results: 0, spend: 300, comparison: null, opens: 9 })).toMatchObject({ state: "no_results", label: "No chats yet", sentence: "₹300 spent, no chats yet.", action: "edit_message" });
    // A comparison raises the bar to 1.5× its typical cost (₹200 → ₹300).
    expect(v({ results: 0, spend: 299 })).toMatchObject({ state: "early" });
    expect(v({ results: 0, spend: 299, comparison: { ...solar, typical: 250 } })).toMatchObject({ state: "early" });
    expect(v({ results: 0, spend: 375, comparison: { ...solar, typical: 250 } })).toMatchObject({ state: "no_results" });
    expect(v({ results: 0, spend: 300, opens: 10 }).sentence).toBe("₹300 spent, no chats yet. 10 people opened WhatsApp but didn't send the message.");
    expect(v({ results: 0, spend: 300, destination: "instant_form", opens: null })).toMatchObject({ sentence: "₹300 spent, no enquiries yet.", action: null });
  });

  it("not showing: under a day Meta is checking; from a day, see Meta's status", () => {
    expect(v({ impressions: 0, results: 0, spend: 0, liveSince: new Date(NOW - 86_399_000).toISOString() })).toMatchObject({ state: "not_showing", action: null });
    expect(v({ impressions: 0, results: 0, spend: 0, liveSince: new Date(NOW - 86_400_000).toISOString() })).toMatchObject({ state: "not_showing_day", action: "meta_status" });
    // A paused campaign isn't waiting on Meta (#173 keeps its own line on the card).
    expect(v({ status: "paused", impressions: 0, results: 0, spend: 0 }).state).toBe("early");
  });

  it("#1045's weak ad leads, with how many times as much it costs", () => {
    const expensive = { ad: ad("a2", 2, 900), reference: ad("a1", 6, 600), reason: "expensive" as const };
    expect(v({ weakAd: expensive })).toMatchObject({ state: "weak_ad", action: "pause_ad", sentence: "One ad costs 5 times as much per chat as your others. Pausing it leaves more of your budget for the ones that work." });
    const silent = { ad: ad("a3", 0, 450), reference: ad("a1", 6, 600), reason: "no_enquiries" as const };
    expect(v({ weakAd: silent }).sentence).toBe("One ad has spent ₹450 with no chats while your others bring them. Pausing it leaves more of your budget for the ones that work.");
  });

  it("ended: worked, costly, measured without a comparison, or too few to judge", () => {
    expect(v({ status: "completed", results: 14, spend: 1344 })).toMatchObject({ state: "ended_worked", label: "Ended", action: "run_again", sentence: "14 chats at ₹96 each. Run it again with the best ad first?" });
    expect(v({ status: "completed", results: 10, spend: 3010 })).toMatchObject({ state: "ended_costly", action: "new_ads", sentence: "It didn't bring chats at a good price. Try new ads?" });
    // CPO: no comparison, no judgement; Run this again once there are 5+ chats (#1050 picks the best ad).
    expect(v({ status: "completed", results: 14, spend: 1344, comparison: null })).toMatchObject({ state: "ended_measured", action: "run_again", sentence: "It ended with 14 chats at ₹96 each." });
    // #1625 (CPO): too few to judge isn't bad; run the only ads with data again for longer.
    expect(v({ status: "completed", results: 1, spend: 33 })).toMatchObject({ state: "ended_too_few", action: "run_again", sentence: "It ended with 1 chat, too few to judge yet. Run it again for longer?" });
    expect(v({ status: "completed", results: 0, spend: 300, opens: 12 })).toMatchObject({ state: "ended_too_few", action: "run_again", sentence: "It ended with 0 chats, too few to judge yet. Run it again for longer?" });
    // Nobody tapped at all: the ads, so new ones.
    expect(v({ status: "completed", results: 0, spend: 300, opens: 0 })).toMatchObject({ state: "ended_too_few", action: "new_ads", sentence: "It ended with 0 chats, too few to judge." });
    expect(v({ status: "completed", results: 0, spend: 300, opens: null, destination: "instant_form" })).toMatchObject({ action: "new_ads" });
  });

  it("people waiting prefix any live state, and Reply is the action only where the state has none", () => {
    expect(v({ waiting: 2 })).toMatchObject({ state: "about_average", action: "reply", sentence: "2 people are waiting for your reply. Each chat costs ₹150, about the same as usual for solar ads AdBrain has run (about ₹200 each)." });
    expect(v({ waiting: 1, results: 0, spend: 400, comparison: null })).toMatchObject({ action: "edit_message", sentence: "1 person is waiting for your reply. ₹400 spent, no chats yet. 40 people opened WhatsApp but didn't send the message." });
    expect(v({ waiting: 3, status: "completed", results: 1, spend: 33 }).sentence).toBe("It ended with 1 chat, too few to judge yet. Run it again for longer?");
  });

  it("QA 2's Solaride numbers (#1133): the Jan WhatsApp run (1 chat, ₹32.63) and today's live run (0 chats, ₹40)", () => {
    expect(v({ status: "paused", impressions: 439, results: 1, spend: 32.63, opens: 3 })).toMatchObject({ state: "early", number: { kind: "cost", value: 33 }, sentence: "1 chat so far. AdBrain will tell you if it's working after 5." });
    expect(v({ impressions: 601, results: 0, spend: 40.83, opens: 0 })).toMatchObject({ state: "early", sentence: "Your ads have been shown 601 times so far. No chats yet; many people message in the evening.", number: { kind: "count", value: 0 } });
  });
});

// #1438 (CPO's Screen 2 table): the same rules in Hindi; numbers and ₹ stay as in English.
describe("verdict in Hindi (#1438)", () => {
  const words = { locale: "hi" as const, messages: hi.verdict };
  const h = (change: Partial<VerdictInput>) => verdict({ ...base, ...change }, words);
  const own = { kind: "own", results: 25, typical: 300 } as const;

  it("#1929: the first evening, in the CPO's Hindi", () => {
    expect(h({ impressions: 1340, results: 0, spend: 120, comparison: null }).sentence)
      .toBe("आपके विज्ञापन अब तक 1,340 बार दिखे हैं। अभी कोई चैट नहीं; बहुत लोग शाम को मैसेज करते हैं।");
  });

  it("people waiting, then the cost against the owner's last campaign", () => {
    expect(h({ comparison: own, waiting: 2 })).toMatchObject({ state: "working", label: "अच्छा चल रहा है", action: "reply",
      sentence: "2 लोग आपके जवाब का इंतज़ार कर रहे हैं। हर चैट ₹150 की पड़ रही है, आपके पिछले कैंपेन (हर एक ₹300) से कम।" });
    expect(h({ comparison: own, waiting: 1 }).sentence).toMatch(/^1 व्यक्ति आपके जवाब का इंतज़ार कर रहा है। /);
    expect(h({ comparison: null })).toMatchObject({ label: "चालू", sentence: "हर चैट ₹150 की पड़ रही है।" });
    expect(h({ comparison: { ...solar, results: 30, low: 100, high: 300 }, spend: 3500 })).toMatchObject({ label: "महंगा",
      sentence: "हर चैट ₹350 की पड़ रही है, AdBrain के चलाए solar विज्ञापनों के आम खर्च (₹100–300) से ज़्यादा।" });
    expect(h({ spend: 2000 }).sentence).toBe("हर चैट ₹200 की पड़ रही है, AdBrain के चलाए solar विज्ञापनों के आम खर्च (लगभग ₹200 हर एक) से बहुत अलग नहीं।");
  });

  it("early days, no results with opens, not showing, and enquiries", () => {
    expect(h({ results: 3, spend: 300 })).toMatchObject({ label: "अभी शुरुआत है", sentence: "अब तक 3 चैट। 5 के बाद AdBrain बताएगा कि यह काम कर रहा है या नहीं।" });
    expect(h({ results: 0, spend: 100 }).sentence).toBe("आपके विज्ञापन अब तक 5,000 बार दिखे हैं। अभी कोई चैट नहीं; बहुत लोग शाम को मैसेज करते हैं।");
    expect(h({ results: 0, spend: 400, opens: 12, comparison: null })).toMatchObject({ label: "अभी कोई चैट नहीं",
      sentence: "₹400 खर्च हुए, अभी तक कोई चैट नहीं। 12 लोगों ने WhatsApp खोला पर मैसेज नहीं भेजा।" });
    expect(h({ destination: "instant_form", results: 0, spend: 400, opens: null, comparison: null })).toMatchObject({ label: "अभी कोई पूछताछ नहीं",
      sentence: "₹400 खर्च हुए, अभी तक कोई पूछताछ नहीं।" });
    expect(h({ impressions: 0, results: 0, spend: 0, liveSince: "2026-10-27T10:00:00Z" })).toMatchObject({ label: "अभी दिख नहीं रहा",
      sentence: "एक दिन बाद भी आपके विज्ञापन दिखने शुरू नहीं हुए। देखें Meta क्या कह रहा है।" });
  });

  it("a weak ad and an ended run", () => {
    const expensive = { ad: ad("a2", 2, 900), reference: ad("a1", 6, 600), reason: "expensive" as const };
    expect(h({ weakAd: expensive }).sentence).toBe("एक विज्ञापन में हर चैट बाकी विज्ञापनों से 5 गुना महंगी पड़ रही है। इसे रोकने से बजट उन विज्ञापनों को मिलेगा जो चल रहे हैं।");
    expect(h({ status: "completed", destination: "instant_form", spend: 5000, opens: null })).toMatchObject({ label: "खत्म",
      sentence: "इससे सही दाम पर पूछताछ नहीं आई। नए विज्ञापन आज़माएँ?" });
    expect(h({ status: "completed", results: 0, spend: 100, opens: 0 }).sentence).toBe("यह 0 चैट के साथ खत्म हुआ, कुछ कहने के लिए बहुत कम।");
  });

  it("'Live' and 'Ended' restate a campaign's status, in any language", () => {
    expect(restatesStatus(h({ comparison: null }).state)).toBe(true);
    expect(restatesStatus(h({ status: "completed" }).state)).toBe(true);
    expect(restatesStatus(h({ results: 3, spend: 300 }).state)).toBe(false);
  });
});
