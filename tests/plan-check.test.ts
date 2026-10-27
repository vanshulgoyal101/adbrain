import { describe, expect, it } from "vitest";
import launch from "./core/fixtures/meta/launch-validate.json";
import { activationWarnings, planCheckEvent, checkPlan, reviewWarnings, REVIEW_WARNINGS } from "@/lib/campaign/plan-check";

// #419: the plan check runs on the exact payloads Meta accepted for today's launch code.
type Exchange = { destination: string; kind: string; form: Record<string, string> };
const tape = launch.tape as unknown as Exchange[];
const planFor = (destination: string, costPerResultRupees?: number) => ({
  adSets: tape.filter((e) => e.destination === destination && e.kind === "adsets").map((e) => e.form),
  creatives: tape.filter((e) => e.destination === destination && e.kind === "adcreatives").map((e) => e.form),
  costPerResultRupees,
});
const status = (findings: ReturnType<typeof checkPlan>, rule: string) => findings.find((f) => f.rule === rule)!;

describe("plan check (#419)", () => {
  it("today's WhatsApp launch: Advantage+ audience and placements on, one ad set, feed image; no 9:16 yet", () => {
    const findings = checkPlan(planFor("whatsapp"));
    expect(Object.fromEntries(findings.map((f) => [f.rule, f.status]))).toEqual({
      "Advantage+ audience": "pass",
      "Advantage+ placements": "pass",
      "One ad set": "pass",
      "Budget vs learning phase": "unknown",
      "4:5 feed image": "pass",
      "9:16 Stories/Reels image": "warn",
    });
    expect(status(findings, "Budget vs learning phase").detail).toBe("No cost per result yet. At ₹280 a day, learning needs a cost per result under ₹39.20.");
  });

  it("says when the budget can't reach the learning threshold, and what would", () => {
    const low = status(checkPlan(planFor("whatsapp", 69)), "Budget vs learning phase");
    expect(low).toEqual({ rule: "Budget vs learning phase", status: "warn", detail: 'About 28 results a week at ₹280 a day and ₹69 each (Meta\'s learning phase needs about 50). It needs about ₹493 a day, or it may stay "learning limited".' });
    expect(status(checkPlan(planFor("whatsapp", 30)), "Budget vs learning phase").status).toBe("pass");
  });

  it("fails Advantage+ audience off, and flags pinned placements and split budgets", () => {
    const off = planFor("instant_form");
    const targeting = JSON.parse(off.adSets[0].targeting);
    const adSet = { ...off.adSets[0], targeting: JSON.stringify({ ...targeting, targeting_automation: { advantage_audience: 0 }, publisher_platforms: ["facebook"] }) };
    const findings = checkPlan({ ...off, adSets: [adSet, adSet] });
    expect(status(findings, "Advantage+ audience").status).toBe("fail");
    expect(status(findings, "Advantage+ placements").detail).toContain("publisher_platforms");
    expect(status(findings, "One ad set").status).toBe("warn");
  });

  it("recognises a 9:16 placement creative", () => {
    const creative = { asset_feed_spec: JSON.stringify({ asset_customization_rules: [{ customization_spec: { instagram_positions: ["story", "reels"] } }] }) };
    expect(status(checkPlan({ ...planFor("whatsapp"), creatives: [creative] }), "9:16 Stories/Reels image").status).toBe("pass");
  });

  it("turns findings into a launch event: non-passing rules by name, nothing else (#419 2a)", () => {
    const event = planCheckEvent([
      { rule: "Advantage+ audience", status: "pass", detail: "On" },
      { rule: "Budget vs learning phase", status: "unknown", detail: "No cost yet" },
      { rule: "9:16 Stories/Reels image", status: "warn", detail: "None" },
      { rule: "4:5 feed image", status: "fail", detail: "None" },
    ], "whatsapp");
    expect(event).toEqual({ outcome: "partial", attributes: { destination: "whatsapp", count: 4, failedCount: 1,
      validationRules: ["budget-vs-learning-phase:unknown", "9-16-stories-reels-image:warn", "4-5-feed-image:fail"] } });
    expect(planCheckEvent([{ rule: "One ad set", status: "pass", detail: "" }], "instant_form"))
      .toEqual({ outcome: "success", attributes: { destination: "instant_form", count: 1, failedCount: 0, validationRules: [] } });
  });

  // #419 item 2(b), CTO Oct 25: plain, non-blocking warnings on Review.
  it("warns on Review when no ad will get a 9:16, and when the budget can't reach Meta's learning threshold", () => {
    expect(REVIEW_WARNINGS).toEqual({
      story: "No 9:16 ad: Reels and Stories placements will crop or skip it",
      budget: "Budget is below what Meta needs to learn (about 50 results a week); results may be slow",
    });
    // ₹280 a day at ₹69 a chat is about 28 chats a week (#157).
    expect(reviewWarnings({ destination: "whatsapp", storyReady: false, perAdSetDailyBudgetRupees: 280, costPerResultRupees: 69 }))
      .toEqual([REVIEW_WARNINGS.story, REVIEW_WARNINGS.budget]);
    expect(reviewWarnings({ destination: "whatsapp", storyReady: true, perAdSetDailyBudgetRupees: 500, costPerResultRupees: 69 })).toEqual([]);
    // #680: lead-form ads get the 9:16 too.
    expect(reviewWarnings({ destination: "instant_form", storyReady: true, perAdSetDailyBudgetRupees: 500, costPerResultRupees: null })).toEqual([]);
    expect(reviewWarnings({ destination: "instant_form", storyReady: false, perAdSetDailyBudgetRupees: 500, costPerResultRupees: null })).toEqual([REVIEW_WARNINGS.story]);
  });

  it("says nothing about the budget without the business's own cost per result", () => {
    for (const cost of [null, undefined, 0]) {
      expect(reviewWarnings({ destination: "whatsapp", storyReady: true, perAdSetDailyBudgetRupees: 50, costPerResultRupees: cost })).toEqual([]);
    }
  });

  // #419 item 2: the edits AdBrain makes that restart Meta's learning, warned on the activation review.
  describe("activation warnings", () => {
    const now = Date.parse("2026-10-25T12:00:00Z");
    const daysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString();

    it("warns that a capped run is a new ad set and, with the business's cost, whether its days can finish learning", () => {
      // ₹280 a day for 3 days at ₹69 a chat buys about 12 chats, far under Meta's ~50 (#157).
      expect(activationWarnings({ capDays: 3, dailyBudgetRupees: 280, costPerResultRupees: 69, pausedAt: null, now })).toEqual([
        "A capped run is a new ad set, so Meta's learning starts from zero: 3 days at about ₹69 a result buys about 12 results, under the ~50 it needs, so it will likely end while still learning",
      ]);
      // ₹200 for 1 day at ₹150 a lead: "1 result", not "1 results".
      expect(activationWarnings({ capDays: 1, dailyBudgetRupees: 200, costPerResultRupees: 150, pausedAt: null, now })).toEqual([
        "A capped run is a new ad set, so Meta's learning starts from zero: 1 day at about ₹150 a result buys about 1 result, under the ~50 it needs, so it will likely end while still learning",
      ]);
      // ₹500 a day for 7 days at ₹69 is about 50: enough to finish learning, so no note.
      expect(activationWarnings({ capDays: 7, dailyBudgetRupees: 500, costPerResultRupees: 69, pausedAt: null, now })).toEqual([]);
      for (const cost of [null, undefined, 0]) {
        expect(activationWarnings({ capDays: 2, dailyBudgetRupees: 280, costPerResultRupees: cost, pausedAt: null, now })).toEqual([
          "A capped run is a new ad set, so Meta's learning starts from zero; results may be slow at first",
        ]);
      }
    });

    it("warns when resuming a campaign AdBrain paused 7 or more days ago, and only then", () => {
      expect(activationWarnings({ capDays: null, dailyBudgetRupees: 280, costPerResultRupees: 69, pausedAt: daysAgo(8.5), now })).toEqual([
        "Paused for 8 days: Meta restarts learning when a campaign resumes after 7 days or more; results may be slow at first",
      ]);
      expect(activationWarnings({ capDays: null, dailyBudgetRupees: 280, costPerResultRupees: 69, pausedAt: daysAgo(7), now })).toHaveLength(1);
      for (const pausedAt of [daysAgo(6.9), null, undefined, "not a date"]) {
        expect(activationWarnings({ capDays: null, dailyBudgetRupees: 280, costPerResultRupees: 69, pausedAt, now })).toEqual([]);
      }
    });

    it("gives a capped run after a long pause one note, not two: the new ad set learns from zero either way", () => {
      expect(activationWarnings({ capDays: 3, dailyBudgetRupees: 280, costPerResultRupees: null, pausedAt: daysAgo(30), now })).toEqual([
        "A capped run is a new ad set, so Meta's learning starts from zero; results may be slow at first",
      ]);
    });
  });
});
