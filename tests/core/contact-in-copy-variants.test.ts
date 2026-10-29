import { describe, expect, it } from "vitest";
import { conceptValidationRules, validateConcept, type ConceptInput } from "@/lib/creative/concept";
import { AD_ANGLES } from "@/lib/templates/ads";
import recorded from "./fixtures/create/cedar-ridge-concept.json";

// #1889 (QA, twin of #1883; Reviewer's #1874): Brand text and prospect bios flow into prompts, and a third party's
// phone, link or WhatsApp in the ad's words sends a pilot's customers elsewhere. The final gate (`validateConcept`)
// must refuse every written form in every text field Meta shows; the repair then rewrites it. Control: the recorded
// Cedar Ridge concept (no contact in it) passes, and the business's own phone and site stay allowed.
const input: ConceptInput = {
  brand: { ...recorded.brand, website: "https://cedarridgechiro.com", phone: "+1 512 555 0142" },
  brief: "Invite adults near Austin to enquire about a new-patient visit.",
  angle: AD_ANGLES[0],
  sourceFacts: recorded.sourceFacts,
};
const flagged = (concept: unknown) => {
  const result = validateConcept(concept, input);
  return !result.success && conceptValidationRules(result.issues).includes("contact-in-copy");
};
const firstLine = recorded.concept.primary_text.split("\n")[0];
const inField = (field: "primary_text" | "headline" | "description" | "supportingText", text: string) =>
  field === "primary_text" ? { ...recorded.concept, primary_text: `${firstLine}\n${text}` } : { ...recorded.concept, [field]: text };

describe("core: no third-party contact survives the final ad-text gate (#1889)", () => {
  it("control: the recorded concept and the business's own phone and site are not flagged", () => {
    expect(flagged(recorded.concept)).toBe(false);
    expect(flagged(inField("primary_text", "Call +1-512-555-0142 or book at cedarridgechiro.com/book."))).toBe(false);
  });

  // Forms the gate catches today; these must stay refused, in every field.
  it.each([
    ["primary_text", "WhatsApp +91 98765 43210 to book."],
    ["primary_text", "Call 9 8 7 6 5 4 3 2 1 0 now."],
    ["primary_text", "Chat at wa.me/919876543210."],
    ["primary_text", "Follow instagram.com/otherclinic for offers."],
    ["headline", "Book at otherclinic.in"],
    ["description", "Call 1800-123-4567 for a slot."],
    ["supportingText", "Visit www.example.com"],
  ] as const)("refuses in %s: %s", (field, text) => {
    expect(flagged(inField(field, text))).toBe(true);
  });

  // #1947: written forms #1840's gate used to miss; each would ship a third party's contact in a live ad.
  it.each([
    ["a US-style number with brackets", "Call (987) 654-3210 today."],
    ["a number with dots", "Call 98765.43210 today."],
    ["a number split by a slash", "Call 98765/43210 today."],
    ["Devanagari digits", "कॉल करें ९८७६५ ४३२१० आज ही।"],
    ["a bit.ly short link", "Book at bit.ly/clinic-offer now."],
    ["a wa.link WhatsApp link", "Chat on wa.link/abc123 now."],
    ["a .xyz domain", "See clinicdeals.xyz for prices."],
    ["a one-letter domain (Telegram t.me)", "Join t.me/clinicoffers today."],
    ["a landline with its STD code", "Call 0172-2345678 today."],
    ["a +91 mobile with dashes", "Call +91-98765-43210 today."],
    ["a 0-prefixed mobile", "Call 098765 43210 today."],
    ["a Gurmukhi-digit mobile", "ਕਾਲ ਕਰੋ ੯੮੭੬੫੪੩੨੧੦ ਅੱਜ ਹੀ।"],
    ["a full-width-digit mobile", "Call ９８７６５４３２１０ today."],
    ["a US number", "Call 512-555-0199 today."],
  ])("refuses %s", (_label, text) => {
    expect(flagged(inField("primary_text", text))).toBe(true);
  });

  // #1947 (CPO): numbers that aren't phones must pass, or the repair strips a real offer from the ad.
  it.each([
    ["a year range", "Admissions 2026-2027 open now."],
    ["a session range with a slash", "Batch 2026/2027, apply today."],
    ["a dotted date", "Offer till 31.12.2026 only."],
    ["a slashed date", "Offer till 31/12/2026 only."],
    ["a doctor's name without a space", "Meet Dr.Mehta on Saturday."],
    ["prices and counts", "₹1,49,999 for 3 kW, 25 years, 500+ homes."],
  ])("lets %s through", (_label, text) => {
    expect(flagged(inField("primary_text", text))).toBe(false);
  });
});
