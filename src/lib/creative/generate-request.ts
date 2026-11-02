import { z } from "zod";
import { MAX_AD_PHOTOS } from "@/lib/media/ad-photos";

/** POST /api/creatives/generate's body. */
export const generateRequestSchema = z
  .object({
    businessId: z.string().trim().min(1),
    brief: z.string().trim().min(1).max(2000),
    count: z.number().int().min(1).max(6).default(3),
    generationId: z.string().uuid().optional(),
    language: z.string().optional(),
    sourceFacts: z.array(z.string().trim().min(1).max(2000)).max(12)
      .refine((facts) => facts.join("").length <= 6000).default([]),
    format: z
      .enum(["portrait", "square", "story", "landscape"])
      .default("portrait"),
    // #780: photos picked from the owner's library, one per ad (ads 1-3), in place of Brand photos.
    mediaIds: z.array(z.string().uuid()).min(1).max(MAX_AD_PHOTOS).optional(),
  });
