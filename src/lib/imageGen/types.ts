export interface ImageRequest {
  signal?: AbortSignal;
  onAttempt?: (attempt: ImageAttempt) => void;
  prompt: string;
  width?: number;
  height?: number;
  seed?: number;
  /** Public brand/product images used by capable providers as visual references. */
  referenceImages?: string[];
}

export interface ImageAttempt {
  provider: string;
  model: string;
  status: "success" | "error";
  providerRequestId?: string;
  providerFinalStatus: "completed" | "failed" | "unknown";
  estimatedCostUsd?: number;
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
  width?: number;
  height?: number;
  fallbackFrom?: string;
  providerRequestId?: string;
  providerFinalStatus?: "completed" | "failed" | "unknown";
}

export class ImageProviderError extends Error {
  constructor(message: string, public readonly providerRequestId?: string,
    public readonly providerFinalStatus: "completed" | "failed" | "unknown" = "unknown") {
    super(message);
    this.name = "ImageProviderError";
  }
}

export interface ImageProvider {
  name: string;
  generate(req: ImageRequest): Promise<GeneratedImage>;
}
