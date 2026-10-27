import { describe, expect, it } from "vitest";
import { validateConcept } from "@/lib/creative/concept";
import { AD_ANGLES, type BrandContext } from "@/lib/templates/ads";
import run4 from "./fixtures/create/cedar-ridge-run4.json";
import haiku from "./fixtures/create/cedar-ridge-haiku.json";

// #713: at CREATIVE_REASONING_EFFORT=low (recorded Oct 26), 2 of 9 Haiku takes needed a second concept call
// (~10 s). One of them was formatting, not a claim: a 155-character first line that two sentences make up,
// and an extra quote stitched from two facts next to the verbatim ones. Neither should cost a repair.
const take = haiku.byEffort.low.replies.find((reply) => reply.rulesAtRecording.join() === "sourceQuotes,hook-length")!;
const recorded = JSON.parse(take.content.replace(/^```json\s*|\s*```\s*$/g, ""));
const input = { brand: run4.brand as BrandContext, brief: run4.brief, angle: AD_ANGLES.find((angle) => angle.name === take.angleName)! };
const issues = (value: unknown) => { const result = validateConcept(value, input); return result.success ? [] : result.issues; };

describe("core: Create saves a recorded low-effort take first try (#713)", () => {
  it("breaks an over-long hook at its sentence end and drops the stitched quote", () => {
    const result = validateConcept(recorded, input);
    expect(result.success ? [] : result.issues).toEqual([]);
    if (!result.success) return;
    const [hook, next] = result.concept.primary_text.split("\n");
    expect(hook).toBe("Spinal stiffness from long desk days or training can make everyday tasks harder.");
    expect(next).toMatch(/^Our \$49 new-patient exam and consultation/);
    // Same characters, so the offer keeps its place above the fold.
    expect(result.concept.primary_text.length).toBe(recorded.primary_text.length);
    expect(result.concept.sourceQuotes).toEqual(["$49 new-patient exam and consultation", "Same-day appointments for new patients"]);
  });

  it("still refuses when no quote is the owner's own words", () => {
    expect(issues({ ...recorded, sourceQuotes: ["Same-day appointments for new patients in Austin, Round Rock and Cedar Park"] }))
      .toEqual(expect.arrayContaining([expect.stringMatching(/^sourceQuotes:/)]));
  });

  it("still refuses a claim that only the dropped quote backed", () => {
    const free = { ...recorded, primary_text: "Free posture review with every visit.\n" + recorded.primary_text, sourceQuotes: [...recorded.sourceQuotes, "Free posture review with every visit"] };
    expect(issues(free)).toEqual(expect.arrayContaining([expect.stringMatching(/^unsupported-commercial-claim: free/i)]));
  });

  it("still refuses a single sentence too long for the fold", () => {
    const long = "Spinal stiffness from long desk days, weekend training and carrying little ones around can make everyday tasks feel harder than they should";
    expect(issues({ ...recorded, primary_text: `${long}\n${recorded.primary_text}` })).toEqual(expect.arrayContaining([expect.stringMatching(/^hook-length:/)]));
  });
});
