import { getEnv } from "@/lib/env";
import type { GeneratedImage, ImageProvider, ImageRequest } from "../types";
import { MAX_IMAGE_BYTES, readBoundedResponse } from "../raster";

type Capability = {
  type: string;
  values?: string[];
  min?: number;
  max?: number;
};
type Endpoint = {
  provider_tag?: string | null;
  supported_parameters: Record<string, Capability>;
};
const capabilityCache = new Map<
  string,
  { expires: number; endpoints: Endpoint[] }
>();

async function imageOptions(
  model: string,
  req: ImageRequest,
): Promise<Record<string, unknown>> {
  let cached = capabilityCache.get(model);
  if (!cached || cached.expires <= Date.now()) {
    const response = await fetch(
      `https://openrouter.ai/api/v1/images/models/${model}/endpoints`,
      {
        signal: req.signal
          ? AbortSignal.any([req.signal, AbortSignal.timeout(10_000)])
          : AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok)
      throw new Error(
        `Image capability discovery failed (${response.status}).`,
      );
    const payload = (await response.json()) as { endpoints?: Endpoint[] };
    if (!payload.endpoints?.length)
      throw new Error("No endpoints available for the configured image model.");
    cached = { endpoints: payload.endpoints, expires: Date.now() + 600_000 };
    capabilityCache.set(model, cached);
  }
  const references = req.referenceImages?.slice(0, 3) ?? [];
  const endpoint = cached.endpoints.find(
    (candidate) =>
      !references.length ||
      (candidate.supported_parameters.input_references?.max ?? 0) >=
        references.length,
  );
  if (!endpoint)
    throw new Error(
      "Configured image model cannot accept the supplied references.",
    );
  const capabilities = endpoint.supported_parameters;
  const options: Record<string, unknown> = {};
  if (endpoint.provider_tag)
    options.provider = {
      only: [endpoint.provider_tag],
      allow_fallbacks: false,
    };
  const ratios = (capabilities.aspect_ratio?.values ?? []).filter((value) =>
    /^\d+:\d+$/.test(value),
  );
  const target = (req.width ?? 1024) / (req.height ?? 1024);
  const distance = (value: string) => {
    const [width, height] = value.split(":").map(Number);
    return Math.abs(Math.log(width / height / target));
  };
  if (ratios.length)
    options.aspect_ratio = [...ratios].sort(
      (left, right) => distance(left) - distance(right),
    )[0];
  // AdBrain composites the final poster after generation; 1K is enough for
  // the source photo and avoids the latency/cost jump from 2K high quality.
  if (capabilities.quality?.values?.includes("medium"))
    options.quality = "medium";
  else if (capabilities.quality?.values?.includes("standard"))
    options.quality = "standard";
  if (capabilities.resolution?.values?.includes("1K"))
    options.resolution = "1K";
  else if (capabilities.resolution?.values?.includes("2K"))
    options.resolution = "2K";
  if (capabilities.output_format?.values?.includes("png"))
    options.output_format = "png";
  if (req.seed !== undefined && capabilities.seed) options.seed = req.seed;
  if (references.length)
    options.input_references = references.map((url) => ({
      type: "image_url",
      image_url: { url },
    }));
  return options;
}

/** Returns a temporary data URL; the generation route uploads it to storage. */
export function createOpenRouterProvider(): ImageProvider {
  return {
    name: "openrouter-image",
    async generate(req: ImageRequest): Promise<GeneratedImage> {
      const env = getEnv();
      const key = env.OPENROUTER_API_KEYS[0];
      if (!key)
        throw new Error("OpenRouter image generation is not configured.");
      const options = await imageOptions(env.OPENROUTER_IMAGE_MODEL, req);

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
          ...options,
        }),
        signal: req.signal
          ? AbortSignal.any([req.signal, AbortSignal.timeout(180_000)])
          : AbortSignal.timeout(180_000),
      });
      const payload = JSON.parse(
        Buffer.from(
          await readBoundedResponse(response, MAX_IMAGE_BYTES * 1.4),
        ).toString("utf8"),
      ) as {
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
        estimatedCostUsd: payload.usage?.cost,
        prompt: req.prompt,
        seed: typeof options.seed === "number" ? options.seed : undefined,
      };
    },
  };
}
