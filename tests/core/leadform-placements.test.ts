import { describe, expect, it } from "vitest";
import { placementCreativeSpec, withoutAudienceNetwork } from "@/lib/meta/client";
import recorded from "./fixtures/meta/leadform-placements-validate.json";

// #680 lever 2 (WhatsApp vs instant form): Meta's real validate_only answers on Solaride's account
// (scripts/record-meta-leadform-placements.ts). The lead-form arm gets the WhatsApp arm's placements
// (no Audience Network) and 9:16, so the A/B differs only in its destination.
const exchange = (name: string) => recorded.tape.find((entry) => entry.name === name)!;
const inputs = recorded.inputs as unknown as Parameters<typeof placementCreativeSpec>[0];

describe("core: lead-form ads match WhatsApp placements (#680)", () => {
  it("Meta accepts a lead-form ad set on Facebook, Instagram and Messenger only, and reads the platforms", () => {
    const accepted = exchange("adset-leadform-without-audience-network");
    expect(accepted).toMatchObject({ status: 200, body: { success: true } });
    expect(accepted.form).toMatchObject({ destination_type: "ON_AD", optimization_goal: "LEAD_GENERATION", status: "PAUSED" });
    const targeting = JSON.parse(accepted.form.targeting!);
    expect(targeting.publisher_platforms).toEqual(["facebook", "instagram", "messenger"]);
    expect(withoutAudienceNetwork(targeting)).toEqual(targeting);
    expect(targeting.excluded_geo_locations).toBeDefined();
    expect(exchange("control-adset-audience-network-only")).toMatchObject({ status: 400, body: { error: { code: 100, error_subcode: 1815336 } } });
  });

  it("sends exactly the lead-form placement creative Meta validated; without the form id Meta refuses it", () => {
    const validated = exchange("story-leadform");
    expect(validated).toMatchObject({ status: 200, body: { success: true } });
    expect(JSON.parse(validated.form.creative!)).toEqual(placementCreativeSpec(inputs));
    expect(placementCreativeSpec(inputs).asset_feed_spec.call_to_actions).toEqual([{ type: "LEARN_MORE", value: { lead_gen_form_id: inputs.leadFormId } }]);
    expect(JSON.parse(exchange("control-story-leadform-without-form").form.creative!)).toEqual(placementCreativeSpec({ ...inputs, leadFormId: undefined }));
    expect(exchange("control-story-leadform-without-form")).toMatchObject({ status: 400, body: { error: { code: 100, error_subcode: 3390001 } } });
  });
});
