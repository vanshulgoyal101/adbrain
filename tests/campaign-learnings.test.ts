import { describe, expect, it } from "vitest";
import { buildLaunchSnapshot, readCreativeMedia, recordLaunchCap, saveLaunchSnapshot } from "@/lib/campaign/learnings";
import createTape from "./core/fixtures/meta/create.json";
import launchTape from "./core/fixtures/meta/launch-validate.json";
import noReelsTape from "./core/fixtures/meta/no-facebook-reels-validate.json";

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
      version: 3, destination: "whatsapp", objective: "OUTCOME_ENGAGEMENT",
      budget: { dailyRupees: 300, adSets: 1, abTest: false },
      audience: { areas: ["Chandigarh", "Mohali", "Panchkula"], ageMin: 25, ageMax: 55, gender: "all", interests: ["Solar energy"], advantageAudience: null },
      placements: "advantage", formats: ["4:5", "9:16"],
      whatsapp: { language: "en", prefill: "Hi! I'd like a free solar site survey.", greeting: "Welcome to Solaride.", button: "none", source: "suggested" },
      creatives: [{ id: "c1", angle: "Solve a pain point", language: "en", textModel: "anthropic/claude-haiku-5.5", imageModel: "openai/gpt-image-2.5-flare", mediaAssetId: null }],
      media: [], metaCreativeIds: [], cap: null,
    });
  });

  it("#906/#680: records the placements as sent: WhatsApp and lead forms without Audience Network", () => {
    const sent = (destination: string) => (launchTape.tape as unknown as { destination: string; kind: string; form: Record<string, string> }[])
      .filter(e => e.destination === destination && e.kind === "adsets").map(e => e.form.targeting);
    expect(buildLaunchSnapshot({ ...base, sentTargetings: sent("whatsapp") }).placements).toBe("advantage:facebook,instagram,messenger");
    expect(buildLaunchSnapshot({ ...base, sentTargetings: sent("instant_form") }).placements).toBe("advantage:facebook,instagram,messenger");
    // A lead form built before #680 sent automatic placements.
    const automatic = sent("instant_form").map((targeting) => { const { publisher_platforms: _dropped, ...rest } = JSON.parse(targeting); void _dropped; return JSON.stringify(rest); });
    expect(buildLaunchSnapshot({ ...base, sentTargetings: automatic }).placements).toBe("advantage");
    expect(buildLaunchSnapshot({ ...base, sentTargetings: [...sent("whatsapp"), ...automatic] }).placements).toBe("mixed");
    // #2273: the no-Reels test, as Meta accepted it.
    const noReels = (noReelsTape.tape as unknown as { destination: string; kind: string; form: Record<string, string> }[])
      .filter(e => e.destination === "whatsapp" && e.kind === "adsets").map(e => e.form.targeting);
    expect(buildLaunchSnapshot({ ...base, sentTargetings: noReels }).placements).toBe("advantage:facebook,instagram,messenger -facebook_reels");
  });

  it("#672 (v2, kept in v3): records Advantage+ as sent and Meta's creative ids from the recorded create tape", () => {
    expect(sentTargetings).toHaveLength(1);
    const snapshot = buildLaunchSnapshot({ ...base, sentTargetings, metaCreativeIds });
    expect(snapshot.version).toBe(3);
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

  it("#789 v3: records the library photo or video each ad was made from, once per asset", () => {
    const photo = { id: "m1", kind: "image", source: "upload" };
    const snapshot = buildLaunchSnapshot({ ...base, creatives: [
      { ...base.creatives[0], media: photo },
      { id: "c2", angle: null, generation: null, media: null },
      { id: "c3", angle: null, generation: null, media: photo },
      { id: "c4", angle: null, generation: null, media: { id: "m2", kind: "video", source: "brand" } },
    ] });
    expect(snapshot.creatives.map(creative => creative.mediaAssetId)).toEqual(["m1", null, "m1", "m2"]);
    expect(snapshot.media).toEqual([{ mediaAssetId: "m1", kind: "image", source: "upload" }, { mediaAssetId: "m2", kind: "video", source: "brand" }]);
  });

  it("#789: reads each creative's library asset for this business, and never fails the launch", async () => {
    const calls: { table: string; columns: string; filters: unknown[][] }[] = [];
    const database = (tables: Record<string, { data: unknown; error: unknown }>) => ({
      from: (table: string) => {
        const call = { table, columns: "", filters: [] as unknown[][] };
        calls.push(call);
        const query = {
          select: (columns: string) => { call.columns = columns; return query; },
          in: (...args: unknown[]) => { call.filters.push(["in", ...args]); return query; },
          eq: (...args: unknown[]) => { call.filters.push(["eq", ...args]); return query; },
          then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(tables[table]).then(resolve, reject),
        };
        return query;
      },
    });
    const creatives = { data: [{ id: "c1", media_asset_id: "m1" }, { id: "c2", media_asset_id: null }, { id: "c3", media_asset_id: "m1" }, { id: "c4", media_asset_id: "gone" }], error: null };
    const media = await readCreativeMedia(database({ creatives, media_assets: { data: [{ id: "m1", kind: "image", source: "upload" }], error: null } }) as never, "b1", ["c1", "c2", "c3", "c4"]);
    expect([...media!]).toEqual([["c1", { id: "m1", kind: "image", source: "upload" }], ["c3", { id: "m1", kind: "image", source: "upload" }]]);
    expect(calls).toEqual([
      { table: "creatives", columns: "id, media_asset_id", filters: [["in", "id", ["c1", "c2", "c3", "c4"]], ["eq", "business_id", "b1"]] },
      { table: "media_assets", columns: "id, kind, source", filters: [["in", "id", ["m1", "gone"]], ["eq", "business_id", "b1"]] },
    ]);

    calls.length = 0;
    // No library photos: one read, nothing else asked.
    expect((await readCreativeMedia(database({ creatives: { data: [{ id: "c2", media_asset_id: null }], error: null } }) as never, "b1", ["c2"]))?.size).toBe(0);
    expect(calls.map(call => call.table)).toEqual(["creatives"]);
    // Before #2625's column exists, a store error or a throw: unknown (null, not "no photos"), never an error.
    const missingColumn = { data: null, error: { code: "42703", message: "column creatives.media_asset_id does not exist" } };
    expect(await readCreativeMedia(database({ creatives: missingColumn }) as never, "b1", ["c1"])).toBeNull();
    expect(await readCreativeMedia(database({ creatives, media_assets: { data: null, error: { code: "42P01" } } }) as never, "b1", ["c1"])).toBeNull();
    expect(await readCreativeMedia({ from: () => { throw new Error("no table"); } } as never, "b1", ["c1"])).toBeNull();
    expect((await readCreativeMedia(database({}) as never, "b1", []))?.size).toBe(0);
    // A stalled read gives up rather than hold the launch.
    const hung = { from: () => ({ select: () => ({ in: () => ({ eq: () => new Promise(() => {}) }) }) }) };
    expect(await readCreativeMedia(hung as never, "b1", ["c1"], 20)).toBeNull();
  });

  it("marks a launch whose photos couldn't be read as unknown, not photo-less (#789)", () => {
    const unknown = buildLaunchSnapshot({ ...base, creatives: [{ id: "c2", angle: null, generation: null }], mediaUnknown: true });
    expect(unknown).toMatchObject({ version: 3, mediaUnknown: true, media: [], creatives: [{ id: "c2", mediaAssetId: null }] });
    expect(buildLaunchSnapshot({ ...base, creatives: [{ id: "c2", angle: null, generation: null }] })).not.toHaveProperty("mediaUnknown");
  });

  it("copes with lead-form launches and old creatives without a receipt", () => {
    const snapshot = buildLaunchSnapshot({ ...base, destination: "instant_form", objective: "leads", prefill: null, storyFormat: false, creatives: [{ id: "c2", angle: null, generation: null }] });
    expect(snapshot.whatsapp).toBeNull();
    expect(snapshot.formats).toEqual(["4:5"]);
    expect(snapshot.creatives).toEqual([{ id: "c2", angle: null, language: null, textModel: null, imageModel: null, mediaAssetId: null }]);
  });

  it("never fails the launch when the ledger can't be written", async () => {
    const failing = { from: () => ({ upsert: async () => ({ error: { message: "down" } }) }) };
    const throwing = { from: () => { throw new Error("no table"); } };
    expect(await saveLaunchSnapshot(failing as never, { campaignId: "a", businessId: "b", snapshot: {} })).toBe(false);
    expect(await saveLaunchSnapshot(throwing as never, { campaignId: "a", businessId: "b", snapshot: {} })).toBe(false);
  });
});
