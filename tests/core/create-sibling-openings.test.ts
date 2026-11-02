import { describe, expect, it } from "vitest";
import { buildConceptMessages, conceptLead, validateConcept } from "@/lib/creative/concept";
import { repairMessages } from "@/lib/creative/concept-repair";
import { AD_ANGLES, type BrandContext } from "@/lib/templates/ads";
import regenerate from "./fixtures/create/solaride-regenerate.json";
import cases from "../eval/cases.json";

// #1035/#713: on Oct 27 14:00Z (generation b285b76f) the three parallel Solaride concepts all opened
// "Rooftop solar for your home in Chandigarh, Mohali & Panchkula"; repeated-opening rejected two and their
// repairs, told only "write a different hook", repeated it, so the batch saved 1 of 3. Now each angle gets its
// own place and way in, and a repair is told the words to avoid. No new rule, so no new repair.
const solaride = regenerate.brand as BrandContext;
const sibling = { headline: "Lower bills, starting with a free survey", primary_text: "Rooftop solar for your home in Chandigarh, Mohali & Panchkula. Start with a free site survey to see what you could save." };
const reply = JSON.parse(regenerate.replies[0].content.replace(/^```json\s*|\s*```\s*$/g, ""));
const input = { brand: solaride, brief: regenerate.brief, angle: AD_ANGLES[1], instructions: regenerate.instructions, sourceFacts: regenerate.sourceFacts };

describe("core: parallel concepts open differently, and a repeat repair names what to avoid (#1035)", () => {
  it("gives each of the three angles its own Brand place and opening", () => {
    const leads = AD_ANGLES.slice(0, 3).map((angle) => JSON.parse(buildConceptMessages({ brand: solaride, brief: regenerate.brief, angle })[1].content as string).lead);
    expect(leads.map((lead) => lead.place)).toEqual(["Chandigarh", "Panchkula", "Mohali"]);
    expect(new Set(leads.map((lead) => lead.opening)).size).toBe(3);
    // The problem angle states the situation; a question about the reader's condition is refused by personal-attribute.
    expect(leads[1].opening).toMatch(/Never ask the reader about themselves/);
    // Instructions, not words for the ad: a bare "with the offer" was copied into the copy (free eval, Oct 28).
    for (const lead of leads) expect(lead.opening).toMatch(/^Open by /);
    const pune = cases.cases.find((item) => item.id === "dental-clinic-en")!;
    expect(conceptLead({ brand: pune.brand as BrandContext, angle: AD_ANGLES[2] })).toEqual({ place: "Pune", opening: "Open by stating the offer." });
    expect(conceptLead({ brand: { name: "No areas" }, angle: AD_ANGLES[0] }).place).toBeNull();
    expect(buildConceptMessages({ brand: solaride, brief: regenerate.brief, angle: AD_ANGLES[0] })[0].content).toMatch(/each must open differently/);
  });

  it("quotes the recorded sibling's opening and headline in the repair", () => {
    const repeat = { ...reply, headline: sibling.headline, primary_text: `${sibling.primary_text}\nBook your free site survey.` };
    const result = validateConcept(repeat, { ...input, recentCopy: [sibling] });
    expect(result.success ? [] : result.issues.filter((issue) => issue.startsWith("repeated-"))).toEqual([
      `repeated-headline: "${sibling.headline}" is a recent ad's headline; write a different one`,
      'repeated-opening: a recent ad opens "Rooftop solar for your home in Chandigarh, Mohali"; start primary_text with different words',
    ]);
  });

  // #2444: told only the sibling it hit, a targeted repair could write the other sibling's line, and in the parallel
  // schedule the siblings weren't in the first prompt. Each repeat rule is one issue that names every recent ad.
  it("names every recent headline and opening to avoid, once per rule, in the targeted repair", () => {
    const other = { headline: "Solar that pays you back", primary_text: "Your electricity bill keeps rising every summer.\nA rooftop system cuts it." };
    const recentCopy = [other, sibling, { ...sibling }];
    const repeat = { ...reply, headline: sibling.headline, primary_text: `${sibling.primary_text}\nBook your free site survey.` };
    const result = validateConcept(repeat, { ...input, recentCopy });
    const issues = result.success ? [] : result.issues.filter((issue) => issue.startsWith("repeated-"));
    expect(issues).toEqual([
      `repeated-headline: "${sibling.headline}" is a recent ad's headline; write a different one; also avoid "${other.headline}"`,
      'repeated-opening: a recent ad opens "Rooftop solar for your home in Chandigarh, Mohali"; start primary_text with different words; also avoid "Your electricity bill keeps rising every summer. A"',
    ]);
    const ask = repairMessages(repeat, result.success ? [] : result.issues);
    expect(ask.map((turn) => turn.role)).toEqual(["assistant", "user"]);
    expect(ask[1].content).toContain(`also avoid "${other.headline}"`);
    // Its rewrite to the other sibling's headline is still refused.
    const swapped = validateConcept({ ...repeat, headline: other.headline }, { ...input, recentCopy });
    expect(swapped.success ? [] : swapped.issues.filter((issue) => issue.startsWith("repeated-headline"))).toEqual([
      `repeated-headline: "${other.headline}" is a recent ad's headline; write a different one; also avoid "${sibling.headline}"`,
    ]);
  });

  it("changes no verdict on the recorded replies, and quotes a refused enum value", () => {
    for (const recorded of regenerate.replies.map((item) => JSON.parse(item.content.replace(/^```json\s*|\s*```\s*$/g, "")))) {
      const result = validateConcept(recorded, input);
      expect(result.success ? [] : result.issues.filter((issue) => issue.startsWith("repeated-")), recorded.headline).toEqual([]);
    }
    const right = validateConcept({ ...reply, visual: { ...reply.visual, textPlacement: "right" } }, input);
    expect(right.success ? [] : right.issues).toEqual(expect.arrayContaining([expect.stringMatching(/^schema:visual\.textPlacement:invalid_value: .*; it is "right"$/)]));
  });
});
