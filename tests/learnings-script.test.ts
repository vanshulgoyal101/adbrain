import { describe, expect, it } from "vitest";
import { learningUpdate } from "../scripts/learnings.mjs";

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
});
