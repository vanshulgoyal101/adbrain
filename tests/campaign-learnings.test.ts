import { describe, expect, it } from "vitest";
import { buildLaunchSnapshot, recordLaunchCap, saveLaunchSnapshot } from "@/lib/campaign/learnings";
import createTape from "./core/fixtures/meta/create.json";

// The real create.json tape (recorded before #334, so it sent advantage_audience 0).
const recorded = createTape as unknown as { path: string; form?: Record<string, string>; body: { id?: string } }[];
const sentTargetings = recorded.filter(e => e.path.endsWith("/adsets")).map(e => e.form!.targeting);
const metaCreativeIds = recorded.filter(e => e.path.endsWith("/adcreatives")).map(e => e.body.id!);

const base = {
  destination: "whatsapp", objective: "OUTCOME_ENGAGEMENT", dailyBudgetRupees: 300, adSetCount: 1, abTest: false,
  areas: ["Chandigarh", "Mohali", "Panchkula"], ageMin: 25, ageMax: 55, gender: "all", interests: ["Solar energy"],
  whatsappLanguage: "en", prefill: { autofill: "Hi! I'd like a free solar site survey.", greeting: "Welcome to Solaride." }, storyFormat: true,
  creatives: [{ id: "c1", angle: "Solve a pain point", generation: { language: "en", textModels: [{ provider: "openrouter", model: "anthropic/claude-haiku-5.5" }], image: { model: "openai/gpt-image-2.5-flare" } } }],
};

describe("learning ledger snapshot (#588)", () => {
  it("records what the launch tried: prefill and language, audience, formats, budget, creatives and models", () => {
    expect(buildLaunchSnapshot(base)).toEqual({
      version: 2, destination: "whatsapp", objective: "OUTCOME_ENGAGEMENT",
      budget: { dailyRupees: 300, adSets: 1, abTest: false },
      audience: { areas: ["Chandigarh", "Mohali", "Panchkula"], ageMin: 25, ageMax: 55, gender: "all", interests: ["Solar energy"], advantageAudience: null },
      placements: "advantage", formats: ["4:5", "9:16"],
      whatsapp: { language: "en", prefill: "Hi! I'd like a free solar site survey.", greeting: "Welcome to Solaride.", button: "none", source: "suggested" },
      creatives: [{ id: "c1", angle: "Solve a pain point", language: "en", textModel: "anthropic/claude-haiku-5.5", imageModel: "openai/gpt-image-2.5-flare" }],
      metaCreativeIds: [], cap: null,
    });
  });

  it("#672 v2: records Advantage+ as sent and Meta's creative ids from the recorded create tape", () => {
    expect(sentTargetings).toHaveLength(1);
    const snapshot = buildLaunchSnapshot({ ...base, sentTargetings, metaCreativeIds });
    expect(snapshot.version).toBe(2);
    // What Meta was actually sent, not today's code constant (true).
    expect(snapshot.audience.advantageAudience).toBe(0);
    expect(snapshot.metaCreativeIds).toEqual(["1148404661464451"]);
    expect(snapshot.cap).toBeNull();
    expect(buildLaunchSnapshot({ ...base, sentTargetings: [sentTargetings[0], sentTargetings[0].replace('"advantage_audience":0', '"advantage_audience":1')] }).audience.advantageAudience).toBeNull();
    expect(buildLaunchSnapshot({ ...base, sentTargetings: ["not json"] }).audience.advantageAudience).toBeNull();
  });

  it("#672 v2: a confirmed capped activation adds the cap to the snapshot, best effort", async () => {
    const updates: unknown[] = [];
    const database = (snapshot: unknown, readError: unknown = null) => ({
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: snapshot === undefined ? null : { snapshot }, error: readError }) }) }),
        update: (value: unknown) => ({ eq: async () => { updates.push(value); return { error: null }; } }),
      }),
    });
    const cap = { lifetimeBudgetPaise: 90000, days: 3, endTime: "2026-10-29T14:24:00.000Z" };
    expect(await recordLaunchCap(database({ version: 2, destination: "whatsapp", cap: null }) as never, { campaignId: "a", cap })).toBe(true);
    expect(updates).toEqual([expect.objectContaining({ snapshot: { version: 2, destination: "whatsapp", cap: { lifetimeRupees: 900, days: 3, endTime: cap.endTime } } })]);
    expect(await recordLaunchCap(database(undefined) as never, { campaignId: "a", cap })).toBe(false);
    expect(await recordLaunchCap(database({}, { message: "down" }) as never, { campaignId: "a", cap })).toBe(false);
    expect(await recordLaunchCap({ from: () => { throw new Error("no table"); } } as never, { campaignId: "a", cap })).toBe(false);
    expect(updates).toHaveLength(1);
  });

  it("#840: records the saved WhatsApp message with its button, and ice breakers by name", () => {
    const call = buildLaunchSnapshot({ ...base, prefill: { greeting: "Hi!", autofill: "Can I get more info on this", callButton: true }, prefillSource: "saved" });
    expect(call.whatsapp).toEqual({ language: "en", prefill: "Can I get more info on this", greeting: "Hi!", button: "call", source: "saved" });
    const questions = buildLaunchSnapshot({ ...base, prefill: { greeting: "Hi!", autofill: "", iceBreakers: ["Free site survey"] }, prefillSource: "saved" });
    expect(questions.whatsapp).toMatchObject({ button: "ice_breakers", iceBreakers: ["Free site survey"] });
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
