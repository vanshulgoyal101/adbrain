import { readFileSync } from "node:fs";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MetaClient, placementCreativeSpec } from "@/lib/meta/client";
import { renderStoryAd } from "@/lib/creative/story";
import recorded from "./fixtures/meta/story-validate.json";

// story-validate.json: Meta's real validate_only answers (scripts/record-meta-story-fixtures.ts, #333).
const validated = recorded.tape.find((exchange) => exchange.name === "story-whatsapp")!;
const control = recorded.tape.find((exchange) => exchange.name === "control-malformed-welcome")!;
const inputs = recorded.inputs as Parameters<typeof placementCreativeSpec>[0];
const exchange = (name: string) => recorded.tape.find((entry) => entry.name === name)!;

afterEach(() => vi.restoreAllMocks());

describe("core: Stories and Reels get a 9:16 image (#333)", () => {
  it("sends exactly the placement creative Meta validated, greeting included", () => {
    expect(validated.status).toBe(200);
    expect(validated.body).toEqual({ success: true });
    expect(JSON.parse(validated.form.creative!)).toEqual(placementCreativeSpec(inputs));
    // The real sequence: a creative naming the Page's Instagram gets its ad at once; without it, Meta refuses.
    expect(JSON.parse(exchange("creative-with-instagram").form.object_story_spec!)).toEqual(placementCreativeSpec(inputs).object_story_spec);
    expect(exchange("ad-with-instagram")).toMatchObject({ status: 200, body: { success: true } });
    expect(exchange("control-ad-without-instagram")).toMatchObject({ status: 400, body: { error: { code: 100, error_subcode: 1772103 } } });
    // A malformed greeting fails validation, so Meta reads the one we send.
    expect(control.status).not.toBe(200);
    // Meta shows a placement only if exactly one rule names its position (previews checked per format).
    const [story, feed] = placementCreativeSpec(inputs).asset_feed_spec.asset_customization_rules;
    expect(story).toMatchObject({ image_label: { name: "adbrain_story" }, customization_spec: { facebook_positions: ["story", "facebook_reels"], instagram_positions: ["story", "reels", "profile_reels"] } });
    expect(feed.customization_spec.facebook_positions).toContain("feed");
    expect(feed.customization_spec.instagram_positions).toContain("stream");
    for (const key of ["facebook_positions", "instagram_positions", "messenger_positions"] as const) {
      const overlap = (story.customization_spec[key] ?? []).filter((position: string) => (feed.customization_spec[key] ?? []).includes(position));
      expect(overlap, key).toEqual([]);
    }
  });

  async function create(params: { destination: "whatsapp" | "instant_form"; storyImage: Uint8Array | null; failStoryUpload?: boolean; rejectPlacement?: boolean; rejectPlacementAd?: boolean; failPlacementAd?: "timeout" | "5xx"; instagram?: string | null }) {
    const meta = new MetaClient({ adAccountId: "act_2398686420592052", pageId: inputs.pageId, accessToken: "core-token" });
    vi.spyOn(meta, "getWhatsAppNumber").mockResolvedValue("+919100000874");
    vi.spyOn(meta, "getPageInstagramId").mockResolvedValue(params.instagram === undefined ? inputs.instagramUserId : params.instagram);
    vi.spyOn(meta, "uploadAdImage").mockResolvedValue(inputs.feedHash);
    const storyUpload = vi.spyOn(meta, "uploadAdImageBytes").mockImplementation(async () => {
      if (params.failStoryUpload) throw new Error("Image too large");
      return inputs.storyHash;
    });
    let creativeCount = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const body = String(init?.body);
      if (String(url).includes("/adcreatives")) {
        creativeCount += 1;
        if (params.rejectPlacement && body.includes("asset_feed_spec")) return Response.json({ error: { message: "Invalid parameter", type: "OAuthException", code: 100 } }, { status: 400 });
        return Response.json({ id: `creative-${creativeCount}` });
      }
      // Meta's recorded answer to an ad on a placement creative that doesn't name the Instagram account.
      if (params.rejectPlacementAd && /\/ads(\?|$)/.test(String(url)) && body.includes("creative-1")) return Response.json(exchange("control-ad-without-instagram").body, { status: 400 });
      if (params.failPlacementAd && /\/ads(\?|$)/.test(String(url)) && body.includes("creative-1")) {
        if (params.failPlacementAd === "timeout") throw new DOMException("The operation timed out.", "TimeoutError");
        return Response.json({ error: { message: "An unknown error has occurred.", type: "OAuthException", code: 1 } }, { status: 500 });
      }
      return Response.json({ id: "created-id" });
    });
    const fallbacks: string[] = [];
    let error: unknown;
    await meta.createLeadCampaign({
      onStoryFallback: (stage, code) => fallbacks.push(`${stage}:${code}`),
      name: "Core #333", dailyBudgetRupees: 280, destination: params.destination,
      leadFormId: params.destination === "instant_form" ? "form-1" : undefined,
      whatsappNumber: params.destination === "whatsapp" ? "+919100000874" : undefined,
      whatsappGreeting: params.destination === "whatsapp" ? inputs.whatsappGreeting : undefined,
      link: "https://solaride.in",
      creatives: [{ imageUrl: "https://ads.example.test/feed.png", headline: inputs.headline, message: inputs.message, description: inputs.description, storyImage: params.storyImage }],
      location: { cities: [{ key: "1021145" }] }, ageMin: 25, ageMax: 55, gender: "all",
    }).catch((caught: unknown) => {
      if (!params.failPlacementAd) throw caught;
      error = caught;
    });
    const forms = fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), form: Object.fromEntries(new URLSearchParams(String(init?.body))) }));
    const creatives = forms.filter((call) => call.url.includes("/adcreatives")).map((call) => call.form);
    return { creative: creatives.at(-1)!, creatives, ads: forms.filter((call) => /\/ads(\?|$)/.test(call.url)).length, fallbacks, uploads: 1 + storyUpload.mock.calls.length, error };
  }

  it("uploads the 9:16 and switches a WhatsApp ad to placement images", async () => {
    const { creative, uploads, fallbacks } = await create({ destination: "whatsapp", storyImage: new Uint8Array([9]) });
    expect(fallbacks).toEqual([]);
    expect(uploads).toBe(2);
    const feed = JSON.parse(creative.asset_feed_spec);
    expect(feed.images.map((image: { hash: string }) => image.hash)).toEqual([inputs.feedHash, inputs.storyHash]);
    expect(feed.additional_data.page_welcome_message).toContain("autofill_message");
    expect(JSON.parse(creative.object_story_spec)).toEqual({ page_id: inputs.pageId, instagram_user_id: inputs.instagramUserId });
  });

  it("keeps today's single-image creative when there is no 9:16, the upload fails, or it's a lead-form ad", async () => {
    for (const run of [
      await create({ destination: "whatsapp", storyImage: null }),
      await create({ destination: "whatsapp", storyImage: new Uint8Array([9]), failStoryUpload: true }),
      await create({ destination: "instant_form", storyImage: new Uint8Array([9]) }),
    ]) {
      expect(run.creative.asset_feed_spec).toBeUndefined();
      expect(JSON.parse(run.creative.object_story_spec).link_data.image_hash).toBe(inputs.feedHash);
    }
  });

  it("falls back to the single-image creative when Meta refuses the placement one, and still makes the ad", async () => {
    const { creatives, creative, ads, fallbacks } = await create({ destination: "whatsapp", storyImage: new Uint8Array([9]), rejectPlacement: true });
    expect(fallbacks).toEqual(["creative:100"]);
    expect(creatives).toHaveLength(2);
    expect(creatives[0].asset_feed_spec).toBeDefined();
    expect(creative.asset_feed_spec).toBeUndefined();
    expect(JSON.parse(creative.object_story_spec).link_data.page_welcome_message).toContain("autofill_message");
    expect(ads).toBe(1);
  });

  it("skips the 9:16 when the Page has no Instagram account, and says so", async () => {
    const { creative, fallbacks, uploads } = await create({ destination: "whatsapp", storyImage: new Uint8Array([9]), instagram: null });
    expect(creative.asset_feed_spec).toBeUndefined();
    expect(uploads).toBe(1);
    expect(fallbacks).toEqual(["instagram:none"]);
  });

  it("makes the ad with the single image when Meta refuses it on the placement creative", async () => {
    const { creatives, creative, ads, fallbacks } = await create({ destination: "whatsapp", storyImage: new Uint8Array([9]), rejectPlacementAd: true });
    expect(creatives.map((form) => Boolean(form.asset_feed_spec))).toEqual([true, false]);
    expect(JSON.parse(creative.object_story_spec).link_data.image_hash).toBe(inputs.feedHash);
    expect(ads).toBe(2);
    expect(fallbacks).toEqual(["ad:100.1772103"]);
  });

  it.each(["timeout", "5xx"] as const)("fails as before, with no second ad, when the placement ad hits a %s", async (failPlacementAd) => {
    // Meta may have made the ad anyway; a retry with the single image would leave two ads in the ad set.
    const { creatives, ads, fallbacks, error } = await create({ destination: "whatsapp", storyImage: new Uint8Array([9]), failPlacementAd });
    expect(error).toBeDefined();
    expect(creatives).toHaveLength(1);
    expect(ads).toBe(1);
    expect(fallbacks).toEqual([]);
  });

  it("lays out a saved overlay ad at 1080×1920 without an AI call, and skips ads without a saved design", async () => {
    const photo = `data:image/png;base64,${(await sharp(readFileSync("public/solar-example.jpg")).resize(1080, 1350).png().toBuffer()).toString("base64")}`;
    const design = { format: "portrait", width: 1080, height: 1350, brandName: "Solaride", logoUrl: null, headline: inputs.headline, subhead: "Free site survey", benefits: [], phone: "+91 73802 80874", contactLine: "solaride.in", ctaLabel: "Contact Us", primaryColor: "#1d3a2e", ctaTextColor: "#ffffff", fontFamily: "sans-serif", layout: "top" };
    const story = await renderStoryAd({ composition: "overlay", photoUrl: photo, design });
    expect(await sharp(Buffer.from(story!)).metadata()).toMatchObject({ width: 1080, height: 1920 });
    expect(await renderStoryAd({ composition: "image-only", photoUrl: photo, design })).toBeNull();
    expect(await renderStoryAd({ composition: "overlay", photoUrl: photo })).toBeNull();
  }, 30_000); // a full-size blur and render; slow when the core suite runs in parallel
});
