export interface ImageRequest {
  prompt: string;
  width?: number;
  height?: number;
  seed?: number;
}

export interface GeneratedImage {
  /** A URL usable directly as an <img> src. */
  url: string;
  provider: string;
  prompt: string;
  seed?: number;
}

export interface ImageProvider {
  name: string;
  generate(req: ImageRequest): Promise<GeneratedImage>;
}
