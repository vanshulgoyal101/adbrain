import { describe, expect, it } from "vitest";
import { learningUpdate, pickCampaign } from "../scripts/learnings.mjs";

describe("learning ledger writer (#588)", () => {
  it("sets a trimmed hypothesis and verdict", () => {
    expect(learningUpdate({ hypothesis: "  English prefill beats Hinglish ", verdict: undefined, snapshot: undefined }))
      .toMatchObject({ hypothesis: "English prefill beats Hinglish" });
  });

  it("marks a backfilled snapshot (runs launched before the ledger)", () => {
    expect(learningUpdate({ hypothesis: undefined, verdict: undefined, snapshot: { destination: "whatsapp" } }).snapshot)
      .toEqual({ version: 1, backfilled: true, destination: "whatsapp" });
  });

  it("refuses empty, over-long or non-object input", () => {
    expect(() => learningUpdate({})).toThrow(/Give --hypothesis/);
    expect(() => learningUpdate({ verdict: " " })).toThrow(/1–500/);
    expect(() => learningUpdate({ verdict: "x".repeat(501) })).toThrow(/1–500/);
    expect(() => learningUpdate({ snapshot: ["no"] })).toThrow(/JSON object/);
  });

  it("picks the launching business's row when a shared ad account imported the campaign twice", () => {
    const launched = { id: "c57b3bcd", business_id: "ea6ea561-solaride" };
    const imported = { id: "7d42dcc9", business_id: "816aaafb-demo" };
    expect(pickCampaign([launched], [], "1202")).toBe(launched);
    expect(pickCampaign([imported, launched], ["c57b3bcd"], "1202")).toBe(launched);
    expect(() => pickCampaign([], [], "1202")).toThrow(/No AdBrain campaign/);
    expect(() => pickCampaign([imported, launched], [], "1202")).toThrow(/2 AdBrain campaigns .*816aaafb.*0 have a ledger row/);
  });
});
