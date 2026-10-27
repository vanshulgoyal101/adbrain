import { describe, expect, it } from "vitest";
import { validateConcept } from "@/lib/creative/concept";
import { AD_ANGLES, type BrandContext } from "@/lib/templates/ads";
import regenerate from "./fixtures/create/solaride-regenerate.json";
import run4 from "./fixtures/create/cedar-ridge-run4.json";

// #418 rule 3 (Analyst, #941): the owner said costs rise "10,000 rupees per kilowatt". Every recorded Haiku reply
// keeps the rate ("₹10,000/kW", "10,000 rupees per kW"), so the check costs no repair; dropping it, which would
// turn a per-kW rise into a flat price, is refused.
const parse = (content: string) => JSON.parse(content.replace(/^```json\s*|\s*```\s*$/g, ""));
const input = {
  brand: regenerate.brand as BrandContext, brief: regenerate.brief,
  angle: AD_ANGLES.find((angle) => angle.name === regenerate.angle) ?? AD_ANGLES[0],
  instructions: regenerate.instructions, sourceFacts: regenerate.sourceFacts,
};
const priceUnit = (value: unknown, extra: Partial<typeof input> = {}) => {
  const result = validateConcept(value, { ...input, ...extra });
  return result.success ? [] : result.issues.filter((issue) => issue.startsWith("price-unit:"));
};
const replies = regenerate.replies.map((reply) => parse(reply.content));

describe("core: a rate keeps its unit (#418 rule 3)", () => {
  it("passes every recorded Solaride reply that states the per-kW rise", () => {
    const stating = replies.filter((reply) => /10,000/.test(JSON.stringify(reply)));
    expect(stating.length).toBeGreaterThan(3);
    for (const reply of stating) expect(priceUnit(reply), reply.headline).toEqual([]);
  });

  it("refuses the rise once its unit is dropped", () => {
    const reply = replies.find((item) => /₹10,000\/kW|Rs 10,000\/kW/.test(item.headline ?? ""))
      ?? replies.find((item) => /10,000/.test(item.primary_text))!;
    const flat = JSON.parse(JSON.stringify(reply).replace(/(₹|Rs |)10,000(?:\s?rupees)?(?:\/kW| per kW| per kilowatt)/g, "₹10,000"));
    expect(priceUnit(flat)).toEqual([expect.stringMatching(/^price-unit: "₹10,000" is per kW/)]);
  });

  it("accepts kilowatt, kW and प्रति किलोवाट as the same unit, and refuses a different one", () => {
    const reply = replies.find((item) => /10,000/.test(item.primary_text))!;
    const withLine = (line: string) => ({ ...reply, primary_text: `${line}\n${reply.primary_text.replace(/[^\n]*10,000[^\n]*\n?/g, "")}`.trim() });
    expect(priceUnit(withLine("Costs rise over ₹10,000 per kilowatt after 31 December."))).toEqual([]);
    expect(priceUnit(withLine("31 दिसंबर के बाद लागत ₹10,000 प्रति किलोवाट से ज़्यादा बढ़ेगी।"))).toEqual([]);
    expect(priceUnit(withLine("Costs rise over ₹10,000 per panel after 31 December."))).toHaveLength(1);
  });

  it("leaves a flat Brand price alone however the ad words it", () => {
    for (const angle of run4.angles) {
      const result = validateConcept(angle.concept, { brand: run4.brand as BrandContext, brief: run4.brief, angle: AD_ANGLES.find((item) => item.name === angle.angleName)! });
      expect(result.success ? [] : result.issues.filter((issue) => issue.startsWith("price-unit:"))).toEqual([]);
    }
  });
});
