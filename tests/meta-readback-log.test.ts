import { describe, expect, it } from "vitest";
import { adSetReadbackLine } from "../scripts/meta-readback-log";

describe("adSetReadbackLine (#2713)", () => {
  it("keeps the goal fields and never prints a Meta id", () => {
    const line = adSetReadbackLine("leads", 200, {
      id: "120000000000001", promoted_object: { page_id: "111222333", pixel_id: "444555666", custom_event_type: "LEAD" },
      optimization_goal: "OFFSITE_CONVERSIONS", destination_type: "WEBSITE", billing_event: "IMPRESSIONS",
    });
    expect(line).toContain("OFFSITE_CONVERSIONS");
    expect(line).toContain('"promoted_object_keys":["page_id","pixel_id","custom_event_type"]');
    for (const id of ["120000000000001", "111222333", "444555666"]) expect(line).not.toContain(id);
  });

  it("survives an error body", () => {
    expect(adSetReadbackLine("sales", 400, { error: { message: "x" } })).toBe('sales ad set read-back 400 {"promoted_object_keys":[]}');
  });
});
