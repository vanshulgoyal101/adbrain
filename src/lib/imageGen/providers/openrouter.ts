import { getEnv } from "@/lib/env";
import type { GeneratedImage, ImageProvider, ImageRequest } from "../types";

function aspectRatio(width: number, height: number): string {
  const ratio = width / height;
  if (ratio >= 1.7) return "16:9";
  if (ratio >= 1.25) return "4:3";
  if (ratio <= 0.7) return "9:16";
  if (ratio <= 0.85) return "4:5";
  return "1:1";
}

/** Returns a temporary data URL; the generation route uploads it to storage. */
export function createOpenRouterProvider(): ImageProvider {
  return {
    name: "openrouter-image",
    async generate(req: ImageRequest): Promise<GeneratedImage> {
      const env = getEnv();
      const key = env.OPENROUTER_API_KEYS[0];
      if (!key) throw new Error("OpenRouter image generation is not configured.");

      const response = await fetch("https://openrouter.ai/api/v1/images", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "HTTP-Referer": env.NEXT_PUBLIC_SITE_URL,
          "X-Title": "AdBrain",
        },
        body: JSON.stringify({
          model: env.OPENROUTER_IMAGE_MODEL,
          prompt: req.prompt,
          aspect_ratio: aspectRatio(req.width ?? 1024, req.height ?? 1024),
          resolution: "1K",
          quality: "high",
          output_format: "png",
          n: 1,
          ...(req.referenceImages?.length
            ? {
                input_references: req.referenceImages.slice(0, 3).map((url) => ({
                  type: "image_url",
                  image_url: { url },
                })),
              }
            : {}),
        }),
        signal: AbortSignal.timeout(45_000),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        data?: { b64_json?: string; media_type?: string }[];
        usage?: { cost?: number };
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          `OpenRouter image HTTP ${response.status}: ${payload.error?.message ?? "request failed"}`,
        );
      }
      const image = payload.data?.[0];
      if (!image?.b64_json) throw new Error("OpenRouter returned no image.");
      return {
        url: `data:${image.media_type ?? "image/png"};base64,${image.b64_json}`,
        provider: "openrouter-image",
        model: env.OPENROUTER_IMAGE_MODEL,
        estimatedCostUsd: payload.usage?.cost ?? 0,
        prompt: req.prompt,
        seed: req.seed,
      };
    },
  };
}