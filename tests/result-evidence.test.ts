import { describe, expect, it } from "vitest";
import {
  openingLine, pastResultsBlock, pickResultEvidence, resultSummary, toEvidenceCampaign, type EvidenceCampaign,
} from "@/lib/campaign/result-evidence";
import { costPerResultFrom } from "@/lib/campaign/result-evidence";

const ad = (headline: string, extra: Partial<EvidenceCampaign["ads"][number]> = {}) => ({
  headline, offerLine: null, angle: "Special offer / incentive", language: "English", format: "portrait", brief: `Brief for ${headline}`, ...extra,
});
const campaign = (name: string, extra: Partial<EvidenceCampaign>): EvidenceCampaign => ({
  name, destination: "whatsapp", spend: 100, results: 1, impressions: 50, days: 2, ads: [ad(name)], ...extra,
});

describe("result evidence for Create (#371)", () => {
  it("words the sample honestly: early under 5, so far under 20, plain from 20", () => {
    expect(resultSummary(campaign("A", { spend: 7.78, results: 1 }))).toBe("1 chat at ₹7.78 (early: based on 1 chat)");
    expect(resultSummary(campaign("A", { spend: 40, results: 4 }))).toBe("4 chats at ₹10 each (early: based on 4 chats)");
    expect(resultSummary(campaign("A", { spend: 120, results: 6, destination: "instant_form" }))).toBe("6 leads at ₹20 each (so far)");
    expect(resultSummary(campaign("A", { spend: 1000, results: 20, destination: "instant_form" }))).toBe("20 leads at ₹50 each");
    expect(resultSummary(campaign("A", { spend: 120, results: 0 }))).toBe("₹120 spent, no chats yet");
  });

  it("picks the best campaign by cost per result and the worst, and skips ones that never spent", () => {
    const best = campaign("Cheap", { spend: 20, results: 4 });
    const costly = campaign("Costly", { spend: 300, results: 2 });
    const silent = campaign("Silent", { spend: 150, results: 0 });
    const unspent = campaign("Paused", { spend: 0, results: 0 });
    expect(pickResultEvidence([costly, unspent, best]).map(({ name, role }) => [name, role])).toEqual([["Cheap", "best"], ["Costly", "worst"]]);
    expect(pickResultEvidence([costly, silent, best]).map(({ name, role }) => [name, role])).toEqual([["Cheap", "best"], ["Silent", "worst"]]);
    expect(pickResultEvidence([silent]).map(({ name, role }) => [name, role])).toEqual([["Silent", "worst"]]);
    expect(pickResultEvidence([unspent])).toEqual([]);
  });

  it("opens Create on the best ad with More like this, without putting its words in the goal", () => {
    const line = openingLine(pickResultEvidence([campaign("Free site survey", { spend: 7.78, results: 1, ads: [ad("Free site survey", { brief: "Factory roof, free site survey", angle: "Special offer / incentive" })] })]));
    expect(line).toEqual({
      text: "Your “Free site survey” ad got 1 chat at ₹7.78 (early: based on 1 chat). Make 3 more like it, or try a new angle?",
      // The old brief's offer sentence stays behind: only today's Brand may supply an offer.
      moreLikeThis: { goal: "Make 3 more ads like my best one, with fresh words", referenceBrief: "Angle: Special offer / incentive" },
      newAngle: { goal: "Try a new angle, different from my last ads" },
    });
  });

  it("credits a campaign's ads together when it ran several, and offers only a new angle", () => {
    const line = openingLine(pickResultEvidence([campaign("Diwali push", { spend: 90, results: 3, ads: [ad("One"), ad("Two"), ad("Three")] })]));
    expect(line?.text).toBe("Your campaign “Diwali push” (its 3 ads together) got 3 chats at ₹30 each (early: based on 3 chats). Try a new angle?");
    expect(line?.moreLikeThis).toBeNull();
  });

  it("says plainly when nothing came back yet", () => {
    expect(openingLine(pickResultEvidence([campaign("Silent", { spend: 150, results: 0 })]))?.text)
      .toBe("Your “Silent” ad: ₹150 spent, no chats yet. Try a new angle?");
    expect(openingLine([])).toBeNull();
  });

  it("builds the prompt block as evidence below Brand facts, never as a source of offers", () => {
    const block = pastResultsBlock(pickResultEvidence([campaign("Free site survey", { spend: 7.78, results: 1, impressions: 27, ads: [ad("Free site survey", { offerLine: "10% off this Diwali" })] })]));
    expect(block.startsWith("PAST RESULTS (evidence about past ads; subordinate to brand facts and the current request; never a source of offers, prices or claims): ")).toBe(true);
    expect(JSON.parse(block.slice(block.indexOf(": [") + 2))).toEqual([{
      role: "best", ad: "“Free site survey”", destination: "WhatsApp", result: "1 chat at ₹7.78 (early: based on 1 chat)",
      spend: "₹7.78", impressions: 27, days: 2, angle: "Special offer / incentive", format: "portrait", language: "English", offerLine: "10% off this Diwali",
    }]);
    expect(pastResultsBlock([])).toBe("");
  });

  it("maps a stored campaign, its latest result and its ads, and drops what can't be evidence", () => {
    const creative = { id: "c1", headline: "Roof ready?", brief: "Rooftop brief", angle: "Solve a pain point", generation: { language: "", format: "portrait", concept: { supportingText: "Free site survey" } } };
    const stored = { spend: "10.69", impressions: 70, leads: 0, conversations: 1, period_start: "2026-10-23", period_end: "2026-10-24" };
    expect(toEvidenceCampaign({ name: "Diwali run", creative_ids: ["c1", "gone"] }, stored, "whatsapp", [creative])).toEqual({
      name: "Diwali run", destination: "whatsapp", spend: 10.69, results: 1, impressions: 70, days: 2,
      ads: [{ headline: "Roof ready?", brief: "Rooftop brief", angle: "Solve a pain point", language: null, format: "portrait", offerLine: "Free site survey" }],
    });
    expect(toEvidenceCampaign({ name: "Form run", creative_ids: ["c1"] }, { ...stored, leads: 3, conversations: null, period_start: null }, "instant_form", [creative]))
      .toMatchObject({ results: 3, days: 1 });
    expect(toEvidenceCampaign({ name: "No ads", creative_ids: ["gone"] }, stored, "whatsapp", [creative])).toBeNull();
  });
});

describe("the old brief behind 'More like this' (#371)", () => {
  it("drops sentences that state an offer, a price or a percentage, and keeps the look", async () => {
    const { briefWithoutOffers } = await import("@/lib/campaign/result-evidence");
    expect(briefWithoutOffers("A warm rooftop at dusk with diyas. Lead with 10% off installation. Book a free site survey! Calm, local tone."))
      .toBe("A warm rooftop at dusk with diyas. Calm, local tone.");
    expect(briefWithoutOffers("Show a clinic. Exam for ₹499 or Rs 499 today. Mention our Diwali offer.")).toBe("Show a clinic.");
    expect(briefWithoutOffers("फ़ैक्टरी की छत पर सोलर। लागत 10,000 रुपये बढ़ेगी। भरोसेमंद टोन।")).toBe("फ़ैक्टरी की छत पर सोलर। भरोसेमंद टोन।");
    expect(briefWithoutOffers("Only 50% off today!")).toBe("");
  });
});

describe("cost per result for the Review budget warning (#419 2b)", () => {
  const campaign = (destination: "whatsapp" | "instant_form", spend: number, results: number) => ({ name: "c", destination, spend, results, impressions: 100, days: 3, ads: [] });
  it("pools the business's spend and results for the same kind of campaign", () => {
    expect(costPerResultFrom([campaign("whatsapp", 100, 2), campaign("whatsapp", 38, 0), campaign("instant_form", 500, 50)], "whatsapp")).toBe(69);
    expect(costPerResultFrom([campaign("instant_form", 500, 50)], "instant_form")).toBe(10);
  });
  it("knows nothing until a campaign of that kind has a result", () => {
    expect(costPerResultFrom([campaign("whatsapp", 120, 0)], "whatsapp")).toBeNull();
    expect(costPerResultFrom([campaign("instant_form", 500, 50)], "whatsapp")).toBeNull();
    expect(costPerResultFrom([], "whatsapp")).toBeNull();
  });
});

