import { z } from "zod";

export const customerPaiseSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const customerBalanceSchema = z.object({
  businessId: z.uuid(), currency: z.literal("INR"), capturedPaise: customerPaiseSchema,
  refundedPaise: customerPaiseSchema, serviceAllocationPaise: customerPaiseSchema, advertisingAllocationPaise: customerPaiseSchema,
  mediaCostPaise: customerPaiseSchema, taxCostPaise: customerPaiseSchema, reservedPaise: customerPaiseSchema, remainingPaise: customerPaiseSchema,
  held: z.boolean(), reason: z.string().nullable(),
  reservations: z.array(z.object({ campaignId: z.uuid(), reservationId: z.uuid(), state: z.enum(["uncertain", "active", "paused", "closed"]) })).default([]),
});
export type CustomerBalance = z.infer<typeof customerBalanceSchema>;

export const customerCostEvidenceSchema = z.strictObject({
  campaignId: z.uuid(), adAccountId: z.string().regex(/^act_[0-9]+$/), connectionGeneration: z.number().int().positive(),
  mediaPaise: customerPaiseSchema, taxPaise: customerPaiseSchema, taxRateBps: z.number().int().min(0).max(10000),
  observedAt: z.iso.datetime(), evidenceReference: z.uuid(), final: z.boolean(), reservationId: z.uuid().nullable(),
});
export const customerRefundAllocationSchema = z.strictObject({
  orderId: z.uuid(), serviceRefundedPaise: customerPaiseSchema.max(200000), advertisingRefundedPaise: customerPaiseSchema.max(800000),
  serviceEarnedPaise: z.union([z.literal(0), z.literal(200000)]), evidenceReference: z.uuid(),
});