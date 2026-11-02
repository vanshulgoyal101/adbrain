import { describe, expect, it } from "vitest";
import recorded from "./fixtures/meta/website-results.provisional.json";
import whatsappRecorded from "./fixtures/meta/whatsapp-results.json";
import { decodeAdResults, decodeCampaignInsights } from "@/lib/meta/insights";
import { verdict, type VerdictInput } from "@/lib/campaign/verdict";
import { cardVerdictInput, lastCampaignComparison } from "@/lib/campaign/card-verdict";
import { poolLedger } from "@/lib/campaign/ledger";
import { costPerResultFrom, pastResultsBlock, pickResultEvidence, resultSummary, toEvidenceCampaign, type EvidenceCampaign } from "@/lib/campaign/result-evidence";
import { rerunPrefill } from "@/lib/campaign/rerun";
import hi from "../../messages/hi.json";

// #2601 (#2595 slice E): a website campaign's result is a landing-page view, said as "visits", never "chats".
// The insights shape is provisional until the first real website campaign is read (see the fixture's source).
const NOW = Date.parse("2026-11-05T12:00:00Z");

describe("core: website results from Meta insights (#2601)", () => {
  it("reads landing-page views, link clicks, cost per click and cost per visit", () => {
    const insights = decodeCampaignInsights(recorded.payload, "website");
    expect(insights).toMatchObject({ destination: "website", impressions: 4210, clicks: 97, spend: 412.5, leads: 0, landingPageViews: 55, linkClicks: 75 });
    expect(insights.costPerLandingPageView).toBeCloseTo(7.5);
    expect(insights.cpc).toBeCloseTo(5.5);
    expect(insights).not.toHaveProperty("conversations");
    expect(insights).not.toHaveProperty("whatsappOpens");
  });

  it("keeps WhatsApp and form reads unchanged: no website fields", () => {
    const whatsapp = decodeCampaignInsights(whatsappRecorded.payload, "whatsapp");
    expect(whatsapp).toMatchObject({ whatsappOpens: 12, conversations: 1, clicks: 15 });
    for (const destination of ["whatsapp", "instant_form"] as const) {
      const read = decodeCampaignInsights(whatsappRecorded.payload, destination);
      expect(read).not.toHaveProperty("landingPageViews");
      expect(read).not.toHaveProperty("linkClicks");
      expect(read).not.toHaveProperty("cpc");
    }
  });

  it("a website campaign Meta hasn't delivered reads zero visits and no costs", () => {
    expect(decodeCampaignInsights({ data: [] }, "website")).toMatchObject({ landingPageViews: 0, linkClicks: 0, cpc: null, costPerLandingPageView: null, noDelivery: true });
  });

  it("per-ad results count landing-page views (or Meta's omni count) as each ad's result", () => {
    const ads = decodeAdResults(recorded.ads.list, recorded.ads.insights, "website");
    expect(ads.map((ad) => [ad.adId, ad.results, ad.costPerResult])).toEqual([["120000000000101", 40, 7.5], ["120000000000102", 15, 7.5]]);
    expect(ads[0]).not.toHaveProperty("whatsappOpens");
  });
});

const base: VerdictInput = {
  destination: "website", status: "active", liveSince: "2026-11-02T10:00:00Z", impressions: 4210, results: 60, spend: 600,
  opens: null, waiting: 0, weakAd: null, comparison: null, now: NOW,
};
const v = (change: Partial<VerdictInput>) => verdict({ ...base, ...change });

describe("core: website verdict says visits (#2601)", () => {
  it("cost per visit, with no chat or enquiry wording", () => {
    expect(v({})).toMatchObject({ state: "measured", sentence: "Each visit costs ₹10.", number: { kind: "cost", value: 10 }, action: null });
    expect(v({ results: 3, spend: 30 })).toMatchObject({ state: "early", sentence: "3 visits so far. AdBrain will tell you if it's working after 5." });
    expect(v({ results: 1, spend: 30 }).sentence).toBe("1 visit so far. AdBrain will tell you if it's working after 5.");
    expect(v({ results: 0, spend: 20 })).toMatchObject({ state: "early", sentence: "No visits yet." });
  });

  it("no visits after real spend: no WhatsApp message to edit, no WhatsApp taps", () => {
    expect(v({ results: 0, spend: 400, opens: 50 })).toMatchObject({ state: "no_results", label: "No visits yet", sentence: "₹400 spent, no visits yet.", action: null });
  });

  it("an ended run is judged in visits", () => {
    expect(v({ status: "completed", results: 0, spend: 100 })).toMatchObject({ state: "ended_too_few", sentence: "It ended with 0 visits, too few to judge.", action: "new_ads" });
    expect(v({ status: "completed", comparison: { kind: "own", results: 40, typical: 5 } })).toMatchObject({ state: "ended_costly", sentence: "It didn't bring visits at a good price. Try new ads?" });
    expect(v({ status: "completed" })).toMatchObject({ state: "ended_measured", sentence: "It ended with 60 visits at ₹10 each." });
  });

  it("speaks Hindi for a Hindi owner", () => {
    const words = { locale: "hi", messages: hi.verdict };
    expect(verdict({ ...base, results: 0, spend: 400 }, words).sentence).toContain(hi.verdict.noVisits);
    expect(verdict({ ...base, results: 3, spend: 30 }, words).sentence).not.toMatch(/चैट|पूछताछ/);
  });

  it("WhatsApp and form verdicts are unchanged", () => {
    expect(v({ destination: "whatsapp", results: 0, spend: 400, opens: 12 })).toMatchObject({ label: "No chats yet", sentence: "₹400 spent, no chats yet. 12 taps on the WhatsApp button.", action: "edit_message" });
    expect(v({ destination: "instant_form", results: 0, spend: 400 })).toMatchObject({ label: "No enquiries yet", sentence: "₹400 spent, no enquiries yet.", action: null });
  });
});

describe("core: website card, ledger, evidence and rerun (#2601)", () => {
  const campaign = { id: "c2", status: "active", created_at: "2026-11-02T00:00:00Z", raw: {}, destination: "website", objective: "traffic" } as const;
  const result = { impressions: 4210, spend: 412.5, leads: 0, conversations: null, whatsapp_opens: null, landing_page_views: 55, destination: "website" } as const;

  it("the card's verdict counts stored landing-page views", () => {
    expect(cardVerdictInput(campaign as never, result as never, { now: NOW, waiting: 0, weakAd: null, comparison: null }))
      .toMatchObject({ destination: "website", results: 55, spend: 412.5, opens: null });
  });

  it("compares with the owner's last website campaign only", () => {
    const older = { ...campaign, id: "c1", created_at: "2026-10-01T00:00:00Z" };
    const chats = { ...campaign, id: "c0", created_at: "2026-10-20T00:00:00Z", destination: "whatsapp" };
    const results = { c2: result, c1: { ...result, spend: 100, landing_page_views: 20 }, c0: { ...result, destination: "whatsapp", conversations: 5, spend: 500 } };
    expect(lastCampaignComparison(campaign as never, [campaign, older, chats] as never, results as never)).toEqual({ kind: "own", results: 20, typical: 5 });
  });

  it("the ledger pools website runs by visits, apart from chats and leads", () => {
    const runs = ["b1", "b2", "b3", "b1", "b2"].map((businessId) => ({ businessId, destination: "website", status: "completed", spend: 100, landing_page_views: 20, conversations: 9, leads: 9 }));
    const pools = poolLedger([...runs, { businessId: "b4", destination: "website", status: "active", spend: 50, landing_page_views: 5 }]);
    expect(pools.website).toEqual({ results: 100, spendRupees: 500, runs: 5 });
    expect(pools.whatsapp).toBeNull();
    expect(pools.instant_form).toBeNull();
  });

  const ad = { headline: "Visit us", offerLine: null, angle: null, language: null, format: null, brief: "" };
  const evidence = (destination: EvidenceCampaign["destination"], spend: number, results: number): EvidenceCampaign =>
    ({ name: destination, destination, spend, results, impressions: 1000, days: 3, ads: [ad] });

  it("evidence says visits, and cheap visits never outrank chats or leads", () => {
    expect(resultSummary(evidence("website", 400, 55))).toBe("55 visits at ₹7.27 each");
    expect(toEvidenceCampaign({ name: "Site", creative_ids: ["a"] }, { spend: 400, impressions: 1000, leads: 0, landing_page_views: 55 }, "website",
      [{ id: "a", headline: "Visit us", brief: "", angle: null, generation: null }])).toMatchObject({ destination: "website", results: 55 });
    const picked = pickResultEvidence([evidence("website", 400, 55), evidence("whatsapp", 1000, 5), evidence("instant_form", 900, 3)]);
    expect(picked.map((item) => item.destination)).not.toContain("website");
    expect(pickResultEvidence([evidence("website", 400, 55)])).toMatchObject([{ destination: "website", role: "best" }]);
    expect(pastResultsBlock([{ ...evidence("website", 400, 55), role: "best" }])).toContain("\"destination\":\"website\"");
    expect(costPerResultFrom([evidence("website", 400, 50), evidence("whatsapp", 1000, 5)], "website")).toBe(8);
  });

  it("Run this again keeps a website campaign a website campaign", () => {
    const prefill = rerunPrefill({ campaign: { name: "Site", creative_ids: ["a"], daily_budget: 300, destination: "website" }, draft: null, approvedIds: ["a"], bestCreativeId: null });
    expect(prefill).toMatchObject({ destination: "website", source: "campaign" });
  });
});
