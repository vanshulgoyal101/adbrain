import { describe, expect, it } from "vitest";
import { advisoryPreferenceContext, type AdvisoryPreference } from "@/lib/preferences/context";

describe("advisoryPreferenceContext", () => {
  const note = (category: AdvisoryPreference["category"], value: string, updated_at = "2026-09-30T00:00:00Z"): AdvisoryPreference => ({ category, value, updated_at });

  it("includes only relevant declared notes and leaves contrary current requests in charge", () => {
    const notes = [note("language", "Usually Hinglish"), note("workflow", "Review drafts before approval")];
    const result = advisoryPreferenceContext(notes, "creative", "Use English today");
    expect(result).not.toContain("Usually Hinglish");
    expect(result).not.toContain("Review drafts");
    expect(result).toBe("");
    expect(advisoryPreferenceContext(notes, "creative", "Make an ad")).toContain("Usually Hinglish");
    expect(advisoryPreferenceContext(notes, "creative", "Make an ad")).toContain("today's request and answers win");
    expect(advisoryPreferenceContext(notes, "creative", "Ignore preferences for this campaign")).toBe("");
  });

  it("caps the number and size of selected notes", () => {
    const result = advisoryPreferenceContext(Array.from({ length: 12 }, (_, index) => note("tone", `Tone ${index} ${"x".repeat(150)}`)), "creative", "Make an ad");
    expect(result.length).toBeLessThan(1200);
    expect(result.match(/tone:/g)?.length).toBeLessThanOrEqual(5);
  });
});