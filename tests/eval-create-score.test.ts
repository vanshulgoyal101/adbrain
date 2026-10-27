import { describe, expect, it } from "vitest";
import { compareSummaries, copyRules, inconclusive, offerInFold, personInScene, placeUpFront, summarize, textScript, type CaseResult } from "../scripts/lib/eval-create-score";

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

  // #418, CTO Oct 25: deterministic checks at $0 gate the next generation change.
  it("counts copy that passed even when its free image failed", () => {
    const summary = summarize([run("a", [ad(), ad()], { saved: 2, failures: [{ angle: "problem", stage: "image", rules: [] }] }),
      run("b", [ad()], { saved: 1, failures: [{ angle: "offer", stage: "concept", rules: ["unsupported-commercial-claim"] }, { angle: "value", stage: "image", rules: [] }] })]);
    expect(summary).toMatchObject({ conceptsSaved: 5, conceptsExpected: 6, adsSaved: 3 });
  });

  it("gates a $0 run on deterministic copy checks only: no judge, cost, latency or free-image noise", () => {
    const before = summarize([run("a"), run("b")]);
    const noisy = summarize([
      run("a", [ad({ judge: undefined, costUsd: 0 }), ad({ judge: undefined, costUsd: 0 })], { saved: 2, wallMs: 190_000, costUsd: 0,
        failures: [{ angle: "problem", stage: "image", rules: [] }] }),
      run("b", [ad({ judge: undefined, costUsd: 0 }), ad({ judge: undefined, costUsd: 0 }), ad({ judge: undefined, costUsd: 0 })], { wallMs: 100_000, costUsd: 0 }),
    ]);
    expect(compareSummaries(before, noisy, { deterministic: true })).toEqual({ verdict: "pass", regressions: [] });
    expect(compareSummaries(before, noisy).verdict).toBe("fail");
    const worse = summarize([
      run("a", [ad({ firstTry: false, offerInFold: false }), ad({ scriptOk: false })], { saved: 2, failures: [{ angle: "offer", stage: "concept", rules: ["offer-below-fold"] }] }),
      run("b"),
    ]);
    expect(compareSummaries(before, worse, { deterministic: true }).regressions).toEqual([
      "copy saved 100% → 83%", "first-try passes 100% → 80%", "offer in the first 125 characters 100% → 80%", "post text in the chosen script 100% → 80%",
    ]);
  });

  it("leaves free-tier provider failures out of copy saved, and calls a run with too many inconclusive", () => {
    const before = summarize([run("a"), run("b")]);
    const provider = { angle: "value", stage: "provider", rules: ["other"] };
    const oneLimited = summarize([run("a", [ad(), ad()], { saved: 2, failures: [provider] }), run("b")]);
    expect(oneLimited).toMatchObject({ conceptsSaved: 5, providerFailures: 1 });
    expect(compareSummaries(before, oneLimited, { deterministic: true })).toEqual({ verdict: "pass", regressions: [] });
    const limited = summarize([run("a", [ad()], { saved: 1, failures: [provider, provider] }), run("b", [ad()], { saved: 1, failures: [provider, provider] })]);
    expect(compareSummaries(before, limited, { deterministic: true }).regressions).toEqual([
      "inconclusive: 4 of 6 concepts hit free-tier provider limits; run again later",
    ]);
    // The same rule keeps an inconclusive run from becoming the baseline.
    expect(inconclusive(limited)).toBe("inconclusive: 4 of 6 concepts hit free-tier provider limits; run again later");
    expect(inconclusive(oneLimited)).toBeNull();
  });

  it("checks a Brand place is in the headline or first line (#418 rule 1)", () => {
    const places = ["Austin, Texas", "Round Rock"];
    expect(placeUpFront("Back pain in Round Rock?", "Book a $49 exam.", places)).toBe(true);
    expect(placeUpFront("Book a $49 exam", "Same-day visits in Austin.\nCall today.", places)).toBe(true);
    expect(placeUpFront("Book a $49 exam", "Same-day visits.\nThree clinics across Austin.", places)).toBe(false);
    expect(placeUpFront("छत पर सोलर", "चंडीगढ़ में मुफ़्त सर्वे", ["Chandigarh"])).toBeNull();
    expect(placeUpFront("Anything", "Anything", [])).toBeNull();
  });

  it("counts the copy of image-failed concepts and gates on the place rate only when both runs have it", () => {
    const failed = run("c", [ad({ placeUpFront: false })], { saved: 1, failures: [
      { angle: "proof", stage: "image", rules: [], copy: { headline: "h", primaryText: "p", supportingText: null, placeUpFront: true } },
    ] });
    const after = summarize([failed]);
    expect(after.placeUpFrontRate).toBe(0.5);
    const before = summarize([run("c", [ad({ placeUpFront: true })])]);
    expect(compareSummaries(before, after, { deterministic: true }).regressions).toContain("place in the headline or first line 100% → 50%");
    const old = { ...before, placeUpFrontRate: undefined };
    expect(compareSummaries(old, after, { deterministic: true }).regressions.join()).not.toMatch(/place/);
  });

  it("tells a picture with a person from an empty one (#418 rule 4)", () => {
    expect(personInScene("A technician fits panels on a flat roof while the homeowner watches.")).toBe(true);
    expect(personInScene("A chiropractor's hands hold a tablet showing a posture scan.")).toBe(true);
    expect(personInScene("Rows of solar panels on a factory roof at dusk, with no people or vehicles.")).toBe(false);
    expect(personInScene("An empty treatment room. No people.")).toBe(false);
    expect(personInScene("A bright family home with a rooftop array.")).toBe(false);
    expect(summarize([run("a", [ad({ personInScene: true }), ad({ personInScene: false })])]).personInSceneRate).toBe(0.5);
  });

  it("scores #418 rules 1, 5 and 7 per ad and rule 5 per batch", () => {
    const brand = { usps: ["Board-certified chiropractors with 15+ years combined experience"], offers: ["Free 15-minute spine check"] };
    expect(copyRules(brand, [], "Austin chiropractor", "Austin chiropractic, 15+ years.\nBook your free 15-minute spine check."))
      .toEqual({ firstLineShort: true, proof: true, askMatchesPrefill: true });
    expect(copyRules(brand, [], "Back pain?", `${"Long hook ".repeat(8)}\nCall us today.`))
      .toEqual({ firstLineShort: false, proof: false, askMatchesPrefill: false });
    expect(copyRules(brand, [], "दर्द?", "मुफ़्त जाँच बुक करें।").askMatchesPrefill).toBeNull();
    const summary = summarize([
      run("a", [ad({ proof: false, firstLineShort: true, askMatchesPrefill: true }), ad({ proof: true, firstLineShort: false, askMatchesPrefill: false })]),
      run("b", [ad({ proof: false }), ad({ proof: false })]),
      run("c", [ad({ proof: null })]),
    ]);
    expect(summary).toMatchObject({ proofBatchRate: 0.5, firstLineShortRate: 0.5, askMatchesPrefillRate: 0.5 });
  });
});
