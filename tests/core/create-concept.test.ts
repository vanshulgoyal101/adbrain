import { describe, expect, it } from "vitest";
import { clipToThought, conceptValidationRules, validateConcept, type ConceptInput } from "@/lib/creative/concept";
import { AD_ANGLES } from "@/lib/templates/ads";
import recorded from "./fixtures/create/cedar-ridge-concept.json";
import groq from "./fixtures/create/cedar-ridge-groq-drafts.json";
import groqFields from "./fixtures/create/cedar-ridge-groq-fields.json";

// A real saved qwen concept for the seeded Cedar Ridge demo clinic, validated with
// the Brand facts and source facts it was generated from.
const input: ConceptInput = {
  brand: recorded.brand,
  brief: "Invite adults near Austin to enquire about a new-patient visit.",
  angle: AD_ANGLES[0],
  sourceFacts: recorded.sourceFacts,
};
const rules = (value: unknown) => {
  const result = validateConcept(value, input);
  return result.success ? [] : conceptValidationRules(result.issues);
};

describe("core: Create concept validation on a recorded production concept", () => {
  it("saves the recorded concept, including a rationale that runs past the prompt's 600", () => {
    expect(rules(recorded.concept)).toEqual([]);
    const { rationale } = recorded.concept;
    const overrun = { ...recorded.concept, rationale: `${rationale} ${rationale.slice(0, 200)}` };
    expect(overrun.rationale.length).toBeGreaterThan(600);
    expect(rules(overrun)).toEqual([]);
  });

  // #1613 (QA): a Hindi paragraph ends its sentences with '।'; it is rewrapped like English instead of failing hook-length.
  it("rewraps a long Hindi primary-text paragraph at '।' without changing a word", () => {
    const hindi = "दिन भर डेस्क पर बैठने से गर्दन और पीठ अकड़ जाती है। हमारा ऑस्टिन क्लिनिक नए मरीज़ों को उसी दिन देखता है, शाम और सप्ताहांत में भी। आज ही अपनी पहली मुलाक़ात बुक करें।";
    expect(hindi.length).toBeGreaterThan(125);
    const result = validateConcept({ ...recorded.concept, primary_text: hindi }, input);
    const issues = result.success ? [] : conceptValidationRules(result.issues);
    expect(issues).not.toContain("hook-length");
    if (result.success) {
      const lines = result.concept.primary_text.split("\n");
      expect(lines.length).toBeGreaterThan(1);
      expect(lines.every((line) => line.length <= 125)).toBe(true);
      expect(lines.join(" ")).toBe(hindi);
    }
  });

  it("clips an over-long link description instead of discarding the concept", () => {
    const long = `${recorded.concept.description} with flexible evening and weekend appointments for busy adults`;
    expect(long.length).toBeGreaterThan(100);
    const result = validateConcept({ ...recorded.concept, description: long }, input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.concept.description.length).toBeLessThanOrEqual(100);
      expect(long.startsWith(result.concept.description)).toBe(true);
    }
  });

  // #1544 (QA, production a93f972f, free path): the stored description was 'Modular kitchens for Mohali Phase 8B,
  // Mohali, Kharar and New Chandigarh. Ask for a quote on' (91), word-clipped from the model's >100. The part past
  // 100 characters wasn't stored, so the tail here is filled in; the clip point is the recorded one.
  it("cuts an over-long description back to a complete thought, never mid-sentence", () => {
    const nook = "Modular kitchens for Mohali Phase 8B, Mohali, Kharar and New Chandigarh. Ask for a quote on your new kitchen today.";
    expect(nook.slice(0, 100)).toContain("Ask for a quote on");
    expect(clipToThought(nook, 100)).toBe("Modular kitchens for Mohali Phase 8B, Mohali, Kharar and New Chandigarh.");
    // No sentence end: the last clause, when it keeps at least half.
    const clause = "Same-day new-patient slots in Austin with insurance and transparent cash pricing; evening and weekend visits too";
    expect(clipToThought(clause, 100)).toBe("Same-day new-patient slots in Austin with insurance and transparent cash pricing");
    // 'Rs.' isn't a sentence end; with no other safe cut the text stays long for the repair.
    const rupees = "Modular kitchens from Rs. 2 lakh in Mohali with free 3D design and installation in 21 days for every home";
    expect(clipToThought(rupees, 100)).toBe(rupees);
    expect(rules({ ...recorded.concept, description: rupees })).toEqual(["schema:description:too_big"]);
    const saved = validateConcept({ ...recorded.concept, description: `${recorded.concept.description} Ask for a quote on your first visit and more.` }, input);
    expect(saved.success && saved.concept.description).toBe(recorded.concept.description);
  });

  it("still rejects uncited or invented claims and over-length ad copy", () => {
    // #281: a price stated without its quote is cited with the one Brand fact that has it; a made-up price still fails.
    const uncited = { ...recorded.concept, sourceQuotes: recorded.concept.sourceQuotes.filter((quote) => !quote.includes("$49")) };
    const cited = validateConcept(uncited, input);
    expect(cited.success && cited.concept.sourceQuotes).toContain("$49 new-patient exam and consultation");
    expect(rules(JSON.parse(JSON.stringify(uncited).replaceAll("$49", "$59")))).toContain("unsupported-commercial-claim");
    expect(rules({ ...recorded.concept, sourceQuotes: ["Voted best clinic in Austin"] })).toContain("sourceQuotes");
    expect(rules({ ...recorded.concept, headline: `${recorded.concept.headline} Book today` })).toEqual(["schema:headline:too_big"]);
  });

  it("normalizes cosmetic field slips once and keeps fields it cannot repair failing", () => {
    const result = validateConcept({
      ...recorded.concept,
      cta: "BOOK_NOW",
      supportingText: "x".repeat(65),
      visual: { ...recorded.concept.visual, direction: "d".repeat(2500), textPlacement: " Top " },
      sourceQuotes: [...recorded.concept.sourceQuotes, "  "],
    }, input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.concept.cta).toBe("Book Now");
      expect(result.concept.supportingText).toBeNull();
      expect(result.concept.visual).toMatchObject({ textPlacement: "top" });
      expect(result.concept.visual.direction).toHaveLength(2400);
      expect(result.concept.sourceQuotes).toEqual(recorded.concept.sourceQuotes);
    }
    expect(rules({ ...recorded.concept, cta: "Shop Now" })).toEqual(["schema:cta:invalid_value"]);
    expect(rules({ ...recorded.concept, visual: { ...recorded.concept.visual, textPlacement: "right" } }))
      .toEqual(["schema:visual.textPlacement:invalid_value"]);
  });
});

// Real Groq drafts for the run 5/6 input that were rejected for "heal" inside "health"
// or for a cited price followed by punctuation ("For $49, get...").
describe("core: Create claim checks on recorded Groq drafts", () => {
  // #738: recorded drafts that ask about or name the reader's condition now also break
  // personal-attribute (Meta's Personal Attributes policy); the rest keep their recorded rules.
  const ASKS_ABOUT_CONDITION = [
    "Ready to address back pain or posture strain?", "Tired of desk-job stiffness?", "Tired of fighting desk-day stiffness?",
    "If your back aches after a long day at a desk or weekend game", "See what’s causing your pain",
  ];
  const asks = (concept: { headline: string; primary_text: string; description?: string | null }) =>
    ASKS_ABOUT_CONDITION.some((phrase) => [concept.headline, concept.primary_text, concept.description].join("\n").includes(phrase));
  const expectedRules = (draft: { rules: string[]; concept: { headline: string; primary_text: string; description?: string | null } }) =>
    [...draft.rules, ...(asks(draft.concept) ? ["personal-attribute"] : [])].sort();
  const draftRules = (angleId: string, concept: unknown) => {
    const angle = AD_ANGLES.find((candidate) => candidate.id === angleId)!;
    const result = validateConcept(concept, { brand: recorded.brand, brief: groq.brief, angle, recentCopy: [], sourceFacts: [] });
    // These drafts pin claim rules; offer placement (#194) and the empty-scene check (#760) are asserted on their own.
    return (result.success ? [] : conceptValidationRules(result.issues).filter((rule) => rule !== "offer-below-fold" && rule !== "no-subject")).sort();
  };

  it("flags only the recorded drafts whose $49 offer starts after Meta's 125-character fold (#194)", () => {
    const flagged = [...groq.drafts, ...groqFields.drafts].filter((draft) => {
      const angle = AD_ANGLES.find((candidate) => candidate.id === draft.angle)!;
      const result = validateConcept(draft.concept, { brand: recorded.brand, brief: groq.brief, angle, recentCopy: [], sourceFacts: [] });
      return !result.success && conceptValidationRules(result.issues).includes("offer-below-fold");
    });
    expect(flagged.map((draft) => draft.concept.primary_text.indexOf("$49"))).toEqual([128, 142, 147]);
  });

  // #760 (CPO walk): one image was an empty waiting room. This recorded Groq draft directs exactly that
  // ("No people are present", an armchair as the focal point); no other recorded direction trips the check.
  it("refuses a visual with no subject, like the recorded empty waiting room, and keeps the rest", () => {
    const emptyRoom = groq.drafts.filter((draft) => draft.concept.visual.direction.includes("waiting area"));
    expect(emptyRoom).toHaveLength(1);
    const rules = (draft: (typeof groq.drafts)[number]) => {
      const angle = AD_ANGLES.find((candidate) => candidate.id === draft.angle)!;
      const result = validateConcept(draft.concept, { brand: recorded.brand, brief: groq.brief, angle, recentCopy: [], sourceFacts: [] });
      return result.success ? [] : conceptValidationRules(result.issues);
    };
    expect(rules(emptyRoom[0])).toContain("no-subject");
    for (const draft of [...groq.drafts, ...groqFields.drafts].filter((candidate) => !emptyRoom.includes(candidate as never))) {
      expect(rules(draft as (typeof groq.drafts)[number])).not.toContain("no-subject");
    }
  });

  it("saves drafts that mention health or punctuate a cited price, keeping real claim failures", () => {
    // One draft's only "claim" was the layout note "The top 40% of the image is uncluttered" (#202).
    expect(groq.drafts.filter((draft) => draft.rules.length === 0)).toHaveLength(7);
    expect(groq.drafts.filter((draft) => asks(draft.concept))).toHaveLength(3);
    for (const draft of groq.drafts) {
      expect(draft.rulesOnMain.length).toBeGreaterThan(0);
      expect(draftRules(draft.angle, draft.concept)).toEqual(expectedRules(draft));
    }
  });

  it("still rejects healing claims and amounts the facts do not state", () => {
    const [health] = groq.drafts.filter((draft) => draft.rules.length === 0 && draft.concept.primary_text.includes("spinal health"));
    const healing = health.concept.primary_text.replace("spinal health", "spinal healing");
    expect(draftRules(health.angle, { ...health.concept, primary_text: healing })).toEqual([...expectedRules(health), "banned-claim"].sort());
    const [price] = groq.drafts.filter((draft) => draft.rules.length === 0 && draft.concept.primary_text.includes("For $49,"));
    for (const amount of ["$4", "$490", "$49.99"]) {
      const primary_text = price.concept.primary_text.replace("For $49,", `For ${amount},`);
      expect(draftRules(price.angle, { ...price.concept, primary_text }), amount).toEqual([...expectedRules(price), "unsupported-commercial-claim"].sort());
    }
  });

  // Rejected on main only for textPlacement "left" or a quote's capital letter. The fourth also had quotes
  // stitched from Brand facts beside verbatim ones; since #713 those are dropped instead of repaired.
  it("saves drafts with a left text area or a quote differing only in case", () => {
    expect(groqFields.drafts.filter((draft) => draft.rules.length === 0)).toHaveLength(4);
    for (const draft of groqFields.drafts) {
      expect(draft.rulesOnMain).not.toEqual(draft.rules);
      expect(draftRules(draft.angle, draft.concept)).toEqual(expectedRules(draft));
    }
    const [left] = groqFields.drafts.filter((draft) => draft.concept.visual.textPlacement === "left" && !draft.rules.length && draft.concept.primary_text.indexOf("$49") < 125);
    const angle = AD_ANGLES.find((candidate) => candidate.id === left.angle)!;
    const saved = validateConcept(left.concept, { brand: recorded.brand, brief: groq.brief, angle, recentCopy: [], sourceFacts: [] });
    expect(saved.success && saved.concept.visual.textPlacement).toBe("center");
  });

  it("stores the Brand's exact quote and never stores a quote with different words", () => {
    const [cased] = groqFields.drafts.filter((draft) => draft.concept.sourceQuotes.includes("Transparent cash pricing"));
    const angle = AD_ANGLES.find((candidate) => candidate.id === cased.angle)!;
    const check = (sourceQuotes: string[]) =>
      validateConcept({ ...cased.concept, sourceQuotes }, { brand: recorded.brand, brief: groq.brief, angle, recentCopy: [], sourceFacts: [] });
    const saved = check(cased.concept.sourceQuotes);
    expect(saved.success && saved.concept.sourceQuotes).toContain("transparent cash pricing");
    const others = cased.concept.sourceQuotes.filter((quote) => quote !== "Transparent cash pricing");
    for (const quote of ["Transparent card pricing", "Transparent cash pricing guaranteed"]) {
      // #713: beside verbatim quotes it is dropped (claims are checked against the rest); alone it is refused.
      const result = check([...others, quote]);
      expect(result.success && result.concept.sourceQuotes, quote).toEqual(others);
      const alone = check([quote]);
      expect(alone.success ? [] : conceptValidationRules(alone.issues), quote).toContain("sourceQuotes");
    }
  });
});
