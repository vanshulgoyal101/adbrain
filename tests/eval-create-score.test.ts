import { describe, expect, it } from "vitest";
import { compareSummaries, offerInFold, summarize, textScript, type CaseResult } from "../scripts/lib/eval-create-score";

const ad = (overrides: Partial<CaseResult["ads"][number]> = {}): CaseResult["ads"][number] => ({
  angle: "offer", headline: "Book your $49 exam", primaryText: "New-patient exam for $49.\nBook today.", cta: "BOOK_NOW",
  textModels: ["anthropic/claude-haiku-5.5"], attempts: 1, firstTry: true, rejectedRules: [], offerInFold: true, scriptOk: true,
  judge: { copy: 4, image: 4, inventedClaims: [], imageTextErrors: [] }, costUsd: 0.03, ...overrides,
});
const run = (id: string, ads = [ad(), ad(), ad()], overrides: Partial<CaseResult> = {}): CaseResult => ({
  id, language: "en", saved: ads.length, expected: 3, failures: [], ads, costUsd: 0.09, wallMs: 40_000, ...overrides,
});

describe("Create eval scoring (#418)", () => {
  it("checks the offer is in the first 125 characters Meta shows", () => {
    expect(offerInFold("Exam for $49. Book now.", ["$49"])).toBe(true);
    expect(offerInFold(`${"x".repeat(130)} $49`, ["$49"])).toBe(false);
    expect(offerInFold("Book a FREE DEMO class", ["demo"])).toBe(true);
    expect(offerInFold("Anything", [])).toBeNull();
  });

  it("tells Devanagari post text from Latin, ignoring numbers and symbols", () => {
    expect(textScript("31 दिसंबर से पहले सोलर लगवाएं, ₹10,000/kW बचाएं")).toBe("devanagari");
    expect(textScript("Factory owners, 31 December se pehle install karwa lo")).toBe("latin");
    expect(textScript("₹499 · 10%")).toBe("none");
  });

  it("summarizes full batches, first-try passes, judge scores, cost and latency", () => {
    const summary = summarize([
      run("a"),
      run("b", [ad({ firstTry: false, attempts: 2, rejectedRules: ["offer-below-fold"], judge: { copy: 2, image: 3, inventedClaims: ["24/7"], imageTextErrors: [] } }), ad()], {
        saved: 2, failures: [{ angle: "proof", stage: "concept", rules: ["unsupported-commercial-claim"] }], costUsd: 0.07, wallMs: 80_000,
      }),
    ]);
    expect(summary).toMatchObject({
      runs: 2, fullBatchRate: 0.5, adsSaved: 5, adsExpected: 6, firstTryRate: 0.8, offerInFoldRate: 1, scriptRate: 1,
      judgeCopy: 3.6, judgeImage: 3.8, inventedClaimRate: 0.2, imageTextErrorRate: 0, costPerRunUsd: 0.08, spentUsd: 0.16,
      wallMsP50: 40_000, wallMsP90: 80_000,
      rejectedRules: { "offer-below-fold": 1, "unsupported-commercial-claim": 1 },
    });
  });

  it("passes a change that matches the baseline within judge noise", () => {
    const before = summarize([run("a"), run("b")]);
    const after = summarize([run("a", [ad({ judge: { copy: 3.8, image: 4, inventedClaims: [], imageTextErrors: [] } }), ad(), ad()]), run("b")]);
    expect(compareSummaries(before, after)).toEqual({ verdict: "pass", regressions: [] });
  });

  it("fails a change that saves fewer full batches, invents claims or blows the cost cap", () => {
    const before = summarize([run("a"), run("b")]);
    const after = summarize([
      run("a", [ad({ judge: { copy: 4, image: 4, inventedClaims: ["free installation"], imageTextErrors: [] } }), ad()], { saved: 2, costUsd: 0.4 }),
      run("b", undefined, { costUsd: 0.4 }),
    ]);
    const result = compareSummaries(before, after, { inrPerUsd: 85, maxInrPerRun: 25 });
    expect(result.verdict).toBe("fail");
    expect(result.regressions.join("\n")).toMatch(/full batches 100% → 50%/);
    expect(result.regressions.join("\n")).toMatch(/invented claims 0% → 20%/);
    expect(result.regressions.join("\n")).toMatch(/cost ₹34 per run is above the ₹25 cap/);
  });

  it("fails a slower Create whose p90 passes the 60 s budget", () => {
    const before = summarize([run("a"), run("b")]);
    const after = summarize([run("a", undefined, { wallMs: 70_000 }), run("b", undefined, { wallMs: 75_000 })]);
    expect(compareSummaries(before, after).regressions).toEqual(["Create p90 75 s is over the 60 s budget (was 40 s)"]);
  });
});
