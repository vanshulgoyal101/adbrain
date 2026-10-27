import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { quotedAsk, whatsappGreeting } from "@/lib/campaign/whatsapp-greeting";
import { batchAsk, buildConceptMessages, conceptImagePrompt, CONCEPT_VERSION, validateConcept, type CreativeConcept } from "@/lib/creative/concept";
import { citedProofs, proofFacts } from "@/lib/creative/proof-line";
import { personInScene, personSubjectLine } from "@/lib/creative/visual-rules";
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

const solarideReplies = (JSON.parse(readFileSync(join(FIXTURES, "solaride-regenerate.json"), "utf8")) as { replies: { content: string }[] })
  .replies.map((reply) => reply.content.replace(/^```json\s*|\s*```\s*$/g, ""));
const caseById = (id: string) => cases.cases.find((item) => item.id === id)!;
const solaride = caseById("solaride-factory-en");
const cedar = caseById("cedar-ridge-en");
type RecordedAd = { headline: string; primaryText: string };
const recordedRuns = baseline.cases as { id: string; ads: RecordedAd[] }[];
const recordedAds = (id: string) => recordedRuns.filter((item) => item.id === id).flatMap((item) => item.ads);
const factsOf = (item: typeof solaride) => [item.brand.description, ...item.brand.usps, ...item.brand.offers, ...item.sourceFacts];

describe("core: Create follows the long-running local ad rules (#418 rules 1, 4, 5, 7)", () => {
  const system = buildConceptMessages({ brand: solaride.brand as BrandContext, brief: solaride.brief, angle: AD_ANGLES[0] })[0].content as string;

  it("asks for what + where, a person, a proof and the prefill's words, under a new prompt version", () => {
    expect(CONCEPT_VERSION).toBe("creative-concept-v4");
    expect(system).toMatch(/first\s+line says what and where in at most 60 characters: the service and lead\.place/);
    expect(system).toMatch(/person giving or getting the service/);
    expect(system).toMatch(/one proof from the Brand facts/);
    expect(system).toMatch(/last line\s+tells people exactly what to send by quoting it word for word/);
    // The fold rule the validator enforces (hook-length) is unchanged, so no new repair.
    expect(system).toMatch(/never pass 125 characters/);
    expect(system).not.toMatch(/Do not default to stock people/);
  });

  it("rule 4: puts a person in every recorded picture that had none, and leaves the others alone", () => {
    expect(recordedDirections.length).toBeGreaterThan(40);
    const withPerson = recordedDirections.filter(personInScene);
    // Before: about one in five recorded concepts showed anyone.
    expect(withPerson.length / recordedDirections.length).toBeLessThan(0.3);
    for (const direction of recordedDirections) {
      expect(personSubjectLine(direction) !== null, direction.slice(0, 80)).toBe(!personInScene(direction));
    }
    expect(personSubjectLine("Rows of solar panels on a factory roof at dusk, with no people or vehicles."))
      .toMatch(/^Main subject \(this overrides any "no people" note above\): a person from the business doing the work/);
    // The owner's own background request ("just the panels, no people") goes through conceptImagePrompt and keeps its word.
    const input = { brand: cedar.brand as BrandContext, brief: cedar.brief, angle: AD_ANGLES[0] };
    expect(conceptImagePrompt({ visual: { medium: "photography", direction: "Just the panels at sunset, no people.", textPlacement: "bottom" } } as CreativeConcept, input))
      .not.toMatch(/Main subject/);
  });

  it("rule 1 + #713: each parallel angle leads with its own place and opening, and a repair is told what to avoid", () => {
    const leads = AD_ANGLES.slice(0, 3).map((angle) => JSON.parse(buildConceptMessages({ brand: solaride.brand as BrandContext, brief: solaride.brief, angle })[1].content as string).lead);
    expect(leads.map((lead) => lead.place)).toEqual(["Chandigarh", "Panchkula", "Mohali"]);
    expect(new Set(leads.map((lead) => lead.opening)).size).toBe(3);
    const pune = caseById("dental-clinic-en");
    expect(JSON.parse(buildConceptMessages({ brand: pune.brand as BrandContext, brief: pune.brief, angle: AD_ANGLES[2] })[1].content as string).lead)
      .toEqual({ place: "Pune", opening: "with the offer", ask: "Check-up and cleaning for ₹499" });
    // Recorded Oct 27 14:00Z (generation b285b76f): all three opened like this and two ads were lost after the repair.
    const sibling = { headline: "Lower bills, starting with a free survey", primary_text: "Rooftop solar for your home in Chandigarh, Mohali & Panchkula. Start with a free site survey to see what you could save." };
    const reply = { ...JSON.parse(solarideReplies[0]), primary_text: `${sibling.primary_text}\nBook your free site survey.` };
    const result = validateConcept(reply, { brand: solaride.brand as BrandContext, brief: solaride.brief, angle: AD_ANGLES[1], recentCopy: [sibling] });
    expect(result.success ? [] : result.issues.filter((issue) => issue.startsWith("repeated-opening"))).toEqual([
      'repeated-opening: a recent ad opens "Rooftop solar for your home in Chandigarh, Mohali"; start primary_text with different words',
    ]);
  });

  it("rule 5: the prompt asks for a Brand proof that proof-line.ts (#1029) recognises", () => {
    expect(system).toMatch(/A bare\s+"trusted" or "experienced" is not proof/);
    const cites = (item: typeof solaride) => recordedAds(item.id).map((ad) => citedProofs(`${ad.headline}\n${ad.primaryText}`, proofFacts(factsOf(item))).length > 0);
    // Before: Solaride's ads name IIT Bombay and PEC; Cedar Ridge's say "board-certified" but never its 15+ years.
    expect(cites(solaride).some(Boolean)).toBe(true);
    expect(cites(cedar)).toEqual([false, false, false]);
  });

  it("rule 7: every angle quotes the same ask, so the WhatsApp pre-typed message is those words (#1027)", () => {
    const asks = AD_ANGLES.slice(0, 3).map((angle) => JSON.parse(buildConceptMessages({ brand: solaride.brand as BrandContext, brief: solaride.brief, angle })[1].content as string).lead.ask);
    expect(asks).toEqual(["Free site survey", "Free site survey", "Free site survey"]);
    expect(batchAsk(["Diwali offer: 10% off rooftop solar installation", "PM Surya Ghar subsidy help"])).toBe("10% off rooftop solar installation");
    expect(batchAsk(["Check-up and cleaning for ₹499"])).toBe("Check-up and cleaning for ₹499");
    expect(batchAsk([])).toBeNull();
    const ads = ["Free solar site survey in Mohali.\nWhatsApp “Free site survey” to book.", "Factory solar in Chandigarh?\nWhatsApp “Free site survey” to book."];
    expect(whatsappGreeting(solaride.brand, ads, [], [], "ad", ads.map(quotedAsk)).autofill).toBe("Free site survey");
    // Recorded before: no ad on the paid baseline quotes an ask, so the prefill never matched an ad's words.
    expect(recordedRuns.flatMap((item) => item.ads).filter((ad) => quotedAsk(ad.primaryText)).length).toBe(0);
  });
});
