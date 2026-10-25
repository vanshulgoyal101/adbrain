import { describe, expect, it } from "vitest";
import launch from "./core/fixtures/meta/launch-validate.json";
import { planCheckEvent, checkPlan } from "@/lib/campaign/plan-check";

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
});
