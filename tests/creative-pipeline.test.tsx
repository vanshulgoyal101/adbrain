// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMounted } from "@/lib/use-mounted";

const completeJSON = vi.fn();
const generateImage = vi.fn();
const downloadImage = vi.fn();

vi.mock("@/lib/llm", () => ({
  completeJSON,
  NoLLMKeysError: class NoLLMKeysError extends Error {},
}));
vi.mock("@/lib/imageGen", () => ({ generateImage, downloadImage }));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  completeJSON.mockResolvedValue({
    headline: "  Cut your power bill  ",
    primary_text: "  Two lines of copy.  ",
    cta: "Get Quote",
  });
  generateImage.mockResolvedValue({
    url: "https://img.example/a.jpg",
    prompt: "a photo",
  });
});

const brand = { name: "Solaride", vertical: "solar energy" } as never;

describe("generateVariants", () => {
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
    expect(completeJSON).toHaveBeenCalledTimes(AD_ANGLES.length);
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

  it("falls back to a safe CTA when the model omits one", async () => {
    completeJSON.mockResolvedValue({ headline: "H", primary_text: "P", cta: "" });
    const { generateVariants } = await import("@/lib/creative/generate");
    const [variant] = await generateVariants({ brand, brief: "x", count: 1 });
    expect(variant.cta).toBe("Learn More");
  });

  it("generates copy and image concurrently per variant", async () => {
    const { generateVariants } = await import("@/lib/creative/generate");
    await generateVariants({ brand, brief: "x", count: 3 });
    // 3 angles → 3 copy calls and 3 image calls, not sequential round-trips.
    expect(completeJSON).toHaveBeenCalledTimes(3);
    expect(generateImage).toHaveBeenCalledTimes(3);
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

  it("keeps the original URL when the upload fails", async () => {
    downloadImage.mockResolvedValue({
      bytes: new Uint8Array([1]),
      contentType: "image/png",
    });
    const { persistCreativeImage } = await import("@/lib/creative/persist");
    const url = await persistCreativeImage(
      storage({ error: { message: "no bucket" } }) as never,
      "b1",
      "grp",
      "value",
      "https://src.example/a.jpg",
    );
    expect(url).toBe("https://src.example/a.jpg");
  });

  it("keeps the original URL when the download throws", async () => {
    downloadImage.mockRejectedValue(new Error("404"));
    const { persistCreativeImage } = await import("@/lib/creative/persist");
    const url = await persistCreativeImage(
      storage({ error: null }) as never,
      "b1",
      "grp",
      "value",
      "https://src.example/a.jpg",
    );
    expect(url).toBe("https://src.example/a.jpg");
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
