import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { askMatchesPrefill, whatsappGreeting } from "@/lib/campaign/whatsapp-greeting";
import { buildConceptMessages, conceptImagePrompt, CONCEPT_VERSION, type CreativeConcept } from "@/lib/creative/concept";
import { carriesProof, proofKeys } from "@/lib/creative/proof";
import { personInScene } from "@/lib/creative/visual-rules";
import { AD_ANGLES, type BrandContext } from "@/lib/templates/ads";
import baseline from "../eval/baseline.json";
import cases from "../eval/cases.json";

// #418 rules 1, 4, 5 and 7 (Analyst, #941). Prompt lines plus $0 checks: none adds a validation repair,
// so Create's latency (#713) is unchanged. The recorded inputs are production Haiku concepts (fixtures)
// and the paid eval baseline's 17 ads (8e21d29).
const FIXTURES = join(__dirname, "fixtures/create");
const directions: string[] = [];
const collect = (value: unknown): void => {
  if (!value || typeof value !== "object") return;
  const node = value as Record<string, unknown>;
  if (typeof node.direction === "string" && typeof node.medium === "string") directions.push(node.direction);
  if (typeof node.content === "string" && node.content.includes('"direction"')) {
    try { collect(JSON.parse(node.content.replace(/^```json\s*|\s*```\s*$/g, ""))); } catch { /* not a concept reply */ }
  }
  for (const child of Object.values(node)) collect(child);
};
for (const file of readdirSync(FIXTURES)) collect(JSON.parse(readFileSync(join(FIXTURES, file), "utf8")));
const recordedDirections = [...new Set(directions)];

const caseById = (id: string) => cases.cases.find((item) => item.id === id)!;
const solaride = caseById("solaride-factory-en");
const cedar = caseById("cedar-ridge-en");
const recordedAds = (id: string) => baseline.cases.filter((item) => item.id === id).flatMap((item) => item.ads);
const factsOf = (item: typeof solaride) => [item.brand.description, ...item.brand.usps, ...item.brand.offers, ...item.sourceFacts];

describe("core: Create follows the long-running local ad rules (#418 rules 1, 4, 5, 7)", () => {
  const system = buildConceptMessages({ brand: solaride.brand as BrandContext, brief: solaride.brief, angle: AD_ANGLES[0] })[0].content as string;

  it("asks for what + where, a person, a proof and the prefill's words, under a new prompt version", () => {
    expect(CONCEPT_VERSION).toBe("creative-concept-v4");
    expect(system).toMatch(/first\s+line says what and where in at most 60 characters: the service and one place from the Brand's\s+locations/);
    expect(system).toMatch(/person giving or getting the service/);
    expect(system).toMatch(/one proof from the Brand facts/);
    expect(system).toMatch(/last\s+line asks for one offer in the Brand's own words/);
    // The fold rule the validator enforces (hook-length) is unchanged, so no new repair.
    expect(system).toMatch(/never pass 125 characters/);
    expect(system).not.toMatch(/Do not default to stock people/);
  });

  it("rule 4: puts a person in every recorded picture that had none, and leaves the others alone", () => {
    expect(recordedDirections.length).toBeGreaterThan(40);
    const withPerson = recordedDirections.filter(personInScene);
    // Before: about one in five recorded concepts showed anyone.
    expect(withPerson.length / recordedDirections.length).toBeLessThan(0.3);
    const input = { brand: cedar.brand as BrandContext, brief: cedar.brief, angle: AD_ANGLES[0] };
    const prompt = (direction: string) => conceptImagePrompt({ visual: { medium: "photography", direction, textPlacement: "bottom" } } as CreativeConcept, input);
    for (const direction of recordedDirections) {
      expect(prompt(direction).includes("Main subject"), direction.slice(0, 80)).toBe(!personInScene(direction));
    }
    expect(prompt("Rows of solar panels on a factory roof at dusk, with no people or vehicles.")).toMatch(/Main subject \(this overrides any "no people" note above\): a person from the business doing the work/);
  });

  it("rule 5: finds the Brand's proof and whether an ad repeats it", () => {
    expect(proofKeys("Board-certified chiropractors with 15+ years combined experience")).toEqual(["15 year", "board-certified"]);
    expect(proofKeys("Backed by qualified engineering graduates from IIT Bombay and PEC Chandigarh")).toEqual(["IIT", "PEC"]);
    for (const fact of ["Founder's 4,000 KM solo cycling journey for clean energy awareness", "Free 15-minute spine check", "Potential to cut electricity bills by up to 98%", "Assistance with PM Surya Ghar subsidy and net metering"]) {
      expect(proofKeys(fact), fact).toEqual([]);
    }
    expect(carriesProof("Our team has 15+ years of experience.", factsOf(cedar))).toBe(true);
    expect(carriesProof("Book a 15-minute spine check in Austin.", factsOf(cedar))).toBe(false);
    expect(carriesProof("25-year warranty on every panel", ["Every install has a 25 year warranty"])).toBe(true);
    expect(carriesProof("Same-day appointments", factsOf(caseById("dental-clinic-en")))).toBeNull();
    // Recorded: every Solaride and Cedar Ridge batch already carries one; the rule keeps it.
    for (const item of [solaride, cedar]) {
      expect(recordedAds(item.id).some((ad) => carriesProof(`${ad.headline}\n${ad.primaryText}`, factsOf(item)))).toBe(true);
    }
  });

  it("rule 7: the last line asks for the offer the WhatsApp prefill names", () => {
    const brand = solaride.brand;
    const ask = "Factory solar costs more after 31 December.\nBook your free site survey now.";
    expect(askMatchesPrefill(brand, "Factory solar in Mohali", ask)).toBe(true);
    expect(whatsappGreeting(brand, [ask]).autofill).toBe("Hi! I'd like a free site survey.");
    expect(askMatchesPrefill(brand, "Factory solar", "A free site survey first.\nCall us today.")).toBe(false);
    expect(askMatchesPrefill({ offers: [] }, "x", "y")).toBeNull();
    // Recorded before: most asks name no Brand offer ("Message us on WhatsApp to book your family's check-up").
    const latin = baseline.cases.filter((item) => !/-hi$/.test(item.id)).flatMap((item) => item.ads.map((ad) => askMatchesPrefill(caseById(item.id).brand, ad.headline, ad.primaryText)));
    expect(latin.filter(Boolean).length / latin.length).toBeLessThan(0.25);
  });
});
