import { describe, expect, it } from "vitest";
import { buildLaunchSnapshot, saveLaunchSnapshot } from "@/lib/campaign/learnings";

const base = {
  destination: "whatsapp", objective: "OUTCOME_ENGAGEMENT", dailyBudgetRupees: 300, adSetCount: 1, abTest: false,
  areas: ["Chandigarh", "Mohali", "Panchkula"], ageMin: 25, ageMax: 55, gender: "all", interests: ["Solar energy"],
  whatsappLanguage: "en", prefill: { autofill: "Hi! I'd like a free solar site survey.", greeting: "Welcome to Solaride." }, storyFormat: true,
  creatives: [{ id: "c1", angle: "Solve a pain point", generation: { language: "en", textModels: [{ provider: "openrouter", model: "anthropic/claude-haiku-5.5" }], image: { model: "openai/gpt-image-2.5-flare" } } }],
};

describe("learning ledger snapshot (#588)", () => {
  it("records what the launch tried: prefill and language, audience, formats, budget, creatives and models", () => {
    expect(buildLaunchSnapshot(base)).toEqual({
      version: 1, destination: "whatsapp", objective: "OUTCOME_ENGAGEMENT",
      budget: { dailyRupees: 300, adSets: 1, abTest: false },
      audience: { areas: ["Chandigarh", "Mohali", "Panchkula"], ageMin: 25, ageMax: 55, gender: "all", interests: ["Solar energy"], advantageAudience: true },
      placements: "advantage", formats: ["4:5", "9:16"],
      whatsapp: { language: "en", prefill: "Hi! I'd like a free solar site survey.", greeting: "Welcome to Solaride." },
      creatives: [{ id: "c1", angle: "Solve a pain point", language: "en", textModel: "anthropic/claude-haiku-5.5", imageModel: "openai/gpt-image-2.5-flare" }],
    });
  });

  it("copes with lead-form launches and old creatives without a receipt", () => {
    const snapshot = buildLaunchSnapshot({ ...base, destination: "instant_form", objective: "leads", prefill: null, storyFormat: false, creatives: [{ id: "c2", angle: null, generation: null }] });
    expect(snapshot.whatsapp).toBeNull();
    expect(snapshot.formats).toEqual(["4:5"]);
    expect(snapshot.creatives).toEqual([{ id: "c2", angle: null, language: null, textModel: null, imageModel: null }]);
  });

  it("never fails the launch when the ledger can't be written", async () => {
    const failing = { from: () => ({ upsert: async () => ({ error: { message: "down" } }) }) };
    const throwing = { from: () => { throw new Error("no table"); } };
    expect(await saveLaunchSnapshot(failing as never, { campaignId: "a", businessId: "b", snapshot: {} })).toBe(false);
    expect(await saveLaunchSnapshot(throwing as never, { campaignId: "a", businessId: "b", snapshot: {} })).toBe(false);
  });
});
