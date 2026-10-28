import { describe, expect, it } from "vitest";
import { validateConcept, type ConceptInput } from "@/lib/creative/concept";
import { AD_ANGLES } from "@/lib/templates/ads";
import recorded from "./fixtures/create/cedar-ridge-concept.json";

// #1580 (QA, variant of #1544): every ad text field Meta shows (headline, primary text, link description) leaves Create
// either complete or refused for the one repair, never cut mid-thought. Saved text is the model's own words, or
// ends at a sentence (. ! ? ।) or clause (, ; : — –) boundary within the field's limit. English and Devanagari.
const input: ConceptInput = {
  brand: recorded.brand,
  brief: "Invite adults near Austin to enquire about a new-patient visit.",
  angle: AD_ANGLES[0],
  sourceFacts: recorded.sourceFacts,
};
const LIMITS = { headline: 40, primary_text: 900, description: 100 } as const;
type Field = keyof typeof LIMITS;

const words = (text: string) => text.replace(/\s+/g, " ").trim();

/** Complete: the same words, or a prefix that stops at a sentence or clause boundary of the original. */
function completeThought(saved: string, original: string): boolean {
  const s = words(saved), o = words(original);
  if (s === o) return true;
  if (!o.startsWith(s)) return false;
  return /[.!?।]$/u.test(s) || /^\s*[,;:—–]\s/u.test(o.slice(s.length));
}

type Outcome = { saved: string } | { refused: boolean; issues: string[] };

function save(field: Field, text: string): Outcome {
  const result = validateConcept({ ...recorded.concept, [field]: text }, input);
  return result.success
    ? { saved: result.concept[field] as string }
    : { refused: result.issues.some((issue) => issue.includes(field)), issues: result.issues };
}

const CASES: Array<[Field, string, string]> = [
  ["description", "English, two sentences, the cut point mid-sentence (#1544)",
    "Same-day new-patient visits in Austin with a posture check. Ask about an evening slot when you message us today."],
  ["description", "English, one sentence with clauses",
    "Same-day new-patient visits in Austin, evening and weekend slots for desk workers, and a posture check at the first visit"],
  ["description", "Devanagari, danda sentences",
    "ऑस्टिन में नए मरीज़ों के लिए उसी दिन जाँच की सुविधा। शाम और सप्ताहांत के समय भी उपलब्ध हैं, आज ही WhatsApp पर संदेश भेजें।"],
  ["description", "Devanagari, clauses only",
    "ऑस्टिन में नए मरीज़ों के लिए उसी दिन जाँच, शाम और सप्ताहांत के समय, और पहली मुलाक़ात में पोस्चर की जाँच भी करवाएँ"],
  ["headline", "English, over 40", "Same-day new-patient visits in Austin, evenings too"],
  ["headline", "Devanagari, over 40", "ऑस्टिन में उसी दिन जाँच, शाम और सप्ताहांत में भी उपलब्ध"],
  ["primary_text", "English, one long paragraph past the fold",
    "Desk work leaves your neck and back stiff by Friday. Our Austin clinic sees new patients the same day, with evening and weekend slots that fit around work. Your first visit includes a posture check and a plan you can follow at home. Message us on WhatsApp to pick a time that suits you."],
  ["primary_text", "Devanagari, one long paragraph past the fold",
    "दिन भर डेस्क पर बैठने से गर्दन और पीठ अकड़ जाती है। हमारा ऑस्टिन क्लिनिक नए मरीज़ों को उसी दिन देखता है, शाम और सप्ताहांत में भी। पहली मुलाक़ात में पोस्चर की जाँच और घर पर करने का प्लान मिलता है। समय चुनने के लिए WhatsApp पर संदेश भेजें।"],
  ["primary_text", "over the 900 limit", `${"Our Austin clinic sees new patients the same day. ".repeat(19)}Message us.`],
];

describe("core: Meta text fields never end mid-thought (#1580, #1544)", () => {
  it("control: the checker itself rejects the recorded #1544 cut", () => {
    const original = "Modular kitchens for Mohali Phase 8B, Mohali, Kharar and New Chandigarh. Ask for a quote on your new kitchen today.";
    expect(completeThought("Modular kitchens for Mohali Phase 8B, Mohali, Kharar and New Chandigarh. Ask for a quote on", original)).toBe(false);
    expect(completeThought("Modular kitchens for Mohali Phase 8B, Mohali, Kharar and New Chandigarh.", original)).toBe(true);
  });

  it.each(CASES)("%s: %s → saved complete within the limit, or refused for repair", (field, _case, text) => {
    const outcome = save(field, text);
    if ("saved" in outcome) {
      expect(outcome.saved.length, outcome.saved).toBeLessThanOrEqual(LIMITS[field]);
      expect(completeThought(outcome.saved, text), outcome.saved).toBe(true);
    } else {
      // Refused: the field is named, so the repair rewrites it instead of anything cutting it.
      expect(outcome.refused, outcome.issues.join(" | ")).toBe(true);
    }
  });

  // Known bug #1613: shortLines splits only on . ! ?, so a Hindi paragraph past the fold is refused (hook-length) instead
  // of being rewrapped like English. Flip `it.fails` to `it` in the fix.
  it.fails("a Devanagari paragraph past the fold is rewrapped at '।' and saved, like English (#1613)", () => {
    const hindi = CASES.find(([field, name]) => field === "primary_text" && name.startsWith("Devanagari"))![2];
    const outcome = save("primary_text", hindi);
    expect("saved" in outcome && words(outcome.saved) === words(hindi)).toBe(true);
  });

  it("control for #1613: the English paragraph past the fold is rewrapped and saved with the same words", () => {
    const english = CASES.find(([field, name]) => field === "primary_text" && name.startsWith("English"))![2];
    const outcome = save("primary_text", english);
    expect("saved" in outcome && words(outcome.saved) === words(english)).toBe(true);
  });

  it("the test inputs really are over their limits (or past the fold), so the clamp is exercised", () => {
    for (const [field, , text] of CASES) {
      if (field === "primary_text") expect(text.length).toBeGreaterThan(125);
      else expect(text.length, text).toBeGreaterThan(LIMITS[field]);
    }
  });
});
