import { describe, expect, it } from "vitest";
import { pauseSuggestion } from "@/lib/campaign/ad-pause";
import type { AdResultView } from "@/lib/campaign/ad-results-store";
import { EVIDENCE_MIN_RESULTS, IN_REVIEW_MS, SPENT_NO_RESULTS_RATIO, verdict, type VerdictInput } from "@/lib/campaign/verdict";

// #1273 (#1255 WS2 slice 1): one sentence, one number, at most one action, by fixed rules. Real Solaride numbers
// from QA 2's results audit (#1133, Oct 28 07:39Z, AdBrain's card = Meta to the rupee).
const now = new Date("2026-10-28T08:00:00Z");
const solarLedger = { low: 150, high: 180 }; // placeholder range until the CPO picks the ledger's (#1255)
const base: VerdictInput = { status: "live", destination: "whatsapp", liveSince: "2026-10-26T10:00:00Z", now, impressions: 0, spend: 0, results: 0, opens: 0, unreplied: 0, weakAd: null, ledger: solarLedger };
const ad = (adId: string, results: number, spend: number, over: Partial<AdResultView> = {}): AdResultView => ({
  adId, name: `Ad ${adId}`, delivered: true, replaced: false, best: false, creative: null, earlier: false, status: "ACTIVE",
  impressions: 1000, results, spend, costPerResult: results ? spend / results : null, ...over,
} as AdResultView);

describe("core: the campaign verdict (#1273)", () => {
  it("Lever 2 WhatsApp, live: ₹51.96, 2 opens, 0 chats is early, not failing", () => {
    expect(verdict({ ...base, impressions: 874, spend: 51.96, opens: 2 })).toEqual({ state: "early", number: { kind: "count", value: 0 }, action: null, waiting: 0 });
  });

  it("Free Survey EN, paused: ₹374.06 for 1 chat is still under the evidence bar", () => {
    expect(verdict({ ...base, status: "paused", impressions: 6144, spend: 374.06, results: 1, opens: 30 }))
      .toMatchObject({ state: "early", number: { kind: "cost_per_result", value: 374.06 } });
  });

  it("Diwali #157, ended: 5 chats for ₹820.04 (₹164 each, inside the range) worked, so Run this again", () => {
    expect(verdict({ ...base, status: "ended", impressions: 13707, spend: 820.04, results: 5, opens: 94 }))
      .toEqual({ state: "ended_worked", number: { kind: "cost_per_result", value: 164.01 }, action: "run_again", waiting: 0 });
    expect(verdict({ ...base, status: "ended", spend: 1000, results: 5 })).toMatchObject({ state: "ended_poor", action: "try_new_ads" });
    expect(verdict({ ...base, status: "ended", spend: 300, results: 4 })).toMatchObject({ state: "ended_poor" });
  });

  it("spent with no results at 1.5× the ledger's typical cost: the WhatsApp message is the thing to fix", () => {
    const edge = SPENT_NO_RESULTS_RATIO * 165;
    expect(verdict({ ...base, impressions: 4000, spend: edge, opens: 38 })).toMatchObject({ state: "spent_no_results", action: "edit_message", number: { kind: "count", value: 0 } });
    expect(verdict({ ...base, impressions: 4000, spend: edge - 0.01, opens: 38 }).state).toBe("early");
    expect(verdict({ ...base, destination: "instant_form", impressions: 4000, spend: 450 })).toMatchObject({ state: "spent_no_results", action: null });
    // Without AdBrain's own range there is nothing honest to compare with.
    expect(verdict({ ...base, impressions: 4000, spend: 450, ledger: null }).state).toBe("early");
  });

  it("Meta is checking the ads only in the first day with nothing shown yet", () => {
    const justLive = new Date(now.getTime() - IN_REVIEW_MS + 60_000).toISOString();
    expect(verdict({ ...base, liveSince: justLive })).toMatchObject({ state: "in_review", action: null });
    expect(verdict({ ...base, liveSince: new Date(now.getTime() - IN_REVIEW_MS).toISOString() }).state).toBe("early");
    expect(verdict({ ...base, liveSince: justLive, impressions: 10 }).state).toBe("early");
  });

  it("past the evidence bar: above the range costs too much, within or below it is working", () => {
    expect(EVIDENCE_MIN_RESULTS).toBe(5);
    expect(verdict({ ...base, impressions: 9000, spend: 5 * 180, results: 5 })).toMatchObject({ state: "working", number: { value: 180 } });
    expect(verdict({ ...base, impressions: 9000, spend: 5 * 180.01, results: 5 })).toMatchObject({ state: "expensive", action: "try_new_ads" });
    expect(verdict({ ...base, impressions: 9000, spend: 480, results: 5 })).toMatchObject({ state: "working", action: null });
    expect(verdict({ ...base, impressions: 9000, spend: 2000, results: 5, ledger: null }).state).toBe("working");
  });

  it("a weak ad on a live campaign (#1045's rule) comes first, and only while it runs", () => {
    const ads = [ad("1", 6, 480, { best: true }), ad("2", 1, 400)];
    const weakAd = pauseSuggestion(ads);
    expect(weakAd).not.toBeNull();
    expect(verdict({ ...base, impressions: 9000, spend: 880, results: 7, weakAd })).toMatchObject({ state: "weak_ad", action: "pause_ad" });
    expect(verdict({ ...base, status: "paused", impressions: 9000, spend: 880, results: 7, weakAd }).state).not.toBe("weak_ad");
  });

  it("people waiting for a reply prefix any state and take the one action", () => {
    expect(verdict({ ...base, impressions: 874, spend: 51.96, results: 1, unreplied: 2 })).toMatchObject({ state: "early", waiting: 2, action: "reply" });
    expect(verdict({ ...base, status: "ended", spend: 820.04, results: 5, unreplied: 1 })).toMatchObject({ state: "ended_worked", action: "reply" });
  });
});
