import { describe, expect, it } from "vitest";
import { whatsappWelcomeMessage } from "@/lib/meta/client";
import { templateOpening, whatsappTemplateSchema, type WhatsAppTemplate } from "@/lib/campaign/whatsapp-template";
import { whatsappTemplateProblem } from "@/lib/campaign/whatsapp-template-check";
import { suggestedQuestions } from "@/lib/campaign/whatsapp-questions";
import recorded from "./fixtures/meta/whatsapp-openings.json";
import solaride from "./fixtures/create/solaride-hindi.json";
import cedar from "./fixtures/create/cedar-ridge-run4.json";

// #905/#1114: suggested quick questions, once the owner saves them, go out in exactly the ice-breaker welcome
// Meta accepted on the recorded validate_only tape (#840), only with their own titles. Nothing new is sent to Meta.
const accepted = recorded.tape.filter((entry) => entry.opening === "ice_breakers");
const languages = ["en", "hi", "hinglish", "pa"] as const;

describe("core: suggested WhatsApp questions send a welcome Meta accepted (#905)", () => {
  for (const [name, brand] of [["Solaride", solaride.brand], ["Cedar Ridge", cedar.brand]] as const) {
    it(`${name}: every language passes the saved-message checks and matches the recorded shape`, () => {
      expect(accepted.map((entry) => entry.shape)).toEqual(["placement", "single"]);
      for (const language of languages) {
        const questions = suggestedQuestions(brand, language);
        const template: WhatsAppTemplate = whatsappTemplateSchema.parse({
          greeting: recorded.openings.ice_breakers.greeting, language, opening: { kind: "ice_breakers", questions },
        });
        expect(whatsappTemplateProblem(template, brand), `${name} ${language}`).toBeNull();
        const sent = JSON.parse(whatsappWelcomeMessage(templateOpening(template)!));
        for (const entry of accepted) {
          const shape = JSON.parse(entry.welcome);
          shape.text_format.message.ice_breakers = questions.map((title) => ({ title }));
          expect(sent, `${name} ${language} ${entry.shape}`).toEqual(shape);
        }
      }
    });
  }

  it("asks Solaride's two offers as a customer would (#1114), keeps Cedar's $49 exam in the owner's words, never as a cost", () => {
    expect(suggestedQuestions(solaride.brand)).toEqual(["Can I book a free site survey?", "Can I get PM Surya Ghar subsidy help?", "What's the price?"]);
    // The smoke Brand (Designer's #1135 walk): the whole exam question passes 40 characters, so it asks for the priced first item.
    expect(suggestedQuestions(cedar.brand)).toEqual(["Can I get the $49 new-patient exam?", "Can I book a free 15-minute spine check?", "What's the price?"]);
    for (const language of languages) {
      expect(suggestedQuestions(solaride.brand, language).join(" ")).not.toMatch(/cost|कितन|kitna/i);
    }
  });
});
