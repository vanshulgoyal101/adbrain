import { describe, expect, it } from "vitest";
import { templateOpening, whatsappTemplateSchema } from "@/lib/campaign/whatsapp-template";
import { whatsappWelcomeMessage } from "@/lib/meta/client";
import recorded from "./fixtures/meta/whatsapp-openings.json";

// Solaride's template from #840 (owner, Oct 26).
const solaride = {
  greeting: "Hi! Thanks for messaging Solaride. This is your first step in getting free electricity.",
  opening: { kind: "prefill", prefill: "Can I get more info on this", callButton: true },
  language: "en",
};

describe("core: a business's saved WhatsApp message launches as the opening Meta accepted (#840)", () => {
  it("turns Solaride's saved template into the Call now opening Meta accepted", () => {
    const opening = templateOpening(solaride)!;
    const accepted = recorded.tape.find((entry) => entry.opening === "call" && entry.shape === "placement")!;
    expect(whatsappWelcomeMessage(opening)).toBe(accepted.welcome);
  });

  it("turns saved questions into ice breakers", () => {
    const opening = templateOpening({ greeting: "Hi! Thanks for messaging Solaride.", opening: { kind: "ice_breakers", questions: ["Free site survey", "Price for my home", "Call me back"] } })!;
    expect(whatsappWelcomeMessage(opening)).toBe(recorded.tape.find((entry) => entry.opening === "ice_breakers")!.welcome);
  });

  it("refuses what Meta or the phone can't show, and treats an unreadable template as none", () => {
    const questions = (list: string[]) => whatsappTemplateSchema.safeParse({ greeting: "Hi", opening: { kind: "ice_breakers", questions: list } }).success;
    expect(questions(["a", "b", "c", "d"])).toBe(false);
    expect(questions(["x".repeat(41)])).toBe(false);
    expect(questions(["Same", "Same"])).toBe(false);
    expect(questions(["Free site survey"])).toBe(true);
    expect(whatsappTemplateSchema.safeParse({ ...solaride, greeting: " " }).success).toBe(false);
    expect(templateOpening(null)).toBeNull();
    expect(templateOpening({ greeting: "Hi" })).toBeNull();
  });
});
