import { z } from "zod";
import { productActions, viewportSchema } from "./client-events";

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
    /** #1650: the day-7 pricing question; codes only (no free text, no personal data). */
    answer: z.enum(["yes", "maybe", "no"]).optional(),
    reason: z.enum(["brings_enquiries", "saves_time", "sees_cost", "few_enquiries", "too_expensive", "hard_to_use", "prefer_meta", "other"]).optional(),
    days: z.number().int().nonnegative().max(3650).optional(),
    /** #1543: the scoreboard's Manage snapshot: oldest and p90 results age (minutes) across active campaigns. */
    worstMinutes: z.number().int().nonnegative().max(1_000_000).optional(),
    p90Minutes: z.number().int().nonnegative().max(1_000_000).optional(),
    /** #1123: ads the Create top-up round retried. */
    topUp: z.number().int().nonnegative().max(6).optional(),
    /** #1547: missing ads whose picture a +prospect batch tried once more (same words, free picture). */
    pictureRetry: z.number().int().nonnegative().max(6).optional(),
    /** #1468: a Create's estimated AI cost in USD (text, images and total). */
    costUsd: z.number().nonnegative().max(100).optional(),
    textCostUsd: z.number().nonnegative().max(100).optional(),
    imageCostUsd: z.number().nonnegative().max(100).optional(),
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
    /** #1200: which provider limit a 429 hit (Groq names it), with its numbers; never the provider's text. */
    rateLimitType: z.enum(["TPM", "RPM", "TPD", "RPD", "ITPM", "OTPM"]).optional(),
    rateLimitLimit: z.number().int().nonnegative().optional(),
    rateLimitUsed: z.number().int().nonnegative().optional(),
    rateLimitRequested: z.number().int().nonnegative().optional(),
    /** #1136: on business.create/update, whether the saved Brand has what Prepare needs (brand/usable.ts). */
    brandUsable: z.boolean().optional(),
    /** #366: which campaign kind a Prepare was for, so WhatsApp timings can be read separately. */
    destination: z.enum(["instant_form", "whatsapp"]).optional(),
    /** #378: names of the validation rules a rejected AI reply broke; never the reply's text. */
    validationRules: z.array(z.string().regex(/^[a-zA-Z0-9_.:*/[\]-]{1,80}$/)).max(12).optional(),
    /** #688: the reason of every blocker on a rejected campaign review, e.g. REVIEW_NO_WEBSITE. */
    blockerCodes: z.array(label).max(20).optional(),
    action: z.enum(productActions).optional(),
    viewport: viewportSchema.optional(),
    /** #615: Meta's error code, subcode, user title, trace id and Graph edge (ids replaced); never tokens or bodies. */
    metaCode: z.number().int().optional(),
    metaSubcode: z.number().int().optional(),
    metaUserTitle: z.string().max(160).optional(),
    fbtraceId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
    metaPath: label.optional(),
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