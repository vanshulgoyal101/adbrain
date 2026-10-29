import sharp from "sharp";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import run4 from "./fixtures/create/cedar-ridge-run4.json";
import { requestBody, requestUrl } from "./replay";

// #280 slice 3: a new background behind the same words. The route, prompt, image provider
// (OpenRouter), usage receipts and claim are real; the concept and image latency are run 4's
// recorded production values. Only the network bytes, Supabase and storage are replaced.

const SUPABASE = "https://core-test.supabase.co";
const IMAGE_MODEL = "openai/gpt-image-2.5-flare";
const CREATIVE = "9a7c1f52-3b8e-4d61-9f0a-2c5e8b7d4a10";
const angle = run4.angles[0];
const mocks = vi.hoisted(() => ({
  claims: new Map<string, { attempt: string; state: "processing" | "unresolved" }>(),
  updates: [] as Record<string, unknown>[],
  usage: [] as Record<string, unknown>[],
  imageStatus: 200,
  /** Words saved on the picture by another tab while the image is being made. */
  editedDuringImage: null as Record<string, unknown> | null,
  assets: [] as string[],
  planUnpaid: false,
}));

vi.mock("@/lib/plan/store", () => ({
  isPlanBillingEnabled: () => mocks.planUnpaid,
  readStoredPlan: async () => ({ status: { state: "unpaid", since: "2026-10-01T00:00:00Z" }, payUrl: null }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string, args: { p_creative_id: string; p_attempt_id: string; p_unresolved?: boolean }) => {
      const claim = mocks.claims.get(args.p_creative_id);
      if (name === "creative_regeneration_claim") {
        if (claim) return { data: { action: "busy", status: claim.state }, error: null };
        mocks.claims.set(args.p_creative_id, { attempt: args.p_attempt_id, state: "processing" });
        return { data: { action: "start" }, error: null };
      }
      if (name === "creative_regeneration_finish") {
        if (!claim || claim.attempt !== args.p_attempt_id || claim.state !== "processing") return { data: { status: "missing" }, error: null };
        if (args.p_unresolved) claim.state = "unresolved";
        else mocks.claims.delete(args.p_creative_id);
        return { data: { status: args.p_unresolved ? "unresolved" : "released" }, error: null };
      }
      return { data: null, error: { message: `Unexpected RPC ${name}` } };
    },
  }),
}));
const creativeRow = () => ({
  id: CREATIVE, business_id: run4.brand.id, variant_group: "6d0e7324-171e-45df-894a-28ef6c910196", angle: angle.angleName,
  image_url: `${SUPABASE}/storage/v1/object/public/creatives/old-ad.png`, status: "approved",
  headline: angle.concept.headline, primary_text: angle.concept.primary_text, cta: angle.concept.cta,
  generation: { format: "portrait", composition: "overlay", concept: angle.concept, ...(mocks.editedDuringImage ? { design: mocks.editedDuringImage } : {}) },
});
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
    from: (table: string) => {
      let payload: Record<string, unknown> | null = null;
      const query = {
        select: () => query,
        eq: () => query,
        contains: () => query,
        not: () => query,
        limit: () => query,
        then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }),
        update: (row: Record<string, unknown>) => {
          payload = row;
          mocks.updates.push(row);
          return query;
        },
        maybeSingle: async () => ({
          data: table === "creatives" ? { ...creativeRow(), ...(payload ?? {}) }
            : table === "brand_assets" ? (mocks.assets.length ? { url: mocks.assets[0] } : null)
            : run4.brand,
          error: null,
        }),
      };
      return query;
    },
  }),
}));
vi.mock("@/lib/llm/persist", () => ({
  configuredMonthlyTokenLimit: () => 0,
  monthlyTokenUsage: async () => 0,
  persistLLMUsage: async (events: Record<string, unknown>[]) => { mocks.usage.push(...events); return true; },
}));
vi.mock("@/lib/creative/references", () => ({ creativeReferences: async () => [] }));
vi.mock("@/lib/creative/persist", () => ({
  persistCreativeImage: async () => `${SUPABASE}/storage/v1/object/public/creatives/${run4.brand.id}/photo-new.png`,
  renderAndPersistDesign: async () => `${SUPABASE}/storage/v1/object/public/creatives/${run4.brand.id}/ad-new.png`,
}));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitResponse: async () => null }));
vi.mock("@/lib/audit", () => ({ logEvent: async () => {} }));

let png: string;
let imageBodies: string[];

beforeAll(async () => {
  png = (await sharp({ create: { width: 64, height: 96, channels: 3, background: "#74A7FE" } }).png().toBuffer()).toString("base64");
});

beforeEach(() => {
  vi.resetModules();
  mocks.claims.clear();
  mocks.updates.length = 0;
  mocks.usage.length = 0;
  mocks.imageStatus = 200;
  mocks.editedDuringImage = null;
  mocks.assets = [];
  mocks.planUnpaid = false;
  imageBodies = [];
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: SUPABASE,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    OPENROUTER_API_KEYS: "core-openrouter",
    IMAGE_PROVIDER: "openrouter",
    IMAGE_PROVIDER_FALLBACK: "none",
    OPENROUTER_IMAGE_MODEL: IMAGE_MODEL,
    AD_DESIGN_OVERLAY: undefined,
  })) vi.stubEnv(name, value);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    if (url === `https://openrouter.ai/api/v1/images/models/${IMAGE_MODEL}/endpoints`) {
      return Response.json({ endpoints: [{ provider_tag: "openai", supported_parameters: {
        aspect_ratio: { values: ["1:1", "2:3", "3:2"] }, quality: { values: ["low", "medium", "high"] },
        resolution: { values: ["1K", "2K"] }, output_format: { values: ["png", "jpeg", "webp"] }, input_references: { max: 16 },
      } }] });
    }
    if (url === "https://openrouter.ai/api/v1/images") {
      imageBodies.push(requestBody(init));
      if (mocks.imageStatus !== 200) return Response.json({ id: "gen-image-core-fail", error: { message: "Upstream error" } }, { status: mocks.imageStatus });
      return Response.json({ id: "gen-image-core-replay", data: [{ b64_json: png, media_type: "image/png" }], usage: { cost: 0.04 } });
    }
    throw new Error(`Unexpected request: ${url}`);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function post(instruction: unknown = "Rooftop at sunset, warm light", body: unknown = { instruction }) {
  const { POST } = await import("@/app/api/creatives/[id]/background/route");
  const res = await POST(
    new Request(`http://localhost/api/creatives/${CREATIVE}/background`, { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: CREATIVE }) },
  );
  return { status: res.status, body: await res.json() };
}

describe("core: change only the background on a recorded run-4 ad", () => {
  it("refuses a paid background for an unpaid plan before any image, admission claim or saved change", async () => {
    mocks.planUnpaid = true;
    const res = await post();
    expect(res.status).toBe(402);
    expect(res.body.code).toBe("PLAN_UNPAID");
    expect(imageBodies).toEqual([]);
    expect(mocks.updates).toEqual([]);
    expect(mocks.usage).toEqual([]);
    expect(mocks.claims.size).toBe(0);
  });

  it("makes one image from the owner's direction, keeps every word and approval, and records the spend", async () => {
    const res = await post();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(imageBodies).toHaveLength(1);
    const prompt = JSON.parse(imageBodies[0]).prompt as string;
    expect(prompt).toContain("it replaces the earlier scene: Rooftop at sunset, warm light");
    expect(prompt).toContain(`only where it doesn't conflict with the new scene: ${angle.concept.visual.direction}`);
    expect(prompt.indexOf("Rooftop at sunset")).toBeLessThan(prompt.indexOf(angle.concept.visual.direction));
    expect(prompt).toContain(`keep the ${angle.concept.visual.textPlacement} area quiet`);
    expect(prompt).toContain("Do not render words, letters, logos");
    // The owner's words can't outrank the no-text rule: it comes after them and says it wins.
    expect(prompt.trim().split("\n").at(-1)).toMatch(/^Whatever the scene description says, these rules win: no words, letters/);

    expect(mocks.updates).toHaveLength(1);
    const [update] = mocks.updates;
    expect(Object.keys(update).sort()).toEqual(["generation", "image_url"]);
    expect(update.image_url).toBe(`${SUPABASE}/storage/v1/object/public/creatives/${run4.brand.id}/ad-new.png`);
    expect(update.generation).toMatchObject({
      concept: angle.concept,
      photoUrl: `${SUPABASE}/storage/v1/object/public/creatives/${run4.brand.id}/photo-new.png`,
      design: { headline: angle.concept.headline, ctaLabel: angle.concept.cta, layout: angle.concept.visual.textPlacement },
      backgroundInstruction: "Rooftop at sunset, warm light",
      image: { provider: "openrouter-image", model: IMAGE_MODEL, estimatedCostUsd: 0.04 },
    });
    expect(res.body.creative).toMatchObject({ status: "approved", headline: angle.concept.headline });
    expect(mocks.usage).toEqual([expect.objectContaining({
      route: "creatives.background", usageKind: "image", status: "success", estimatedCostUsd: 0.04, providerFinalStatus: "completed",
    })]);
    expect(mocks.claims.size).toBe(0);
  });

  it("draws the words saved on the picture while the image was being made", async () => {
    const { buildAdDesign } = await import("@/lib/creative/design");
    const edited = { ...buildAdDesign({ brand: run4.brand, copy: angle.concept, concept: angle.concept as never }), backgroundUrl: undefined, headline: "Edited during the image" };
    const fetchImpl = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (requestUrl(input) === "https://openrouter.ai/api/v1/images") mocks.editedDuringImage = JSON.parse(JSON.stringify(edited));
      return fetchImpl(input, init);
    });
    expect((await post()).status).toBe(200);
    expect(mocks.updates[0].generation).toMatchObject({ design: { headline: "Edited during the image" } });
  });

  it("holds the claim for a check when the provider fails without saying it was not charged", async () => {
    mocks.imageStatus = 502;
    const res = await post();
    expect(res).toEqual({ status: 502, body: { error: "The new background could not be finished. This attempt needs a check before the ad's picture can be changed again." } });
    expect(mocks.updates).toEqual([]);
    expect(mocks.usage).toEqual([expect.objectContaining({ route: "creatives.background", usageKind: "image", status: "error" })]);
    expect(mocks.claims.get(CREATIVE)?.state).toBe("unresolved");

    const again = await post();
    expect(again).toEqual({ status: 409, body: { error: "A previous paid change to this ad needs a check before trying again." } });
    expect(imageBodies).toHaveLength(1);
  });

  it.each([false, true])("uses the owner's own Brand photo without paid work even when plan unpaid is %s", async unpaid => {
    mocks.planUnpaid = unpaid;
    const photo = `${SUPABASE}/storage/v1/object/public/brand-assets/${run4.brand.id}/front-desk.jpg`;
    mocks.assets = [photo];
    const res = await post(undefined, { photoUrl: photo });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(imageBodies).toEqual([]);
    expect(mocks.usage).toEqual([]);
    expect(mocks.updates[0].generation).toMatchObject({
      concept: angle.concept,
      ownerPhoto: photo,
      design: { headline: angle.concept.headline },
      image: { provider: "owner-photo", estimatedCostUsd: 0 },
      imagePrompt: "[No image prompt: this ad uses the business's own photo from Brand assets.]",
    });
    // #1904: no choice means the saliency crop.
    expect((mocks.updates[0].generation as { design: Record<string, unknown> }).design.backgroundFit).toBe("attention");
    expect(mocks.claims.size).toBe(0);
  });

  it("saves the owner's 'Show whole photo' choice for every later render, and a new AI picture clears it (#1904)", async () => {
    const { buildAdDesign } = await import("@/lib/creative/design");
    const { pictureDesign, storedPictureDesign } = await import("@/lib/creative/picture-words");
    const photo = `${SUPABASE}/storage/v1/object/public/brand-assets/${run4.brand.id}/team.jpg`;
    mocks.assets = [photo];
    expect((await post(undefined, { photoUrl: photo, fit: "blur" })).status).toBe(200);
    const saved = mocks.updates[0].generation as { design: Record<string, unknown> };
    expect(saved.design.backgroundFit).toBe("blur");
    // The words editor and the 9:16 launch render read the saved design back.
    expect(storedPictureDesign(saved.design)?.backgroundFit).toBe("blur");
    expect(pictureDesign({ ...creativeRow(), generation: saved as never }, run4.brand).backgroundFit).toBe("blur");

    mocks.editedDuringImage = JSON.parse(JSON.stringify({ ...buildAdDesign({ brand: run4.brand, copy: angle.concept, concept: angle.concept as never }), backgroundUrl: undefined, backgroundFit: "blur" }));
    expect((await post()).status).toBe(200);
    expect((mocks.updates[1].generation as { design: Record<string, unknown> }).design).not.toHaveProperty("backgroundFit");
  });

  it("rejects an unknown fit before the claim", async () => {
    const photo = `${SUPABASE}/storage/v1/object/public/brand-assets/${run4.brand.id}/team.jpg`;
    mocks.assets = [photo];
    expect((await post(undefined, { photoUrl: photo, fit: "stretch" })).status).toBe(400);
    expect(mocks.updates).toEqual([]);
    expect(mocks.claims.size).toBe(0);
  });

  it("refuses a photo that isn't one of the business's Brand photos", async () => {
    const res = await post(undefined, { photoUrl: "https://example.com/not-ours.jpg" });
    expect(res).toEqual({ status: 400, body: { error: "That photo isn't in your Brand assets." } });
    expect(mocks.updates).toEqual([]);
    expect(mocks.claims.size).toBe(0);
  });

  it("rejects an empty or over-long direction before any paid work", async () => {
    expect((await post("")).status).toBe(400);
    expect((await post("x".repeat(301))).body).toEqual({ error: "Keep the description to 300 characters or fewer." });
    expect(imageBodies).toEqual([]);
    expect(mocks.claims.size).toBe(0);
  });
});
