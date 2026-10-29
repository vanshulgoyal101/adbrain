import { z } from "zod";

/** The body of POST /api/creatives/generate. */
export const generateRequestSchema = z.object({
  businessId: z.string().trim().min(1),
  brief: z.string().trim().min(1).max(2000),
  count: z.number().int().min(1).max(6).default(3),
  generationId: z.string().uuid().optional(),
  language: z.string().optional(),
  sourceFacts: z.array(z.string().trim().min(1).max(2000)).max(12)
    .refine((facts) => facts.join("").length <= 6000).default([]),
  format: z.enum(["portrait", "square", "story", "landscape"]).default("portrait"),
});

export const GENERATE_REQUEST_ERROR = "A businessId, brief (up to 2000 characters), count (1-6), and valid format are required.";
