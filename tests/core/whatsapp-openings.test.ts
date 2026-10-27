import { describe, expect, it } from "vitest";
import { ICE_BREAKER_LIMITS, whatsappWelcomeMessage, type WhatsAppOpening } from "@/lib/meta/client";
import { resolveWhatsAppMessage, type WhatsAppTemplate } from "@/lib/campaign/whatsapp-template";
import { buildCanonicalReviewPayload, type PreflightInput } from "@/lib/campaign/preflight";
import recorded from "./fixtures/meta/whatsapp-openings.json";

// whatsapp-openings.json: Meta's validate_only answers for each opening in both creative shapes
// (scripts/record-meta-whatsapp-openings.ts against #499's paused ad; nothing created).
const openings = recorded.openings as Record<string, WhatsAppOpening>;

describe("core: every WhatsApp opening AdBrain sends is one Meta accepted (#840)", () => {
  it("sends exactly the welcome JSON Meta accepted, for every opening and both creative shapes", () => {
    expect(recorded.tape.map((entry) => `${entry.opening}/${entry.shape}`)).toEqual([
      "prefill/placement", "prefill/single", "call/placement", "call/single", "ice_breakers/placement", "ice_breakers/single"]);
    for (const entry of recorded.tape) {
      expect(entry, `${entry.opening} ${entry.shape}`).toMatchObject({ status: 200, body: { success: true } });
      expect(whatsappWelcomeMessage(openings[entry.opening])).toBe(entry.welcome);
    }
  });

  it("builds Meta's documented shapes: pre-typed, pre-typed with Call now, and ice breakers", () => {
    const message = (opening: WhatsAppOpening) => JSON.parse(whatsappWelcomeMessage(opening)).text_format;
    expect(message(openings.prefill)).toEqual({ customer_action_type: "autofill_message",
      message: { autofill_message: { content: "Hi! I'd like a free solar site survey." }, text: openings.prefill.greeting } });
    expect(message(openings.call).message.automated_greeting_message_cta).toEqual({ type: "call" });
    expect(message(openings.ice_breakers)).toEqual({ customer_action_type: "ice_breakers",
      message: { text: openings.ice_breakers.greeting, ice_breakers: [{ title: "Free site survey" }, { title: "Price for my home" }, { title: "Call me back" }] } });
  });

  it("enforces AdBrain's own limits, since Meta doesn't check them on the 9:16 path", () => {
    const base = { greeting: "Hi!", autofill: "" };
    const long = "x".repeat(ICE_BREAKER_LIMITS.chars + 1);
    for (const iceBreakers of [[], ["a", "b", "c", "d"], [long], ["Same", "Same"], ["  "]]) {
      expect(() => whatsappWelcomeMessage({ ...base, iceBreakers }), JSON.stringify(iceBreakers)).toThrow("1 to 3 different questions");
    }
    // 40 Devanagari characters count as 40, not their UTF-16 length.
    expect(() => whatsappWelcomeMessage({ ...base, iceBreakers: ["मुफ़्त".padEnd(40, "क")] })).not.toThrow();
    expect(() => whatsappWelcomeMessage({ ...base, iceBreakers: ["Price"], callButton: true })).toThrow("Call now");
  });
});

// #840 3c: a campaign's own edit, the saved message and AdBrain's suggestion all end in one of the openings above.
describe("core: the WhatsApp message Review shows is the one launch sends (#840)", () => {
  const asTemplate = (opening: WhatsAppOpening): WhatsAppTemplate => ({
    greeting: opening.greeting, language: "en",
    opening: opening.iceBreakers ? { kind: "ice_breakers", questions: opening.iceBreakers } : { kind: "prefill", prefill: opening.autofill, callButton: Boolean(opening.callButton) },
  });
  const suggestion: WhatsAppOpening = openings.prefill;

  it("an edit wins over the saved message, which wins over the suggestion, and each sends a welcome Meta accepted", () => {
    for (const entry of recorded.tape) {
      const opening = openings[entry.opening];
      for (const resolved of [
        resolveWhatsAppMessage({ edited: asTemplate(opening), saved: asTemplate(openings.prefill), suggest: () => suggestion }),
        resolveWhatsAppMessage({ edited: null, saved: asTemplate(opening), suggest: () => suggestion }),
      ]) expect(whatsappWelcomeMessage(resolved.opening)).toBe(entry.welcome);
    }
    expect(resolveWhatsAppMessage({ edited: asTemplate(openings.call), saved: asTemplate(openings.prefill), suggest: () => suggestion }).source).toBe("edited");
    expect(resolveWhatsAppMessage({ saved: asTemplate(openings.call), suggest: () => suggestion }).source).toBe("saved");
    expect(resolveWhatsAppMessage({ saved: null, suggest: () => suggestion })).toEqual({ source: "suggested", opening: suggestion, language: null });
  });

  it("only an edited or saved message enters the plan hash: a business with nothing saved keeps its exact payload", () => {
    const input = {
      draft: { businessId: "b", destination: "whatsapp", creativeIds: ["c"], leadFormId: null, dailyBudgetRupees: 300, abTest: false, targeting: {} },
      draftId: "d", draftVersion: 1, connection: null, creatives: [], form: null, whatsappNumber: "+919876543210",
      geo: { resolvedAreaLabel: "Mohali", unresolvedNames: [], explicitlyNationwide: false }, hash: () => "",
    } as unknown as PreflightInput;
    const payload = (whatsappMessage: PreflightInput["whatsappMessage"]) => buildCanonicalReviewPayload({ ...input, whatsappMessage });
    expect(payload(resolveWhatsAppMessage({ saved: null, suggest: () => suggestion }))).toEqual(payload(undefined));
    expect(payload(resolveWhatsAppMessage({ saved: asTemplate(openings.call), suggest: () => suggestion })).whatsappOpening).toEqual(openings.call);
    expect(payload(resolveWhatsAppMessage({ edited: asTemplate(openings.ice_breakers), saved: null, suggest: () => suggestion })).whatsappOpening).toEqual(openings.ice_breakers);
  });
});
