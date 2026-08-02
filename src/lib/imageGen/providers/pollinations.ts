import { getEnv } from "@/lib/env";
import type { GeneratedImage, ImageProvider, ImageRequest } from "../types";

/**
 * Pollinations.ai — free, no API key. Images are generated on-demand from a URL,
 * so we just build the URL and let the browser (or a later download step) fetch
 * the bytes. Swap this out for fal.ai / OpenAI by adding a provider + key.
 */
export function createPollinationsProvider(): ImageProvider {
  return {
    name: "pollinations",
    async generate(req: ImageRequest): Promise<GeneratedImage> {
      const env = getEnv();
      const width = req.width ?? 1024;
      const height = req.height ?? 1024;
      const seed = req.seed ?? Math.floor(Math.random() * 1_000_000);

      const params = new URLSearchParams({
        width: String(width),
        height: String(height),
        seed: String(seed),
        model: env.POLLINATIONS_MODEL,
        nologo: "true",
      });

      const url =
        `https://image.pollinations.ai/prompt/` +
        `${encodeURIComponent(req.prompt)}?${params.toString()}`;

      return { url, provider: "pollinations", prompt: req.prompt, seed };
    },
  };
}
