import { getEnv } from "@/lib/env";
import { MAX_IMAGE_BYTES, readBoundedResponse } from "../raster";
import { FreeImageBusyError, FreeImageDailyLimitError, ImageProviderError, type GeneratedImage, type ImageProvider, type ImageRequest } from "../types";

export const CLOUDFLARE_IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";
// FLUX-1-schnell takes at most 8 steps; 4 is its documented sweet spot. Prompts are capped at 2048 characters.
const STEPS = 4;
const MAX_PROMPT = 2048;
// "Daily free allocation used up": 3036 per developers.cloudflare.com/workers-ai/platform/errors; the REST API has
// also answered 4006. Out of capacity (3040) and any other 429 or 5xx are busy, worth one more try.
const DAILY_LIMIT = [3036, 4006];

export function cloudflareConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_AI_TOKEN);
}

/**
 * #1476: Cloudflare Workers AI FLUX-1-schnell, the free picture (no reference images). It returns a square
 * base64 JPEG and takes no size; the poster covers its frame with it, so a 4:5 ad crops the sides.
 */
export function createCloudflareProvider(): ImageProvider {
  return {
    name: "cloudflare",
    async generate(req: ImageRequest): Promise<GeneratedImage> {
      const env = getEnv();
      if (!cloudflareConfigured()) throw new Error("Cloudflare image generation is not configured.");
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/ai/run/${CLOUDFLARE_IMAGE_MODEL}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${env.CLOUDFLARE_AI_TOKEN}`, "Content-Type": "application/json" },
          // The live API rejects any other property, a seed included (400 code 5006, recorded 2026-10-31).
          body: JSON.stringify({ prompt: req.prompt.slice(0, MAX_PROMPT), steps: STEPS }),
          signal: req.signal ? AbortSignal.any([req.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
        },
      );
      const requestId = response.headers.get("cf-ray")?.slice(0, 120) || undefined;
      let payload: { success?: boolean; result?: { image?: string }; errors?: { code?: number }[] };
      try {
        payload = JSON.parse(Buffer.from(await readBoundedResponse(response, MAX_IMAGE_BYTES * 1.4)).toString("utf8"));
      } catch {
        if (response.status === 429 || response.status >= 500) throw new FreeImageBusyError();
        throw new ImageProviderError(`Cloudflare image HTTP ${response.status}: invalid response`, requestId);
      }
      if (payload.errors?.some((error) => DAILY_LIMIT.includes(error.code ?? 0))) throw new FreeImageDailyLimitError();
      if (response.status === 429 || response.status >= 500) throw new FreeImageBusyError();
      if (!response.ok || payload.success === false)
        throw new ImageProviderError(`Cloudflare image HTTP ${response.status}: request failed`, requestId, "failed");
      if (!payload.result?.image) throw new ImageProviderError("Cloudflare returned no image.", requestId);
      return {
        url: `data:image/jpeg;base64,${payload.result.image}`,
        provider: "cloudflare",
        model: CLOUDFLARE_IMAGE_MODEL,
        estimatedCostUsd: 0,
        providerRequestId: requestId,
        providerFinalStatus: "completed",
        prompt: req.prompt,
      };
    },
  };
}
