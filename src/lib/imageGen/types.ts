export interface ImageRequest {
  prompt: string;
  width?: number;
  height?: number;
  seed?: number;
  /** Public brand/product images used by capable providers as visual references. */
  referenceImages?: string[];
}

export interface GeneratedImage {
  /** A URL usable directly as an <img> src. */
  url: string;
  provider: string;
  prompt: string;
  seed?: number;
  model?: string;
  estimatedCostUsd?: number;
  latencyMs?: number;
}

export interface ImageProvider {
  name: string;
  generate(req: ImageRequest): Promise<GeneratedImage>;
}
