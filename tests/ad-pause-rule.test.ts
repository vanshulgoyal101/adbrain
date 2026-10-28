import { describe, expect, it } from "vitest";
import { lastAdAction, pauseSuggestion } from "@/lib/campaign/ad-pause";
import type { AdResultView } from "@/lib/campaign/ad-results-store";

const ad = (adId: string, spend: number, results: number, over: Partial<AdResultView> = {}): AdResultView => ({
  adId, name: `Ad ${adId}`, delivered: true, replaced: false, best: false, creative: null, earlier: false, status: "ACTIVE", impressions: 1000,
  results, spend, costPerResult: results > 0 ? spend / results : null, ...over,
});

describe("pause-this-ad rule (#1045)", () => {
  it("needs 5 enquiries across the campaign, the same bar as 'Best'", () => {
    expect(pauseSuggestion([ad("A", 400, 4, { best: false }), ad("B", 900, 0)])).toBeNull();
    expect(pauseSuggestion([ad("A", 500, 5), ad("B", 900, 0)])?.ad.adId).toBe("B");
  });

  // Designer on #783: the offer names ads like the rows under it, by headline, not Meta's ad name.
  it("carries each ad's creative so the offer can name it by headline", () => {
    const best = ad("A", 500, 5, { creative: { headline: "Your rooftop could cut power bills", imageUrl: null } });
    const pick = pauseSuggestion([best, ad("B", 400, 2, { name: "Solaride | Lever 2 | WhatsApp | Ad 3", creative: { headline: "Free site survey", imageUrl: null } })]);
    expect(pick?.ad.creative?.headline).toBe("Free site survey");
    expect(pick?.reference.creative?.headline).toBe("Your rooftop could cut power bills");
  });

  it("offers an ad at 2× the best ad's cost per enquiry, not at 1.99×", () => {
    const best = ad("A", 500, 5, { best: true }); // ₹100 each
    expect(pauseSuggestion([best, ad("B", 400, 2)])).toMatchObject({ ad: { adId: "B", costPerResult: 200 }, reference: { adId: "A", costPerResult: 100 }, reason: "expensive" });
    expect(pauseSuggestion([best, ad("B", 398, 2)])).toBeNull();
  });

  it("offers an ad with no enquiries once it spent 2× the campaign's cost per enquiry, not before", () => {
    // Campaign cost per enquiry = (₹1,000 + B) / 10, so B qualifies from B ≥ 2 × that, i.e. B ≥ ₹250.
    expect(pauseSuggestion([ad("A", 1000, 10), ad("B", 250, 0)])).toMatchObject({ ad: { adId: "B" }, reason: "no_enquiries" });
    expect(pauseSuggestion([ad("A", 1000, 10), ad("B", 249, 0)])).toBeNull();
  });

  it("never offers the reference ad, a replaced ad or one that isn't running; picks the most wasteful", () => {
    const best = ad("A", 500, 10, { best: true });
    expect(pauseSuggestion([best, ad("B", 600, 2, { status: "PAUSED" }), ad("C", 700, 2, { replaced: true })])).toBeNull();
    expect(pauseSuggestion([best, ad("B", 300, 2), ad("C", 600, 2)])?.ad.adId).toBe("C");
  });

  it("uses the cheapest ad with enquiries as the reference when #783 names no 'Best'", () => {
    expect(pauseSuggestion([ad("A", 300, 3), ad("B", 500, 2), ad("C", 200, 0, { status: "PAUSED" })])).toMatchObject({ ad: { adId: "B" }, reference: { adId: "A" } });
  });

  it("reads the last thing AdBrain did to an ad from the record", () => {
    const snapshot = { adPauses: [{ adId: "B", action: "paused", at: "t1" }, { adId: "B", action: "resumed", at: "t2" }, { adId: "C", action: "paused", at: "t3" }] };
    expect(lastAdAction(snapshot, "B")).toBe("resumed");
    expect(lastAdAction(snapshot, "C")).toBe("paused");
    expect(lastAdAction(snapshot, "D")).toBeNull();
    expect(lastAdAction(null, "B")).toBeNull();
  });
});
