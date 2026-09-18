import { z } from "zod";

const identifier = z.string().uuid();
const label = z.string().regex(/^[a-zA-Z0-9_.:/[\]-]{1,160}$/);

export const productEventSchema = z.object({
  version: z.literal(1),
  eventId: identifier,
  requestId: identifier,
  occurredAt: z.string().datetime(),
  kind: z.enum(["request", "action", "workflow", "system", "client"]),
  name: label,
  outcome: z.enum(["success", "rejected", "failed", "partial", "started"]),
  userId: identifier.nullable(),
  businessId: identifier.nullable(),
  durationMs: z.number().int().min(0).max(86_400_000).optional(),
  attributes: z.object({
    environment: z.enum(["production", "preview", "development", "test"]).optional(),
    release: z.string().regex(/^[a-f0-9]{7,40}$/).optional(),
    route: label.optional(),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]).optional(),
    status: z.number().int().min(100).max(599).optional(),
    entityType: z.enum(["business", "creative", "campaign", "adset", "ad", "instruction", "asset", "lead"]).optional(),
    count: z.number().int().nonnegative().max(1_000_000).optional(),
    failedCount: z.number().int().nonnegative().max(1_000_000).optional(),
    errorCode: label.optional(),
    provider: label.optional(),
    model: label.optional(),
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
    estimatedCostUsd: z.number().finite().nonnegative().optional(),
    usageKind: z.enum(["text", "image"]).optional(),
    attempt: z.number().int().min(1).max(100).optional(),
    cacheHit: z.boolean().optional(),
  }),
});

export type ProductEvent = z.infer<typeof productEventSchema>;
export type ProductEventInput = Pick<ProductEvent, "kind" | "name" | "outcome"> &
  Partial<Pick<ProductEvent, "businessId" | "durationMs" | "attributes">>;

export function requestOutcome(status: number): ProductEvent["outcome"] {
  return status >= 500 ? "failed" : status >= 400 ? "rejected" : "success";
}

export function sanitizeProductEvent(value: unknown): ProductEvent | null {
  const result = productEventSchema.safeParse(value);
  return result.success ? result.data : null;
}