import { describe, expect, it } from "vitest";
import regenerate from "./fixtures/create/solaride-regenerate.json";
import hindi from "./fixtures/create/solaride-hindi.json";
import { batchProofWarning, citedProofs, proofFacts } from "@/lib/creative/proof-line";
import { runPreflight } from "@/lib/campaign/preflight";

// #418 rule 5: "one specific proof line from the Brand: years in business, jobs done, a named credential
// or a warranty; a bare 'trusted' doesn't count". Solaride's recorded Brand and its recorded Create
// output (solaride-regenerate.json, solaride-hindi.json: the ads' text, as Create returned it).
const brand = regenerate.brand as { usps: string[]; description: string };
const facts = [...brand.usps, brand.description];

function adTexts(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") { if (/^\s*[[{]/.test(value)) { try { adTexts(JSON.parse(value), out); } catch { /* plain text */ } } return out; }
  if (Array.isArray(value)) { value.forEach((item) => adTexts(item, out)); return out; }
  if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) {
    if ((key === "primary_text" || key === "primaryText") && typeof item === "string") out.push(item); else adTexts(item, out);
  }
  return out;
}
const recorded = [...new Set([...adTexts(regenerate), ...adTexts(hindi)])];

describe("core: a proof line from the Brand (#418 rule 5)", () => {
  it("finds Solaride's proof (its engineers' institutes), not its claims or offers", () => {
    expect(proofFacts(facts)).toEqual([{ fact: "Backed by qualified engineering graduates from IIT Bombay and PEC Chandigarh", keys: ["IIT Bombay", "PEC Chandigarh"] }]);
  });

  it("measures today's recorded Create output: 2 of 13 Solaride ads cite it (the before)", () => {
    const proofs = proofFacts(facts);
    expect(recorded).toHaveLength(13);
    expect(recorded.filter((text) => citedProofs(text, proofs).length)).toHaveLength(2);
  });

  it("warns when none of a batch cites the Brand's proof, naming the proof; one citing ad is enough", () => {
    const proofs = proofFacts(facts);
    const without = recorded.filter((text) => !citedProofs(text, proofs).length).slice(0, 3);
    const withOne = [...without.slice(0, 2), recorded.find((text) => citedProofs(text, proofs).length)!];
    expect(batchProofWarning(without, facts)).toBe("None of these ads has a proof line from your Brand. Add one, like “Backed by qualified engineering graduates from IIT Bombay and PEC Chandigarh”, so people trust the offer");
    expect(batchProofWarning(withOne, facts)).toBeNull();
    expect(batchProofWarning(without, ["Trusted by families", "Best service in town"])).toBeNull();
  });

  it("counts years, jobs done, credentials and warranties; a bare 'trusted' never", () => {
    const proofs = proofFacts(["12 years in business", "1,200+ rooftops installed", "Since 2014", "25-year panel warranty", "MNRE approved vendor", "Trusted by many"]);
    expect(proofs.map((proof) => proof.keys)).toEqual([["12"], ["1200"], ["2014"], ["25-year warranty"], ["MNRE"]]);
    expect(citedProofs("Over 1200 rooftops done in Mohali", proofs).map((proof) => proof.fact)).toEqual(["1,200+ rooftops installed"]);
    expect(citedProofs("Panels with a 25 year warranty", proofs).map((proof) => proof.fact)).toEqual(["25-year panel warranty"]);
    expect(citedProofs("A trusted team", proofs)).toEqual([]);
    expect(citedProofs("Call 9812345678", proofs)).toEqual([]);
  });

  // #2120: a Hindi owner's job counts (and English "kitchens") are proof; a word that only starts like one isn't.
  it("counts Hindi job counts and kitchens as proof", () => {
    const proofs = proofFacts(["'500' घरों में लगाया", "120 kitchens done", "200 छात्र", "50 किचन", "300+ ग्राहकों का भरोसा", "40 परिवारों के लिए"]);
    expect(proofs.map((proof) => proof.keys)).toEqual([["500"], ["120"], ["200"], ["50"], ["300"], ["40"]]);
    expect(proofFacts(["5 घरेलू उपकरण", "10 सिस्टमैटिक"])).toEqual([]);
    expect(citedProofs("मोहाली में 500 घरों पर सोलर", proofs).map((proof) => proof.fact)).toEqual(["'500' घरों में लगाया"]);
  });

  it("is a Review warning, never a blocker, and doesn't change the plan", () => {
    const base = {
      draft: { businessId: "b1", name: "Lever 2", goal: "Enquiries", mode: "manual" as const, destination: "whatsapp" as const, creativeIds: ["c1"], dailyBudgetRupees: 450, abTest: false,
        targeting: { location: { mode: "manual" as const, includedNames: ["Mohali"] }, age: { mode: "manual" as const, min: 25, max: 55 }, audience: { interestNames: ["Solar energy"], rationale: "Homeowners." } } } as never,
      draftId: "90d1d2bb-466c-4889-9af2-edb533e82531", draftVersion: 1, form: null,
      connection: { generation: 1, canCreatePaused: true, selected: { metaBusinessId: null, adAccountId: "act_9000000000000001", accountName: "Solaride 101", pageId: "900000000000002", pageName: "Solaride Energy", currency: "INR", timezoneName: "Asia/Kolkata" } },
      creatives: [{ id: "c1", businessId: "b1", approved: true, imageUrl: "https://example.com/ad.png", headline: "Free solar site survey", primaryText: recorded.find((text) => !citedProofs(text, proofFacts(facts)).length), storyReady: true }],
      whatsappNumber: "+919999994842",
      geo: { resolvedAreaLabel: "Mohali", unresolvedNames: [], explicitlyNationwide: false, audienceInterests: [{ id: "6003384248805", name: "Solar energy" }] },
      hash: () => "a".repeat(64),
    };
    const warned = runPreflight({ ...base, brandFacts: facts });
    expect(warned.planWarnings).toEqual([expect.stringMatching(/^None of these ads has a proof line/)]);
    expect(warned.blockers).toEqual([]);
    expect(warned.planHash).toBe(runPreflight(base).planHash);
    expect(runPreflight(base).planWarnings).toBeUndefined();
  });
});
