import { describe, expect, it } from "vitest";
import { ICE_BREAKER_LIMITS, whatsappWelcomeMessage, type WhatsAppOpening } from "@/lib/meta/client";
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
