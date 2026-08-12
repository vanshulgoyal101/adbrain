import { describe, expect, it } from "vitest";
import { destinationCTA, destinationPlan, splitAgeRange } from "@/lib/meta/client";

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

describe("splitAgeRange", () => {
  it("splits a wide range into two contiguous bands", () => {
    const bands = splitAgeRange(28, 60);
    expect(bands).toHaveLength(2);
    expect(bands[0]).toMatchObject({ ageMin: 28, ageMax: 44 });
    expect(bands[1]).toMatchObject({ ageMin: 45, ageMax: 60 });
    // Contiguous, no gap or overlap.
    expect(bands[1].ageMin).toBe(bands[0].ageMax + 1);
  });

  it("keeps a single band when the range is too narrow", () => {
    expect(splitAgeRange(30, 34)).toHaveLength(1);
  });

  it("labels each band", () => {
    const bands = splitAgeRange(25, 55);
    expect(bands[0].label).toMatch(/Age/);
  });
});
