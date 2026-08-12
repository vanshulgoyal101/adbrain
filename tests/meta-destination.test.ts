import { describe, expect, it } from "vitest";
import { destinationCTA, destinationPlan } from "@/lib/meta/client";

describe("destinationPlan", () => {
  it("maps each destination to the right optimization goal + type", () => {
    expect(destinationPlan("instant_form")).toEqual({
      optimizationGoal: "LEAD_GENERATION",
      destinationType: "ON_AD",
    });
    expect(destinationPlan("call")).toEqual({
      optimizationGoal: "QUALITY_CALL",
      destinationType: "PHONE_CALL",
    });
    expect(destinationPlan("whatsapp")).toEqual({
      optimizationGoal: "CONVERSATIONS",
      destinationType: "WHATSAPP",
    });
  });
});

describe("destinationCTA", () => {
  it("instant form points at the lead form", () => {
    const cta = destinationCTA("instant_form", {
      leadFormId: "form_1",
      ctaLabel: "Get Quote",
    });
    expect(cta.type).toBe("GET_QUOTE");
    expect(cta.value).toEqual({ lead_gen_form_id: "form_1" });
  });

  it("call uses CALL_NOW with a tel: link", () => {
    const cta = destinationCTA("call", { phone: "+917380280874" });
    expect(cta.type).toBe("CALL_NOW");
    expect(cta.value).toEqual({ link: "tel:+917380280874" });
  });

  it("call without a phone falls back to the form CTA", () => {
    const cta = destinationCTA("call", { leadFormId: "f" });
    expect(cta.value).toEqual({ lead_gen_form_id: "f" });
  });

  it("whatsapp uses a WhatsApp message CTA", () => {
    const cta = destinationCTA("whatsapp", {});
    expect(cta.type).toBe("WHATSAPP_MESSAGE");
    expect(cta.value).toMatchObject({ app_destination: "WHATSAPP" });
  });
});
