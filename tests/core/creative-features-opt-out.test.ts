import { describe, expect, it } from "vitest";
import readback from "./fixtures/meta/creative-features-readback.json";
import launch from "./fixtures/meta/launch-validate.json";
import website from "./fixtures/meta/launch-validate-website.json";
import noReels from "./fixtures/meta/no-facebook-reels-validate.json";
import adEdit from "./fixtures/meta/ad-edit.json";
import { CREATIVE_FEATURES_OPT_OUT, CREATIVE_OPT_OUT_FORM } from "@/lib/meta/client";

// #1932 (Analyst #1912, CTO): every creative AdBrain builds opts out of Meta's picture/video/text-changing enhancements
// explicitly, instead of relying on the API default. The read-back is a live creative's spec (read-only GET, Oct 29).
const live = readback.creative_features_spec as Record<string, { enroll_status: string }>;

describe("core: explicit OPT_OUT of Advantage+ creative enhancements (#1932)", () => {
  it("every feature we opt out of is one Meta lists on our creatives, and it reads back OPT_OUT today", () => {
    expect(Object.keys(live).length).toBeGreaterThanOrEqual(80);
    for (const feature of CREATIVE_FEATURES_OPT_OUT) {
      expect(live[feature], feature).toEqual({ enroll_status: "OPT_OUT" });
    }
  });

  it("covers the ones that would change an owner's real-work photo or the words", () => {
    for (const feature of ["image_background_gen", "image_touchups", "pac_genai_recomposition", "image_uncrop", "text_generation", "add_text_overlay"]) {
      expect(CREATIVE_FEATURES_OPT_OUT).toContain(feature);
    }
  });

  it("the creative form carries degrees_of_freedom_spec with every one set to OPT_OUT", () => {
    const spec = JSON.parse(CREATIVE_OPT_OUT_FORM.degrees_of_freedom_spec) as { creative_features_spec: Record<string, { enroll_status: string }> };
    expect(Object.keys(spec.creative_features_spec).sort()).toEqual([...CREATIVE_FEATURES_OPT_OUT].sort());
    expect(Object.values(spec.creative_features_spec).every((value) => value.enroll_status === "OPT_OUT")).toBe(true);
  });

  type Tape = { creativeReadbacks: { destination: string; status: number; body: { degrees_of_freedom_spec?: { creative_features_spec: Record<string, { enroll_status: string }> } } }[]; tape: { kind: string; form: Record<string, string>; status: number }[] };
  const tapes = { launch, website, noReels } as unknown as Record<string, Tape>;

  it.each(Object.keys(tapes))("Meta accepted the explicit opt-outs on every %s creative (validate_only, Nov 2)", (name) => {
    const creatives = tapes[name].tape.filter((e) => e.kind.startsWith("adcreatives"));
    expect(creatives.length).toBeGreaterThan(0);
    for (const exchange of creatives) {
      expect(exchange.status).toBe(200);
      expect(exchange.form.degrees_of_freedom_spec).toBe(CREATIVE_OPT_OUT_FORM.degrees_of_freedom_spec);
    }
  });

  it.each(Object.keys(tapes))("each %s creative Meta created reads back with every one OPT_OUT", (name) => {
    const { creativeReadbacks } = tapes[name];
    expect(creativeReadbacks.length).toBeGreaterThan(0);
    for (const { status, body } of creativeReadbacks) {
      expect(status).toBe(200);
      const spec = body.degrees_of_freedom_spec!.creative_features_spec;
      for (const feature of CREATIVE_FEATURES_OPT_OUT) expect(spec[feature], feature).toEqual({ enroll_status: "OPT_OUT" });
    }
  });

  it("an edited ad's new creative opts out too, and Meta accepted it (validate_only)", () => {
    expect(adEdit.form.degrees_of_freedom_spec).toBe(CREATIVE_OPT_OUT_FORM.degrees_of_freedom_spec);
    expect(adEdit.validated.creative).toEqual({ status: 200, body: { success: true } });
  });
});
