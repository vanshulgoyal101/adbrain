import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { buildAdDesign } from "@/lib/creative/design";
import {
  findStoredBackground,
  pictureDesign,
  pictureWordsOf,
  pictureWordsSchema,
  withPictureWords,
} from "@/lib/creative/picture-words";
import { renderCompositeAd } from "@/lib/creative/render";

const brand = { name: "Solaride", phone: "+91 98290 12345", primary_color: "#f59e0b", offers: ["Free site visit"] };
const copy = { headline: "Cut your bill", primary_text: "Rooftop solar for Jaipur homes.", cta: "Get Quote" };

describe("pictureDesign", () => {
  it("uses the spec saved with the ad", () => {
    const saved = { ...buildAdDesign({ brand, copy, format: "square" }), backgroundUrl: undefined, headline: "Saved words" };
    const design = pictureDesign({ ...copy, angle: "Special offer / incentive", generation: JSON.parse(JSON.stringify({ design: saved })) }, brand);
    expect(design).toMatchObject({ headline: "Saved words", format: "square", backgroundUrl: null });
  });

  it("rebuilds an older concept ad the way it was drawn: concept headline, supporting line, placement", () => {
    const design = pictureDesign({
      ...copy,
      angle: "Special offer / incentive",
      generation: { format: "story", concept: { headline: "Solar, sorted", supportingText: "Free site visit", visual: { textPlacement: "center" } } },
    }, brand);
    expect(design).toMatchObject({ format: "story", headline: "Solar, sorted", subhead: "Free site visit", benefits: [], layout: "center", phone: "+91 98290 12345" });
  });

  it("rebuilds an ad with no receipt from its copy", () => {
    expect(pictureDesign({ ...copy, angle: null, generation: null }, brand)).toMatchObject({ format: "portrait", headline: "Cut your bill", ctaLabel: "Get Quote" });
  });
});

describe("picture words", () => {
  it("round-trips the editable words and clears empty optional lines", () => {
    const design = buildAdDesign({ brand, copy });
    expect(pictureWordsOf(design)).toMatchObject({ headline: "Cut your bill", phone: "+91 98290 12345", ctaLabel: "Get Quote" });
    const edited = withPictureWords(design, { headline: "₹0 site visit", subhead: "", phone: "", ctaLabel: "Call Now" });
    expect(edited).toMatchObject({ headline: "₹0 site visit", subhead: null, phone: null, ctaLabel: "Call Now", primaryColor: design.primaryColor });
  });

  it("enforces the limits", () => {
    const ok = { headline: "Solar", subhead: "", phone: "+91 98290 12345", ctaLabel: "Get Quote" };
    expect(pictureWordsSchema.safeParse(ok).success).toBe(true);
    expect(pictureWordsSchema.safeParse({ ...ok, headline: "x".repeat(41) }).success).toBe(false);
    expect(pictureWordsSchema.safeParse({ ...ok, subhead: "x".repeat(65) }).success).toBe(false);
    expect(pictureWordsSchema.safeParse({ ...ok, phone: "call me" }).success).toBe(false);
    expect(pictureWordsSchema.safeParse({ ...ok, ctaLabel: "Buy" }).success).toBe(false);
  });

  it("draws the edited words: the re-rendered picture differs only because the words changed", async () => {
    const background = await sharp("public/solar-example.jpg").resize(540, 675).jpeg().toBuffer();
    const base = buildAdDesign({ brand, copy, backgroundUrl: `data:image/jpeg;base64,${background.toString("base64")}` });
    const render = async (headline: string) => sharp(await renderCompositeAd(withPictureWords(base, { ...pictureWordsOf(base), headline }))).raw().toBuffer();
    const [before, again, after] = await Promise.all([render("Cut your bill"), render("Cut your bill"), render("Diwali: free site visit")]);
    expect(Buffer.compare(before, again)).toBe(0);
    let changed = 0;
    for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) changed++;
    expect(changed).toBeGreaterThan(1000);
  }, 30_000);
});

describe("findStoredBackground", () => {
  const ID = (n: number) => `0000000${n}-0000-4000-8000-000000000000`;
  const storage = (files: Record<string, { name: string; created_at: string }[]>) => ({
    storage: {
      from: () => ({
        list: async (dir: string) => ({ data: files[dir] ?? [], error: null }),
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/creatives/${path}` } }),
      }),
    },
  }) as never;

  it("picks the newest background stored no later than the finished picture, ignoring other angles and finished pictures", async () => {
    const files = {
      "b1/g1": [
        { name: `offer-${ID(1)}.png`, created_at: "2026-10-01T10:00:00Z" },
      ],
      "b1/g1/originals-v1": [
        { name: `offer-${ID(2)}.jpg`, created_at: "2026-10-02T10:00:00Z" },
        { name: `offer-ad-${ID(3)}.png`, created_at: "2026-10-02T10:00:05Z" },
        { name: `offer-${ID(4)}.png`, created_at: "2026-10-03T10:00:00Z" },
        { name: `offer-ad-${ID(5)}.png`, created_at: "2026-10-03T10:00:05Z" },
        { name: `social-proof-${ID(6)}.png`, created_at: "2026-10-02T10:00:01Z" },
      ],
    };
    await expect(findStoredBackground(storage(files), "b1/g1", "offer", `https://x/creatives/b1/g1/originals-v1/offer-ad-${ID(3)}.png`))
      .resolves.toBe(`https://cdn.test/creatives/b1/g1/originals-v1/offer-${ID(2)}.jpg`);
    await expect(findStoredBackground(storage(files), "b1/g1", "social", null)).resolves.toBeNull();
    await expect(findStoredBackground(storage(files), "b1/g1", "social-proof", null))
      .resolves.toBe(`https://cdn.test/creatives/b1/g1/originals-v1/social-proof-${ID(6)}.png`);
  });

  it("returns null when nothing was stored", async () => {
    await expect(findStoredBackground(storage({}), "b1/g1", "offer", null)).resolves.toBeNull();
  });
});
