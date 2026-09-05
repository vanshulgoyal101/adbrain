// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMounted } from "@/lib/use-mounted";

const complete = vi.fn();
const generateImage = vi.fn();
const downloadImage = vi.fn();

vi.mock("@/lib/llm", () => ({
  complete,
  parseJSON: JSON.parse,
  NoLLMKeysError: class NoLLMKeysError extends Error {},
}));
vi.mock("@/lib/imageGen", () => ({ generateImage, downloadImage }));

const concept = {
  headline: "  Cut your power bill  ",
  primary_text: "  Two lines of copy.  ",
  cta: "Get Quote",
  rationale: "Show the practical value of rooftop solar.",
  visual: { medium: "Illustration", direction: "A rooftop array on a home occupies the lower half, leaving open space above.", textPlacement: "top" },
  supportingText: null,
  sourceQuotes: ["Solaride"],
};
const completion = (value: unknown) => ({ text: JSON.stringify(value), provider: "test", model: "capable-model" });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  complete.mockResolvedValue(completion(concept));
  generateImage.mockResolvedValue({
    url: "https://img.example/a.jpg",
    prompt: "a photo",
  });
});

const brand = { name: "Solaride", vertical: "solar energy" } as never;

describe("generateVariants", () => {
  it("preserves each completed variant when a sibling fails", async () => {
    generateImage.mockRejectedValueOnce(new Error("Image unavailable"));
    const onVariant = vi.fn().mockResolvedValue(undefined);
    const onFailure = vi.fn().mockResolvedValue(undefined);
    const { generateVariants } = await import("@/lib/creative/generate");
    const variants = await generateVariants({ brand, brief: "x", count: 3, onVariant, onFailure });
    expect(variants).toHaveLength(2);
    expect(onVariant).toHaveBeenCalledTimes(2);
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it("produces one variant per angle and trims the copy", async () => {
    const { generateVariants } = await import("@/lib/creative/generate");
    const variants = await generateVariants({ brand, brief: "monsoon offer", count: 2 });

    expect(variants).toHaveLength(2);
    expect(variants[0]).toMatchObject({
      headline: "Cut your power bill",
      primaryText: "Two lines of copy.",
      cta: "Get Quote",
      imageUrl: "https://img.example/a.jpg",
    });
    expect(variants[0].angleId).not.toBe(variants[1].angleId);
  });

  it("clamps a silly count to at least one angle", async () => {
    const { generateVariants } = await import("@/lib/creative/generate");
    const variants = await generateVariants({ brand, brief: "x", count: 0 });
    expect(variants).toHaveLength(1);
  });

  it("never asks the paid providers for more than the angles we have", async () => {
    const { AD_ANGLES } = await import("@/lib/templates/ads");
    const { generateVariants } = await import("@/lib/creative/generate");
    const variants = await generateVariants({ brand, brief: "x", count: 999 });
    expect(variants).toHaveLength(AD_ANGLES.length);
    expect(complete).toHaveBeenCalledTimes(AD_ANGLES.length);
  });

  it("honours explicitly requested angles and ignores unknown ids", async () => {
    const { AD_ANGLES } = await import("@/lib/templates/ads");
    const { generateVariants } = await import("@/lib/creative/generate");
    const wanted = AD_ANGLES[1].id;
    const variants = await generateVariants({
      brand,
      brief: "x",
      angleIds: ["not-an-angle", wanted],
      count: 5,
    });
    expect(variants).toHaveLength(1);
    expect(variants[0].angleId).toBe(wanted);
  });

  it("repairs an invalid CTA with explicit feedback before generating an image", async () => {
    complete.mockResolvedValueOnce(completion({ ...concept, cta: "" }));
    const { generateVariants } = await import("@/lib/creative/generate");
    const [variant] = await generateVariants({ brand, brief: "x", count: 1 });
    expect(variant.cta).toBe("Get Quote");
    expect(complete.mock.calls[1][0].at(-1).content).toContain("cta");
    expect(generateImage).toHaveBeenCalledTimes(1);
  });

  it("uses one concept call per successful variant and executes its visual direction", async () => {
    const { generateVariants } = await import("@/lib/creative/generate");
    await generateVariants({ brand, brief: "x", count: 3 });
    expect(complete).toHaveBeenCalledTimes(3);
    expect(generateImage).toHaveBeenCalledTimes(3);
    expect(generateImage.mock.calls[0][0].prompt).toContain(concept.visual.direction);
  });

  it("never spends on images after two invalid concepts", async () => {
    complete.mockResolvedValue(completion({ ...concept, headline: 12 }));
    const { generateVariants } = await import("@/lib/creative/generate");
    await expect(generateVariants({ brand, brief: "x", count: 1 })).rejects.toThrow("failed validation");
    expect(complete).toHaveBeenCalledTimes(2);
    expect(generateImage).not.toHaveBeenCalled();
  });

  it("repairs broken JSON and preserves exact copy and chosen layout", async () => {
    complete.mockResolvedValueOnce({ text: "not json" });
    const { generateVariants } = await import("@/lib/creative/generate");
    const [variant] = await generateVariants({ brand, brief: "x", count: 1 });
    expect(variant.design.headline).toBe(variant.headline);
    expect(variant.design.layout).toBe("top");
    expect(variant.design.benefits).toEqual([]);
    expect(variant.design.subhead).toBeNull();
  });
});

describe("persistCreativeImage", () => {
  const storage = (uploadResult: { error: unknown }) => ({
    storage: {
      from: () => ({
        upload: vi.fn().mockResolvedValue(uploadResult),
        getPublicUrl: () => ({
          data: { publicUrl: "https://cdn.example/stored.jpg" },
        }),
      }),
    },
  });

  it("stores the image and returns the permanent URL", async () => {
    downloadImage.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/jpeg",
    });
    const { persistCreativeImage } = await import("@/lib/creative/persist");
    const url = await persistCreativeImage(
      storage({ error: null }) as never,
      "b1",
      "grp",
      "value",
      "https://src.example/a.jpg",
    );
    expect(url).toBe("https://cdn.example/stored.jpg");
  });

  it("reports failed uploads instead of returning an unpersisted URL", async () => {
    downloadImage.mockResolvedValue({
      bytes: new Uint8Array([1]),
      contentType: "image/png",
    });
    const { persistCreativeImage } = await import("@/lib/creative/persist");
    await expect(persistCreativeImage(
      storage({ error: { message: "no bucket" } }) as never,
      "b1",
      "grp",
      "value",
      "https://src.example/a.jpg",
    )).rejects.toThrow("Could not store");
  });

  it("reports failed downloads instead of saving a broken creative", async () => {
    downloadImage.mockRejectedValue(new Error("404"));
    const { persistCreativeImage } = await import("@/lib/creative/persist");
    await expect(persistCreativeImage(
      storage({ error: null }) as never,
      "b1",
      "grp",
      "value",
      "https://src.example/a.jpg",
    )).rejects.toThrow("404");
  });
});

describe("useMounted", () => {
  function Probe() {
    return <span data-testid="state">{useMounted() ? "client" : "server"}</span>;
  }

  it("renders the server state during SSR so hydration matches", () => {
    // The server snapshot must be false, otherwise the first client render
    // differs from the HTML and React re-renders (the flicker bug).
    expect(renderToString(<Probe />)).toContain("server");
  });

  it("reports mounted after hydration on the client", () => {
    render(<Probe />);
    expect(screen.getByTestId("state")).toHaveTextContent("client");
  });
});
